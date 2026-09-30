import { rankCuratedCandidates, sourceKey } from './curation-policy.js';

export const CURATION_DECISIONS = new Set(['must_surface', 'acceptable', 'reject', 'either']);

export function parseCurationGoldJsonl(text) {
  const cases = [];
  const ids = new Set();
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let item;
    try { item = JSON.parse(line); }
    catch (error) { throw new Error(`第 ${index + 1} 行不是合法 JSON：${error.message}`); }
    if (!item.caseId || !item.candidate?.id) throw new Error(`第 ${index + 1} 行缺少 caseId 或 candidate.id`);
    if (ids.has(item.caseId)) throw new Error(`caseId 重复：${item.caseId}`);
    if (!CURATION_DECISIONS.has(item.decision)) throw new Error(`caseId ${item.caseId} 的 decision 无效：${item.decision}`);
    ids.add(item.caseId);
    cases.push(item);
  }
  if (!cases.length) throw new Error('金标集为空');
  return cases;
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function summarizeSlice(cases, selectedIds) {
  const must = cases.filter(item => item.decision === 'must_surface');
  const acceptable = cases.filter(item => item.decision === 'acceptable');
  const rejects = cases.filter(item => item.decision === 'reject');
  const selected = cases.filter(item => selectedIds.has(item.caseId));
  const selectedDecisive = selected.filter(item => item.decision !== 'either');
  const selectedPositive = selectedDecisive.filter(item => item.decision === 'must_surface' || item.decision === 'acceptable');
  return {
    cases: cases.length,
    mustSurface: must.length,
    acceptable: acceptable.length,
    rejects: rejects.length,
    selected: selected.length,
    mustSurfaceRecallAtK: ratio(must.filter(item => selectedIds.has(item.caseId)).length, must.length),
    precisionAtK: ratio(selectedPositive.length, selectedDecisive.length),
    rejectsSurfaced: rejects.filter(item => selectedIds.has(item.caseId)).length,
  };
}

export function evaluateCurationGold(cases, {
  limit = 12,
  now,
  split = 'all',
} = {}) {
  if (!Number.isFinite(now)) throw new Error('评测必须传入固定的 now 时间戳，避免新鲜度结果随运行日期漂移');
  const active = split === 'all' ? cases : cases.filter(item => (item.split || 'development') === split);
  if (!active.length) throw new Error(`split=${split} 没有评测样本`);

  const caseByCandidateId = new Map();
  for (const item of active) {
    if (caseByCandidateId.has(item.candidate.id)) throw new Error(`candidate.id 重复：${item.candidate.id}`);
    caseByCandidateId.set(item.candidate.id, item);
  }
  const ranked = rankCuratedCandidates(active.map(item => item.candidate), { limit, now });
  const selected = ranked.map(item => {
    const gold = caseByCandidateId.get(item.candidate.id);
    return {
      caseId: gold.caseId,
      decision: gold.decision,
      score: item.score,
      why: item.why,
      sourceKey: sourceKey(item.candidate),
    };
  });
  const selectedIds = new Set(selected.map(item => item.caseId));
  const strata = [...new Set(active.map(item => item.stratum || 'unclassified'))].sort();
  const reasonCoverage = ratio(selected.filter(item => Boolean(item.why?.trim())).length, selected.length);
  const sourceDiversity = ratio(new Set(selected.map(item => item.sourceKey)).size, selected.length);

  return {
    schemaVersion: 1,
    evaluatedAt: new Date(now).toISOString(),
    split,
    limit,
    metrics: {
      ...summarizeSlice(active, selectedIds),
      reasonCoverageAtK: reasonCoverage,
      sourceDiversityAtK: sourceDiversity,
    },
    byStratum: Object.fromEntries(strata.map(stratum => [
      stratum,
      summarizeSlice(active.filter(item => (item.stratum || 'unclassified') === stratum), selectedIds),
    ])),
    selected,
  };
}
