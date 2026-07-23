import { getDatabase } from '../db/init.js';
import { randomUUID } from 'crypto';
import { rebuildStories, getStories } from './story-clustering.js';
import { chat } from './llm.js';

// 日报生成（M2 洞察层核心，ADR-008）：
// 聚类结果 + 已登记源的近期内容 → Deepseek → 今日焦点解读 + 2-3 个选题建议。
// 节奏化：每天一份（UNIQUE period 约束，重跑覆盖），不实时刷新。
//
// 选题（Idea）= 切入角度 + 为什么是现在 + 共识/非共识 + 支撑素材引用，
// 是"洞察 → 创作"的桥，不是资讯罗列。

// 本地日期键（不用 toISOString——那是 UTC，巴黎 UTC+2 时凌晨 0-2 点会算成前一天，
// 2026-07-18 日报错标 07-17 的潜伏根因）。按系统本地时区取年月日。
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`; // '2026-07-18'（本地日期）
}

// 组装给 LLM 的素材：焦点簇（多源事件）+ 已登记源的近 48h 内容（用户明确关注的人）
function gatherInputs(db) {
  const stories = getStories(8);

  const registeredContents = db.prepare(`
    SELECT c.id, c.zh_title, c.zh_summary, s.display_name
    FROM contents c
    JOIN sources s ON c.source_id = s.id
    WHERE s.registered_by_user = 1
      AND datetime(COALESCE(c.published_at, c.created_at)) > datetime('now', '-2 days')
    ORDER BY c.external_score DESC
    LIMIT 15
  `).all();

  return { stories, registeredContents };
}

function buildPrompt(stories, registeredContents) {
  const storyBlock = stories.map((s, i) => {
    const members = s.members.map(m =>
      `  - [${m.id}] ${(m.zh_title || m.en_title || '').slice(0, 80)}`
    ).join('\n');
    return `${i + 1}. 【${s.source_count}个来源】${s.headline}\n${members}`;
  }).join('\n');

  const registeredBlock = registeredContents.length
    ? registeredContents.map(c => `- [${c.id}] ${c.display_name}: ${(c.zh_title || '').slice(0, 60)}`).join('\n')
    : '（无）';

  return `你是一位 AI 领域资深内容策划，服务对象是一位独立开发者/AI产品经理/自媒体人（发布渠道：X、公众号、抖音口播视频）。

以下是他个人信息流最近的热点聚类（同一事件的多来源报道）和他主动关注的信息源动态：

# 热点聚类
${storyBlock}

# 关注的信息源动态
${registeredBlock}

请输出 JSON（不要 markdown 代码块），结构如下：
{
  "summary": "50字以内的今日导语，点出最值得关注的1-2件事",
  "focus": [
    { "headline": "重新提炼的焦点标题（比原始标题更凝练）", "whyHot": "一句话说明为什么重要", "contentIds": ["相关内容id"] }
  ],
  "ideas": [
    {
      "title": "选题标题（吸引人但不标题党）",
      "angle": "切入角度：具体怎么讲这个话题才有区分度",
      "whyNow": "为什么是现在做这个选题（时间窗口/事件钩子）",
      "consensus": ["行业已有共识点"],
      "nonConsensus": ["有争议/各方立场不同的点"],
      "contentIds": ["支撑素材的内容id"]
    }
  ]
}

要求：
- focus 取最重要的 3-5 个，宁缺毋滥
- ideas 出 2-3 个，优先选"有多源交叉验证 + 有争议点"的话题（争议是好内容的燃料）
- contentIds 必须来自上面方括号里的真实 id，不得编造
- 全部用中文`;
}

export async function generateDailyReport({ days = 7 } = {}) {
  // 先重建聚类（bge-m3 事件簇），保证日报基于最新数据；首轮补嵌入稍慢、之后缓存
  await rebuildStories(days);

  const db = getDatabase();
  const { stories, registeredContents } = gatherInputs(db);

  if (stories.length === 0 && registeredContents.length === 0) {
    db.close();
    return { success: false, error: '近期没有足够内容，请先同步数据源' };
  }

  const prompt = buildPrompt(stories, registeredContents);
  const result = await chat([{ role: 'user', content: prompt }]);

  if (!result.success) {
    db.close();
    return { success: false, error: `LLM 调用失败: ${result.error}` };
  }

  let parsed;
  try {
    // 容错：剥掉可能出现的 ```json 包裹
    const cleaned = result.content.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    db.close();
    return { success: false, error: `LLM 返回的不是合法 JSON: ${result.content.slice(0, 200)}` };
  }

  const validIds = new Set([
    ...stories.flatMap(s => s.members.map(m => m.id)),
    ...registeredContents.map(c => c.id),
  ]);
  const sanitizeIds = ids => (Array.isArray(ids) ? ids.filter(id => validIds.has(id)) : []);

  const periodKey = todayKey();
  const reportId = randomUUID();

  db.exec('BEGIN');
  try {
    // 同日重跑：覆盖旧报告及其选题（保留已被用户采纳/创作的选题）
    const old = db.prepare("SELECT id FROM reports WHERE period_type = 'daily' AND period_key = ?").get(periodKey);
    if (old) {
      db.prepare("DELETE FROM ideas WHERE report_id = ? AND status = 'suggested'").run(old.id);
      db.prepare('DELETE FROM reports WHERE id = ?').run(old.id);
    }

    db.prepare(`
      INSERT INTO reports (id, period_type, period_key, summary, focus, tokens, cost_yuan)
      VALUES (?, 'daily', ?, ?, ?, ?, ?)
    `).run(
      reportId,
      periodKey,
      parsed.summary || '',
      JSON.stringify((parsed.focus || []).map(f => ({
        headline: f.headline,
        whyHot: f.whyHot,
        contentIds: sanitizeIds(f.contentIds),
      }))),
      result.tokens || 0,
      result.cost || 0
    );

    const insertIdea = db.prepare(`
      INSERT INTO ideas (id, report_id, title, angle, why_now, consensus, non_consensus, supporting_content_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const idea of parsed.ideas || []) {
      if (!idea.title) continue;
      insertIdea.run(
        randomUUID(),
        reportId,
        idea.title,
        idea.angle || '',
        idea.whyNow || '',
        JSON.stringify(idea.consensus || []),
        JSON.stringify(idea.nonConsensus || []),
        JSON.stringify(sanitizeIds(idea.contentIds))
      );
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  const report = getReportWithIdeas(db, reportId);
  db.close();
  console.log(`✅ Daily report generated: ${periodKey} (${report.ideas.length} ideas, ¥${result.cost?.toFixed(4)})`);
  return { success: true, data: report };
}

function getReportWithIdeas(db, reportId) {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
  if (!report) return null;
  report.focus = JSON.parse(report.focus || '[]');
  // M3 周报/月报字段（日报为空值，前端按 period_type 取用）
  report.trends = JSON.parse(report.trends || '[]');
  report.page_changes = JSON.parse(report.page_changes || '[]');
  report.emergent = JSON.parse(report.emergent || '{}');
  report.ideas = db.prepare('SELECT * FROM ideas WHERE report_id = ? ORDER BY created_at').all(reportId)
    .map(i => ({
      ...i,
      consensus: JSON.parse(i.consensus || '[]'),
      non_consensus: JSON.parse(i.non_consensus || '[]'),
      supporting_content_ids: JSON.parse(i.supporting_content_ids || '[]'),
      supporting_note_ids: JSON.parse(i.supporting_note_ids || '[]'),
    }));
  resolveReportRefs(db, report);
  return report;
}

// 读取时把报告里的 contentIds/noteIds 解析成可点击的 {id, title, url}（2026-07-16 反馈：
// 周报每句话都要能点过去验证）。读取时解析而非落库冗余：内容被删后自然消失，不会留死链。
// 兼容旧报告：emergent.links/conflicts 的字符串条目归一为 {text}。
function resolveReportRefs(db, report) {
  const contentIds = new Set();
  const noteIds = new Set();
  const collect = (item) => {
    (item?.contentIds || []).forEach(id => contentIds.add(id));
    (item?.noteIds || []).forEach(id => noteIds.add(id));
  };

  for (const t of report.trends) collect(t);
  const em = report.emergent || {};
  for (const key of ['newTopics', 'links', 'conflicts']) {
    em[key] = (em[key] || []).map(item => (typeof item === 'string' ? { text: item } : item));
    em[key].forEach(collect);
  }
  for (const idea of report.ideas) {
    (idea.supporting_content_ids || []).forEach(id => contentIds.add(id));
    (idea.supporting_note_ids || []).forEach(id => noteIds.add(id));
  }

  const inClause = (ids) => ids.map(() => '?').join(',');
  const contentMap = new Map(contentIds.size
    ? db.prepare(`SELECT id, COALESCE(zh_title, en_title) AS title, url FROM contents WHERE id IN (${inClause([...contentIds])})`)
        .all(...contentIds).map(r => [r.id, r])
    : []);
  const noteMap = new Map(noteIds.size
    ? db.prepare(`SELECT id, COALESCE(title, source_title, substr(excerpt, 1, 40)) AS title FROM notes WHERE id IN (${inClause([...noteIds])})`)
        .all(...noteIds).map(r => [r.id, r])
    : []);

  const attach = (item) => {
    if (!item) return;
    if (item.contentIds?.length) item.articles = item.contentIds.map(id => contentMap.get(id)).filter(Boolean);
    if (item.noteIds?.length) item.notes = item.noteIds.map(id => noteMap.get(id)).filter(Boolean);
  };
  report.trends.forEach(attach);
  for (const key of ['newTopics', 'links', 'conflicts']) em[key].forEach(attach);
  for (const idea of report.ideas) {
    idea.supporting_contents = (idea.supporting_content_ids || []).map(id => contentMap.get(id)).filter(Boolean);
    idea.supporting_notes = (idea.supporting_note_ids || []).map(id => noteMap.get(id)).filter(Boolean);
  }
}

export function getLatestReport(periodType = 'daily') {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT id FROM reports WHERE period_type = ? ORDER BY period_key DESC LIMIT 1'
  ).get(periodType);
  const report = row ? getReportWithIdeas(db, row.id) : null;
  db.close();
  return report;
}

// 补跑守卫（2026-07-18 修 Bug1：launchd 凌晨 2:30 跑，笔记本睡着没补上 → 当天无新日报 →
// 页面退回显示昨天的报告）。由 backend 常驻进程（TCC 已授权、比睡眠的 launchd 可靠）在
// 启动时与每日定时里调用：今天已有报告就跳过（省 LLM 成本），缺了才生成。force 供手动刷新。
export async function ensureDailyReport({ force = false } = {}) {
  const key = todayKey();
  if (!force) {
    const latest = getLatestReport('daily');
    if (latest && latest.period_key === key) {
      return { success: true, skipped: true, reason: 'already-fresh', data: latest };
    }
  }
  return generateDailyReport();
}

// 从选题移除一条支撑素材（2026-07-16 反馈：AI 聚合的选题，用户可移走不合适的文章）
export function removeIdeaSupport(ideaId, contentId) {
  const db = getDatabase();
  const row = db.prepare('SELECT supporting_content_ids FROM ideas WHERE id = ?').get(ideaId);
  if (!row) { db.close(); return false; }
  const ids = JSON.parse(row.supporting_content_ids || '[]').filter(x => x !== contentId);
  db.prepare("UPDATE ideas SET supporting_content_ids = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(ids), ideaId);
  db.close();
  return true;
}

export function updateIdeaStatus(ideaId, status) {
  if (!['suggested', 'adopted', 'dismissed', 'created'].includes(status)) {
    throw new Error(`invalid status: ${status}`);
  }
  const db = getDatabase();
  const result = db.prepare(
    "UPDATE ideas SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, ideaId);
  db.close();
  return result.changes > 0;
}
