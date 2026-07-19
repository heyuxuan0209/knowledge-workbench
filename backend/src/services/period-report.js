import { getDatabase } from '../db/init.js';
import { randomUUID } from 'crypto';
import { chat } from './llm.js';
import { tokenize } from './story-clustering.js';

// 周报/月报（M3 洞察层收尾，ADR-008 + ADR-009 涌现）：
// - 动向：主题升温/降温（本期 vs 上期的关键词频次对比，本地零成本计算）
// - 主题更新：期内各活页的同化记录（changelog 即演进时间线）
// - 涌现：AI 回顾期内同化记录 + 素材，提出新活页建议、跨页关联、矛盾预警、新选题
// 节奏化：UNIQUE(period_type, period_key) 重跑覆盖，不实时刷新。

export function periodKeyOf(periodType, date = new Date()) {
  // 本地年月（不用 toISOString UTC——月初凌晨会算成上个月）；周键下方 ISO 计算已基于本地日历分量
  if (periodType === 'monthly') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; // '2026-07'
  // ISO 周：'2026-W29'
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ---- 本地趋势：本期 vs 上期内容的关键词频次对比 ----

// term -> { count: 出现在多少篇内容里（每篇去重）, ids: 命中的内容 id（留证据，上限 12） }
function keywordFreq(rows) {
  const freq = new Map();
  for (const r of rows) {
    for (const t of new Set(tokenize(`${r.zh_title || ''} ${r.en_title || ''} ${r.zh_summary || ''}`))) {
      let e = freq.get(t);
      if (!e) freq.set(t, (e = { count: 0, ids: [] }));
      e.count++;
      if (e.ids.length < 12) e.ids.push(r.id);
    }
  }
  return freq;
}

// 返回 [{theme, direction, thisCount, prevCount, contentIds}]，取变化最显著的各 5 个。
// contentIds 是命中该关键词的真实文章 id（2026-07-16 反馈 #2：动向必须可点回文章验证）
function computeTrends(db, days) {
  const q = (from, to) => db.prepare(`
    SELECT id, zh_title, en_title, zh_summary FROM contents
    WHERE datetime(COALESCE(published_at, created_at)) > datetime('now', ?)
      AND datetime(COALESCE(published_at, created_at)) <= datetime('now', ?)
  `).all(from, to);

  const cur = keywordFreq(q(`-${days} days`, '+0 days'));
  const prev = keywordFreq(q(`-${days * 2} days`, `-${days} days`));
  const evidenceIds = (c, p) => [...new Set([...(c?.ids || []), ...(p?.ids || [])])].slice(0, 10);

  const changes = [];
  for (const [term, e] of cur) {
    if (e.count < 3) continue; // 低频词噪音
    const p = prev.get(term);
    const pc = p?.count || 0;
    changes.push({
      theme: term, thisCount: e.count, prevCount: pc,
      delta: e.count - pc, ratio: (e.count + 1) / (pc + 1),
      contentIds: evidenceIds(e, p),
    });
  }
  const rising = changes.filter(x => x.ratio >= 1.5).sort((a, b) => b.delta - a.delta).slice(0, 5)
    .map(({ delta, ratio, ...x }) => ({ ...x, direction: 'rising' }));
  const coolingPool = [];
  for (const [term, p] of prev) {
    if (p.count < 3) continue;
    const c = cur.get(term);
    const cc = c?.count || 0;
    if ((p.count + 1) / (cc + 1) >= 1.5) {
      coolingPool.push({
        theme: term, direction: 'cooling', thisCount: cc, prevCount: p.count,
        delta: p.count - cc, contentIds: evidenceIds(c, p),
      });
    }
  }
  const cooling = coolingPool.sort((a, b) => b.delta - a.delta).slice(0, 5)
    .map(({ delta, ...x }) => x);
  return [...rising, ...cooling];
}

// ---- 素材收集 ----

function gatherInputs(db, days) {
  const changelog = db.prepare(`
    SELECT cl.*, t.name AS topic_name FROM topic_changelog cl
    JOIN topics t ON cl.topic_id = t.id
    WHERE datetime(cl.created_at) > datetime('now', ?)
    ORDER BY cl.created_at
  `).all(`-${days} days`);

  const topics = db.prepare(`
    SELECT id, name, evolution_phase, body FROM topics WHERE status = 'active'
  `).all();

  const recentNotes = db.prepare(`
    SELECT id, excerpt, source_title FROM notes
    WHERE datetime(created_at) > datetime('now', ?)
    ORDER BY created_at DESC LIMIT 30
  `).all(`-${days} days`);

  const topContents = db.prepare(`
    SELECT id, zh_title, zh_summary FROM contents
    WHERE datetime(COALESCE(published_at, created_at)) > datetime('now', ?)
    ORDER BY external_score DESC LIMIT 20
  `).all(`-${days} days`);

  return { changelog, topics, recentNotes, topContents, trends: computeTrends(db, days) };
}

function buildPrompt(periodLabel, { changelog, topics, recentNotes, topContents, trends }) {
  const changelogBlock = changelog.length
    ? changelog.map(c => `- [${c.created_at.slice(0, 10)}]「${c.topic_name}」${c.change_type === 'conflict' ? '⚡' : ''}${c.summary}`).join('\n')
    : '（本期没有主题页修订）';

  const topicsBlock = topics.length
    ? topics.map(t => {
        let cur = '';
        try { cur = (JSON.parse(t.body || '{}').current || '').slice(0, 100); } catch { /* 空 */ }
        return `- [${t.id}]「${t.name}」（${t.evolution_phase}）${cur}`;
      }).join('\n')
    : '（暂无主题页）';

  const notesBlock = recentNotes.length
    ? recentNotes.map(n => `- [${n.id}] ${(n.excerpt || '').replace(/\n/g, ' ').slice(0, 80)}（${n.source_title || '未知来源'}）`).join('\n')
    : '（本期没有新素材）';

  // 每条本地趋势带 T1/T2… 编号：LLM 只做"提炼成人话主题"，
  // 输出必须引用 srcKeys 回指原始关键词——这样文章 id、真实次数都能在本地回填，不经 LLM 转手
  const trendsBlock = trends.length
    ? trends.map((t, i) => `- [T${i + 1}] ${t.direction === 'rising' ? '↗' : '↘'} ${t.theme}（本期出现在 ${t.thisCount} 篇 / 上期 ${t.prevCount} 篇）`).join('\n')
    : '（无明显变化）';

  const contentsBlock = topContents.map(c => `- [${c.id}] ${(c.zh_title || '').slice(0, 60)}`).join('\n');

  return `你是一位 AI 领域资深内容策划兼知识库管理者，服务对象是一位独立开发者/AI产品经理/自媒体人。请基于他${periodLabel}的信息流与知识库活动，生成${periodLabel}报。

# 关键词热度变化（本期 vs 上期，本地统计，编号 T1/T2…）
${trendsBlock}

# 主题页修订记录（知识库同化时间线）
${changelogBlock}

# 现有主题页
${topicsBlock}

# 本期新增素材卡片
${notesBlock}

# 本期热门内容
${contentsBlock}

请输出 JSON（不要 markdown 代码块）：
{
  "summary": "80字内的本期导语：最重要的动向和判断",
  "trends": [
    { "srcKeys": ["T1"], "theme": "主题名（把 srcKeys 指向的关键词提炼成人话主题，如'上下文工程'；相近关键词可合并进同一条）", "evidence": "一句话依据" }
  ],
  "pageChanges": [
    { "topicId": "主题页id", "topicName": "主题页名", "summary": "本期该主题页认知发生了什么变化（基于修订记录）", "conflict": false }
  ],
  "emergent": {
    "newTopics": [ { "name": "建议新建的主题页名", "why": "为什么值得建页（素材/热度依据）", "contentIds": ["支撑的热门内容id"], "noteIds": ["支撑的素材卡片id"] } ],
    "links": [ { "text": "跨主题关联发现，如'A 主题的 X 观点与 B 主题的 Y 趋势互为因果'", "topicIds": ["涉及的主题页id"], "contentIds": [], "noteIds": [] } ],
    "conflicts": [ { "text": "矛盾预警：素材或主题页间互相冲突、值得跟进验证的论断", "contentIds": [], "noteIds": [] } ]
  },
  "ideas": [
    {
      "title": "选题标题",
      "angle": "切入角度",
      "whyNow": "为什么是现在",
      "consensus": ["共识点"],
      "nonConsensus": ["争议点"],
      "contentIds": ["外部支撑：来自「本期热门内容」方括号里的真实id（他可能没注意到的行业热点）"],
      "noteIds": ["个人支撑：来自「本期新增素材卡片」方括号里的真实id（他素材厚/有立场的地方）"]
    }
  ]
}

要求：
- trends 3-6 条，宁缺毋滥，srcKeys 必须来自上面的 T 编号；pageChanges 只写真有修订的主题页
- emergent.newTopics 只在素材/热度确实支撑时建议（0-3 个），不硬凑；links 和 conflicts 同理
- emergent 里每条建议都必须给出支撑依据的 contentIds / noteIds（谁支撑它就引谁，没有依据的建议不要写）
- ideas 出 1-3 个"跨越单日热点的深度选题"（这是${periodLabel}报，不是日报）；取材两头都要兼顾：
  既有他可能没注意到的行业热点（引 contentIds），也有他素材厚/已有立场的方向（引 noteIds）——
  最好的选题是"外部热点 × 他的独特积累"的交叉点。每条尽量同时给 contentIds 和 noteIds
- 描述素材被同化进主题页时，统一用「收进」，不要用「并入」
- id 必须来自方括号里的真实 id，不得编造；全部用中文`;
}

export async function generatePeriodReport(periodType = 'weekly') {
  if (!['weekly', 'monthly'].includes(periodType)) {
    throw new Error(`invalid periodType: ${periodType}（日报走 generateDailyReport）`);
  }
  const days = periodType === 'weekly' ? 7 : 30;
  const periodLabel = periodType === 'weekly' ? '周' : '月';

  const db = getDatabase();
  const inputs = gatherInputs(db, days);

  if (!inputs.changelog.length && !inputs.recentNotes.length && !inputs.topContents.length) {
    db.close();
    return { success: false, error: `近${days}天没有足够活动（无内容/素材/主题页修订），无法生成${periodLabel}报` };
  }

  // temperature 0：同样的数据重新生成应得到基本相同的报告（2026-07-16 反馈 #1）
  const result = await chat([{ role: 'user', content: buildPrompt(periodLabel, inputs) }], 'deepseek', null, { temperature: 0 });
  if (!result.success) { db.close(); return { success: false, error: `LLM 调用失败: ${result.error}` }; }

  let parsed;
  try {
    const cleaned = result.content.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    db.close();
    return { success: false, error: `LLM 返回的不是合法 JSON: ${result.content.slice(0, 200)}` };
  }

  const validContentIds = new Set(inputs.topContents.map(c => c.id));
  const validNoteIds = new Set(inputs.recentNotes.map(n => n.id));
  const validTopicIds = new Set(inputs.topics.map(t => t.id));
  const sanitizeIds = ids => (Array.isArray(ids) ? ids.filter(id => validContentIds.has(id)) : []);
  const sanitizeNoteIds = ids => (Array.isArray(ids) ? ids.filter(id => validNoteIds.has(id)) : []);
  const sanitizeTopicIds = ids => (Array.isArray(ids) ? ids.filter(id => validTopicIds.has(id)) : []);

  // 动向回填（反馈 #1#2 核心）：LLM 只负责起"人话主题名"，方向/次数/文章 id
  // 全部从本地统计的 srcKeys 回填——报告里的数字和链接不经 LLM 转手，可点可验证
  const trendByKey = new Map(inputs.trends.map((t, i) => [`T${i + 1}`, t]));
  let finalTrends = (Array.isArray(parsed.trends) ? parsed.trends : []).map(t => {
    const keys = (Array.isArray(t.srcKeys) ? t.srcKeys : []).filter(k => trendByKey.has(k));
    if (!keys.length) return null;
    const srcs = keys.map(k => trendByKey.get(k));
    return {
      theme: String(t.theme || srcs[0].theme),
      direction: srcs[0].direction,
      evidence: String(t.evidence || ''),
      terms: srcs.map(s => ({ term: s.theme, direction: s.direction, thisCount: s.thisCount, prevCount: s.prevCount })),
      contentIds: [...new Set(srcs.flatMap(s => s.contentIds || []))].slice(0, 10),
    };
  }).filter(Boolean);
  // LLM 没按 srcKeys 输出时兜底：本地统计直出（宁可名字生硬，不能没有证据链）
  if (!finalTrends.length && inputs.trends.length) {
    finalTrends = inputs.trends.map(s => ({
      theme: s.theme, direction: s.direction,
      evidence: `关键词「${s.theme}」本期出现在 ${s.thisCount} 篇内容 / 上期 ${s.prevCount} 篇`,
      terms: [{ term: s.theme, direction: s.direction, thisCount: s.thisCount, prevCount: s.prevCount }],
      contentIds: s.contentIds || [],
    }));
  }

  // 涌现建议同样要可溯源：id 经合法性清洗（防 LLM 编造），旧字符串格式兼容为 {text}
  const cleanEmergentItem = (item) => ({
    ...(item.name !== undefined ? { name: String(item.name || ''), why: String(item.why || '') } : { text: String(item.text || item || '') }),
    topicIds: sanitizeTopicIds(item.topicIds),
    contentIds: sanitizeIds(item.contentIds),
    noteIds: sanitizeNoteIds(item.noteIds),
  });

  const periodKey = periodKeyOf(periodType);
  const reportId = randomUUID();

  db.exec('BEGIN');
  try {
    const old = db.prepare('SELECT id FROM reports WHERE period_type = ? AND period_key = ?').get(periodType, periodKey);
    if (old) {
      db.prepare("DELETE FROM ideas WHERE report_id = ? AND status = 'suggested'").run(old.id);
      db.prepare('DELETE FROM reports WHERE id = ?').run(old.id);
    }

    db.prepare(`
      INSERT INTO reports (id, period_type, period_key, summary, focus, trends, page_changes, emergent, tokens, cost_yuan)
      VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?)
    `).run(
      reportId, periodType, periodKey,
      parsed.summary || '',
      JSON.stringify(finalTrends),
      JSON.stringify((parsed.pageChanges || []).filter(p => validTopicIds.has(p.topicId)).map(p => ({
        topicId: p.topicId, topicName: String(p.topicName || ''), summary: String(p.summary || ''), conflict: !!p.conflict,
      }))),
      JSON.stringify({
        newTopics: (parsed.emergent?.newTopics || []).slice(0, 3).map(cleanEmergentItem),
        links: (parsed.emergent?.links || []).slice(0, 5).map(cleanEmergentItem),
        conflicts: (parsed.emergent?.conflicts || []).slice(0, 5).map(cleanEmergentItem),
      }),
      result.tokens || 0,
      result.cost || 0
    );

    const insertIdea = db.prepare(`
      INSERT INTO ideas (id, report_id, title, angle, why_now, consensus, non_consensus, supporting_content_ids, supporting_note_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const idea of parsed.ideas || []) {
      if (!idea.title) continue;
      insertIdea.run(
        randomUUID(), reportId, idea.title, idea.angle || '', idea.whyNow || '',
        JSON.stringify(idea.consensus || []), JSON.stringify(idea.nonConsensus || []),
        JSON.stringify(sanitizeIds(idea.contentIds)),
        JSON.stringify(sanitizeNoteIds(idea.noteIds))
      );
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }
  db.close();

  const { getLatestReport } = await import('./report-generation.js');
  const report = getLatestReport(periodType);
  console.log(`✅ ${periodType} report generated: ${periodKey} (${report?.ideas?.length ?? 0} ideas, ¥${result.cost?.toFixed(4)})`);
  return { success: true, data: report };
}
