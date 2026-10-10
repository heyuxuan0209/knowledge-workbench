import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db/init.js';
import { chat } from './llm.js';
import { diffReleaseText } from './release-diff.js';

const KEYS = new Set([
  'avoid_generic_opening', 'prefer_concise_explanations', 'require_personal_evidence',
  'require_source_attribution', 'preserve_original_voice', 'prefer_concrete_examples',
  'prefer_direct_conclusion', 'restructure_for_clarity', 'other',
]);

const parseJson = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const stripFence = text => String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
const parseObservation = row => ({ ...row, evidence: parseJson(row.evidence_json, []) });
const parseCandidate = row => ({ ...row, evidence: parseJson(row.evidence_json, []) });

async function defaultAnalyzer({ changes }) {
  const prompt = `你是编辑行为分析器。下面是同一篇作品两个关键版本之间的确定性差异。
只描述作者实际做出的编辑，不猜人格，不把主题事实当偏好。

从以下 preference_key 中选择：
avoid_generic_opening / prefer_concise_explanations / require_personal_evidence /
require_source_attribution / preserve_original_voice / prefer_concrete_examples /
prefer_direct_conclusion / restructure_for_clarity / other

输出严格 JSON：{"observations":[{"preferenceKey":"...","summary":"本次具体做了什么，中文≤40字","suggestedRule":"若以后确认成习惯，应如何表述，中文≤45字","evidence":["简短改前证据","简短改后证据"]}]}
最多 4 条。没有可靠编辑信号就输出 {"observations":[]}。不要把单次编辑说成长期习惯。

差异：
${JSON.stringify(changes).slice(0, 14000)}`;
  const result = await chat([{ role: 'user', content: prompt }], 'deepseek', 'deepseek-v4-flash', {
    maxTokens: 1200, purpose: 'editing-insight', contexts: [{ kind: 'release-diff', ref: 'explicit-user-request' }],
  });
  if (!result.success) throw new Error(result.error || '编辑分析失败');
  const parsed = JSON.parse(stripFence(result.content));
  return { observations: Array.isArray(parsed.observations) ? parsed.observations : [], cost: result.cost || 0 };
}

function readPair(db, workId, fromReleaseId, toReleaseId) {
  const from = db.prepare('SELECT * FROM artifact_releases WHERE id = ? AND work_id = ?').get(fromReleaseId, workId);
  const to = db.prepare('SELECT * FROM artifact_releases WHERE id = ? AND work_id = ?').get(toReleaseId, workId);
  if (!from || !to || from.id === to.id) throw new Error('请选择当前作品的两个不同 Release');
  return from.sequence < to.sequence ? { from, to } : { from: to, to: from };
}

function refreshCandidate(db, preferenceKey, platform, suggestedRule) {
  if (preferenceKey === 'other' || !platform) return null;
  const evidence = db.prepare(`
    SELECT id, work_id FROM edit_observations
    WHERE preference_key = ? AND platform = ? AND status = 'observed'
    ORDER BY created_at DESC
  `).all(preferenceKey, platform);
  const workCount = new Set(evidence.map(row => row.work_id)).size;
  if (workCount < 3) return null;
  const existing = db.prepare("SELECT * FROM preference_candidates WHERE preference_key = ? AND scope_type = 'platform' AND scope_value = ?").get(preferenceKey, platform);
  const evidenceIds = evidence.map(row => row.id);
  if (existing) {
    db.prepare("UPDATE preference_candidates SET rule_text = ?, distinct_work_count = ?, evidence_json = ?, updated_at = datetime('now') WHERE id = ?")
      .run(suggestedRule, workCount, JSON.stringify(evidenceIds), existing.id);
    return parseCandidate(db.prepare('SELECT * FROM preference_candidates WHERE id = ?').get(existing.id));
  }
  const id = randomUUID();
  db.prepare("INSERT INTO preference_candidates (id, preference_key, rule_text, scope_type, scope_value, distinct_work_count, evidence_json) VALUES (?, ?, ?, 'platform', ?, ?, ?)")
    .run(id, preferenceKey, suggestedRule, platform, workCount, JSON.stringify(evidenceIds));
  return parseCandidate(db.prepare('SELECT * FROM preference_candidates WHERE id = ?').get(id));
}

export async function analyzeEditPair({ workId, fromReleaseId, toReleaseId, analyzer = defaultAnalyzer }) {
  let db = getDatabase();
  const pair = readPair(db, workId, fromReleaseId, toReleaseId);
  const existing = db.prepare('SELECT * FROM edit_observations WHERE from_release_id = ? AND to_release_id = ? ORDER BY created_at').all(pair.from.id, pair.to.id);
  if (existing.length) {
    const keys = [...new Set(existing.map(row => row.preference_key).filter(key => key !== 'other'))];
    const platform = parseJson(pair.to.metadata_json, {}).platform || '';
    const candidates = keys.flatMap(key => db.prepare("SELECT * FROM preference_candidates WHERE preference_key = ? AND scope_type = 'platform' AND scope_value = ?").all(key, platform)).map(parseCandidate);
    db.close();
    return { observations: existing.map(parseObservation), candidates, action: 'unchanged', cost: 0 };
  }
  db.close();

  const diff = diffReleaseText(pair.from.content_snapshot, pair.to.content_snapshot);
  const changes = diff.groups.filter(group => group.type !== 'unchanged').map(group => {
    const trim = value => String(value).slice(0, 700);
    return group.type === 'changed'
      ? { type: 'changed', before: group.before.map(trim), after: group.after.map(trim) }
      : { type: group.type, lines: group.lines.map(trim) };
  });
  if (!changes.length) return { observations: [], candidates: [], action: 'no_changes', cost: 0 };
  const analysis = await analyzer({ changes, from: pair.from, to: pair.to });
  const clean = (analysis.observations || []).slice(0, 4).map(item => ({
    preferenceKey: KEYS.has(item.preferenceKey) ? item.preferenceKey : 'other',
    summary: String(item.summary || '').trim().slice(0, 120),
    suggestedRule: String(item.suggestedRule || '').trim().slice(0, 140),
    evidence: Array.isArray(item.evidence) ? item.evidence.slice(0, 4).map(value => String(value).slice(0, 240)) : [],
  })).filter(item => item.summary);

  db = getDatabase(); db.exec('BEGIN IMMEDIATE');
  try {
    const platform = parseJson(pair.to.metadata_json, {}).platform || null;
    const inserted = [];
    const candidates = [];
    for (const item of clean) {
      const id = randomUUID();
      db.prepare(`INSERT OR IGNORE INTO edit_observations (id, work_id, from_release_id, to_release_id, preference_key, summary, suggested_rule, evidence_json, platform) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, workId, pair.from.id, pair.to.id, item.preferenceKey, item.summary, item.suggestedRule || null, JSON.stringify(item.evidence), platform);
      const row = db.prepare('SELECT * FROM edit_observations WHERE from_release_id = ? AND to_release_id = ? AND preference_key = ?').get(pair.from.id, pair.to.id, item.preferenceKey);
      if (row) inserted.push(parseObservation(row));
      const candidate = refreshCandidate(db, item.preferenceKey, platform, item.suggestedRule || item.summary);
      if (candidate && !candidates.some(entry => entry.id === candidate.id)) candidates.push(candidate);
    }
    db.exec('COMMIT'); db.close();
    return { observations: inserted, candidates, action: 'created', cost: analysis.cost || 0 };
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
}

export function listEditObservations(workId) {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM edit_observations WHERE work_id = ? ORDER BY created_at DESC').all(workId).map(parseObservation);
  db.close(); return rows;
}

export function listPreferenceCandidates({ status = null } = {}) {
  const db = getDatabase();
  const rows = (status
    ? db.prepare('SELECT * FROM preference_candidates WHERE status = ? ORDER BY updated_at DESC').all(status)
    : db.prepare('SELECT * FROM preference_candidates ORDER BY updated_at DESC').all()).map(parseCandidate);
  db.close(); return rows;
}

export function updatePreferenceCandidate(id, { status, scopeType, scopeValue } = {}) {
  if (status && !['candidate', 'confirmed', 'rejected'].includes(status)) throw new Error('Unsupported preference status');
  if (scopeType && !['global', 'platform'].includes(scopeType)) throw new Error('Unsupported preference scope');
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM preference_candidates WHERE id = ?').get(id);
  if (!existing) { db.close(); return null; }
  db.prepare("UPDATE preference_candidates SET status = COALESCE(?, status), scope_type = COALESCE(?, scope_type), scope_value = COALESCE(?, scope_value), updated_at = datetime('now') WHERE id = ?")
    .run(status || null, scopeType || null, scopeValue ?? null, id);
  const row = parseCandidate(db.prepare('SELECT * FROM preference_candidates WHERE id = ?').get(id));
  db.close(); return row;
}

export function confirmedPreferenceBlock(platform) {
  const db = getDatabase();
  const rows = db.prepare("SELECT rule_text FROM preference_candidates WHERE status = 'confirmed' AND (scope_type = 'global' OR (scope_type = 'platform' AND scope_value = ?)) ORDER BY updated_at DESC").all(platform || '');
  db.close();
  return rows.length ? `\n\n【作者已确认的长期偏好】\n${rows.map(row => `- ${row.rule_text}`).join('\n')}` : '';
}
