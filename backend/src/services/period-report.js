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
  if (periodType === 'monthly') return date.toISOString().slice(0, 7); // '2026-07'
  // ISO 周：'2026-W29'
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ---- 本地趋势：本期 vs 上期内容的关键词频次对比 ----

function keywordFreq(rows) {
  const freq = new Map();
  for (const r of rows) {
    for (const t of new Set(tokenize(`${r.zh_title || ''} ${r.en_title || ''} ${r.zh_summary || ''}`))) {
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  return freq;
}

// 返回 [{theme, direction, thisCount, prevCount}]，取变化最显著的各 5 个
function computeTrends(db, days) {
  const q = (from, to) => db.prepare(`
    SELECT zh_title, en_title, zh_summary FROM contents
    WHERE datetime(COALESCE(published_at, created_at)) > datetime('now', ?)
      AND datetime(COALESCE(published_at, created_at)) <= datetime('now', ?)
  `).all(from, to);

  const cur = keywordFreq(q(`-${days} days`, '+0 days'));
  const prev = keywordFreq(q(`-${days * 2} days`, `-${days} days`));

  const changes = [];
  for (const [term, c] of cur) {
    if (c < 3) continue; // 低频词噪音
    const p = prev.get(term) || 0;
    changes.push({ theme: term, thisCount: c, prevCount: p, delta: c - p, ratio: (c + 1) / (p + 1) });
  }
  const rising = changes.filter(x => x.ratio >= 1.5).sort((a, b) => b.delta - a.delta).slice(0, 5)
    .map(x => ({ theme: x.theme, direction: 'rising', thisCount: x.thisCount, prevCount: x.prevCount }));
  const coolingPool = [];
  for (const [term, p] of prev) {
    if (p < 3) continue;
    const c = cur.get(term) || 0;
    if ((p + 1) / (c + 1) >= 1.5) coolingPool.push({ theme: term, direction: 'cooling', thisCount: c, prevCount: p, delta: p - c });
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
    : '（本期没有活页修订）';

  const topicsBlock = topics.length
    ? topics.map(t => {
        let cur = '';
        try { cur = (JSON.parse(t.body || '{}').current || '').slice(0, 100); } catch { /* 空 */ }
        return `- [${t.id}]「${t.name}」（${t.evolution_phase}）${cur}`;
      }).join('\n')
    : '（暂无活页）';

  const notesBlock = recentNotes.length
    ? recentNotes.map(n => `- [${n.id}] ${(n.excerpt || '').replace(/\n/g, ' ').slice(0, 80)}（${n.source_title || '未知来源'}）`).join('\n')
    : '（本期没有新素材）';

  const trendsBlock = trends.length
    ? trends.map(t => `- ${t.direction === 'rising' ? '↗' : '↘'} ${t.theme}（本期 ${t.thisCount} 次 / 上期 ${t.prevCount} 次）`).join('\n')
    : '（无明显变化）';

  const contentsBlock = topContents.map(c => `- [${c.id}] ${(c.zh_title || '').slice(0, 60)}`).join('\n');

  return `你是一位 AI 领域资深内容策划兼知识库管理者，服务对象是一位独立开发者/AI产品经理/自媒体人。请基于他${periodLabel}的信息流与知识库活动，生成${periodLabel}报。

# 关键词热度变化（本期 vs 上期，本地统计）
${trendsBlock}

# 活页修订记录（知识库同化时间线）
${changelogBlock}

# 现有活页
${topicsBlock}

# 本期新增素材卡片
${notesBlock}

# 本期热门内容
${contentsBlock}

请输出 JSON（不要 markdown 代码块）：
{
  "summary": "80字内的本期导语：最重要的动向和判断",
  "trends": [
    { "theme": "主题名（把上面的关键词提炼成人话主题，如'上下文工程'）", "direction": "rising 或 cooling", "evidence": "一句话依据" }
  ],
  "pageChanges": [
    { "topicId": "活页id", "topicName": "活页名", "summary": "本期该活页认知发生了什么变化（基于修订记录）", "conflict": false }
  ],
  "emergent": {
    "newTopics": [ { "name": "建议新建的活页名", "why": "为什么值得立页（素材/热度依据）" } ],
    "links": [ "跨活页关联发现，如'A 活页的 X 观点与 B 活页的 Y 趋势互为因果'" ],
    "conflicts": [ "矛盾预警：素材或活页间互相冲突、值得跟进验证的论断" ]
  },
  "ideas": [
    {
      "title": "选题标题",
      "angle": "切入角度",
      "whyNow": "为什么是现在",
      "consensus": ["共识点"],
      "nonConsensus": ["争议点"],
      "contentIds": ["支撑内容id，来自上面方括号里的真实id"]
    }
  ]
}

要求：
- trends 3-6 条，宁缺毋滥；pageChanges 只写真有修订的活页
- emergent.newTopics 只在素材/热度确实支撑时建议（0-3 个），不硬凑；links 和 conflicts 同理
- ideas 出 1-3 个，偏"跨越单日热点的深度选题"（这是${periodLabel}报，不是日报）
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
    return { success: false, error: `近${days}天没有足够活动（无内容/素材/活页修订），无法生成${periodLabel}报` };
  }

  const result = await chat([{ role: 'user', content: buildPrompt(periodLabel, inputs) }]);
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
  const validTopicIds = new Set(inputs.topics.map(t => t.id));
  const sanitizeIds = ids => (Array.isArray(ids) ? ids.filter(id => validContentIds.has(id)) : []);

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
      JSON.stringify((parsed.trends || []).map(t => ({
        theme: String(t.theme || ''), direction: t.direction === 'cooling' ? 'cooling' : 'rising', evidence: String(t.evidence || ''),
      }))),
      JSON.stringify((parsed.pageChanges || []).filter(p => validTopicIds.has(p.topicId)).map(p => ({
        topicId: p.topicId, topicName: String(p.topicName || ''), summary: String(p.summary || ''), conflict: !!p.conflict,
      }))),
      JSON.stringify({
        newTopics: (parsed.emergent?.newTopics || []).slice(0, 3).map(t => ({ name: String(t.name || ''), why: String(t.why || '') })),
        links: (parsed.emergent?.links || []).slice(0, 5).map(String),
        conflicts: (parsed.emergent?.conflicts || []).slice(0, 5).map(String),
      }),
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
        randomUUID(), reportId, idea.title, idea.angle || '', idea.whyNow || '',
        JSON.stringify(idea.consensus || []), JSON.stringify(idea.nonConsensus || []),
        JSON.stringify(sanitizeIds(idea.contentIds))
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
