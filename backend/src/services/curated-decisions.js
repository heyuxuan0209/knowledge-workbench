import { getDatabase } from '../db/init.js';
import { chat } from './llm.js';
import { resolveContentBody } from './content-body-resolver.js';
import { getCuratedCandidateRows, getCurated } from './curated.js';
import { rankCuratedCandidates } from './curation-policy.js';

export const CURATED_DECISION_PROMPT_VERSION = 1;
const VALID_VERDICTS = new Set(['deep', 'brief', 'exclude']);

export function extractDecisionJson(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export function evidenceFor(row) {
  const full = row.zh_body || row.raw_full_text || row.raw_transcript || row.raw_readme || '';
  if (String(full).trim().length >= 120) return { status: 'full', text: String(full).trim() };
  const summary = row.summ || row.en_summary || '';
  if (String(summary).trim().length >= 30) return { status: 'summary', text: String(summary).trim() };
  return { status: 'title_only', text: String(summary).trim() };
}

export function buildDecisionPrompt(items) {
  const list = items.map((item, index) => `
【${index}】标题：${item.title}
来源：${item.src || '未知'}
已有材料：${item.evidence.text.slice(0, 1600)}`).join('\n');

  return `你是严谨的中文科技内容编辑。请为下面每条内容写“阅读决策摘要”。

摘要的第一目标是把信息说完整，不是强行个性化，也不要提 Knowledge Workbench、KW 或“与你的项目有关”。
每条 120–200 字，必须尽可能包括：
1. 发生了什么；
2. 关键数字、对象或具体变化；
3. 原文的核心结论；
4. 限制、尚未开放、仅为榜单/单方说法等边界。

verdict 只能是：
- deep：信息重要且值得继续读原文；
- brief：摘要已经交付主要结论，知道即可；
- exclude：材料不足、纯宣传或无法可靠判断，不应占精选首页。

严禁根据标题编造细节；材料不足就判 exclude。不要写“本文介绍”“值得关注”这类空话。
必须按 i 回带，不能漏、不能换序。只输出 JSON：
{"items":[{"i":0,"summary":"...","verdict":"deep","reason":"一句话说明判断"}]}

${list}`;
}

function contexts(items) {
  return items.map(item => ({
    kind: 'content', id: item.id, label: item.title || '未命名资讯', url: item.url || null,
    target: 'curated_decision_summary',
  }));
}

async function enrichEvidence(row) {
  let evidence = evidenceFor(row);
  if (evidence.status !== 'title_only' || !row.url || !['article', 'paper'].includes(row.content_type)) {
    return { ...row, evidence };
  }
  try {
    const resolved = await resolveContentBody({
      id: row.id, content_type: row.content_type, url: row.url,
      zh_title: row.title, en_title: row.en_title, zh_summary: row.summ, zh_body: row.zh_body,
    });
    if (resolved.isFullText && resolved.body?.trim().length >= 120) {
      evidence = { status: 'full', text: resolved.body.trim() };
      const db = getDatabase();
      const latest = db.prepare('SELECT updated_at FROM contents WHERE id=?').get(row.id);
      db.close();
      row = { ...row, updated_at: latest?.updated_at || row.updated_at };
    }
  } catch { /* 失败后保持 title_only，后续明确排除 */ }
  return { ...row, evidence };
}

function writeDecision(db, row, decision) {
  db.prepare(`
    INSERT INTO curated_reading_decisions
      (content_id, prompt_version, source_updated_at, decision_summary, verdict, evidence_status, reason, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(content_id) DO UPDATE SET
      prompt_version=excluded.prompt_version,
      source_updated_at=excluded.source_updated_at,
      decision_summary=excluded.decision_summary,
      verdict=excluded.verdict,
      evidence_status=excluded.evidence_status,
      reason=excluded.reason,
      generated_at=datetime('now')
  `).run(
    row.id, CURATED_DECISION_PROMPT_VERSION, row.updated_at || null,
    decision.summary, decision.verdict, row.evidence.status, decision.reason || null,
  );
}

async function runRefreshCuratedDecisions({ limit = 12, poolSize = 18, background = true } = {}) {
  const rows = getCuratedCandidateRows();
  const candidates = rankCuratedCandidates(rows, { limit: Math.max(limit, poolSize) }).map(item => item.candidate);
  if (!candidates.length) return { generated: 0, excluded: 0, data: [] };

  const db = getDatabase();
  const cached = new Map(db.prepare(`
    SELECT content_id, prompt_version, source_updated_at
    FROM curated_reading_decisions
    WHERE content_id IN (${candidates.map(() => '?').join(',')})
  `).all(...candidates.map(item => item.id)).map(row => [row.content_id, row]));
  db.close();

  const stale = candidates.filter(row => {
    const hit = cached.get(row.id);
    return !hit || hit.prompt_version !== CURATED_DECISION_PROMPT_VERSION
      || String(hit.source_updated_at || '') !== String(row.updated_at || '');
  });
  const enriched = [];
  for (const row of stale) enriched.push(await enrichEvidence(row));

  let generated = 0;
  let excluded = 0;
  const titleOnly = enriched.filter(item => item.evidence.status === 'title_only');
  const titleDb = getDatabase();
  for (const row of titleOnly) {
    writeDecision(titleDb, row, {
      summary: '当前只取得标题或极短简介，没有足够正文、字幕或可靠摘要，无法确认具体论点、数字和证据。为避免根据标题补写内容，这条暂不进入精选首页。',
      verdict: 'exclude', reason: '只有标题，证据不足',
    });
    generated++; excluded++;
  }
  titleDb.close();

  const usable = enriched.filter(item => item.evidence.status !== 'title_only');
  for (let offset = 0; offset < usable.length; offset += 6) {
    const batch = usable.slice(offset, offset + 6);
    const result = await chat([{ role: 'user', content: buildDecisionPrompt(batch) }], 'deepseek', 'deepseek-v4-flash', {
      maxTokens: 3200, purpose: 'curated-decision-summary', background, contexts: contexts(batch),
    });
    if (!result.success) continue;
    const parsed = extractDecisionJson(result.content)?.items;
    if (!Array.isArray(parsed)) continue;
    const batchDb = getDatabase();
    for (const entry of parsed) {
      const row = Number.isInteger(entry?.i) ? batch[entry.i] : null;
      const summary = String(entry?.summary || '').trim();
      const verdict = String(entry?.verdict || '');
      if (!row || summary.length < 50 || !VALID_VERDICTS.has(verdict)) continue;
      writeDecision(batchDb, row, { summary, verdict, reason: String(entry?.reason || '').trim() });
      generated++;
      if (verdict === 'exclude') excluded++;
    }
    batchDb.close();
  }
  return { generated, excluded, data: getCurated(limit) };
}

let activeRefresh = null;
export function refreshCuratedDecisions(options = {}) {
  if (activeRefresh) return activeRefresh;
  activeRefresh = runRefreshCuratedDecisions(options).finally(() => { activeRefresh = null; });
  return activeRefresh;
}
