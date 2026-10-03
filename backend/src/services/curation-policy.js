import { canonicalArticleIdentity } from './content-identity.js';

const isOfficial = tier => tier === 'T1' || tier === 'T1.5';

export function sourceKey(candidate) {
  return candidate.source_id || candidate.src || candidate.id;
}

// 不同采集入口（如 RSS 与 AI HOT）可能指向同一篇原文，却因摘要差异被上游聚簇拆开。
// 精选层以规范化原文 URL 再做一道硬去重，避免同一内容浪费首页名额。
export function canonicalArticleUrl(candidate) {
  const raw = candidate.url || candidate.permalink || '';
  return canonicalArticleIdentity(raw);
}

export function freshnessScore(created, now = Date.now()) {
  const normalized = /[zZ+]/.test(created || '')
    ? created
    : (created || '').replace(' ', 'T') + 'Z';
  const timestamp = new Date(normalized).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  const days = (now - timestamp) / 864e5;
  if (days < 2) return 18;
  if (days < 5) return 12;
  if (days < 10) return 6;
  return 0;
}

function normalizeMutes(mutes = {}) {
  const asSet = value => value instanceof Set ? value : new Set(value || []);
  return {
    sources: asSet(mutes.sources),
    contents: asSet(mutes.contents),
    categories: asSet(mutes.categories),
  };
}

export function explainCandidate(candidate, { now = Date.now() } = {}) {
  let score = freshnessScore(candidate.created_at, now);
  let why = 'AI 精选';
  if (candidate.sc && candidate.sc > 1) {
    score += 28 + candidate.sc * 2;
    why = `${candidate.sc} 源同报 · 今日热点`;
  } else if (isOfficial(candidate.tier)) {
    score += 18;
    why = '官方一手';
  }
  if (candidate.reg) {
    score += 22;
    if (!(candidate.sc > 1)) why = '你关注的一手源新作';
  }
  return { candidate, score, why };
}

// 线上精选与离线评测共用这一份透明策略，避免“评测一套、生产一套”。
export function rankCuratedCandidates(rows, {
  limit = 12,
  mutes = {},
  now = Date.now(),
} = {}) {
  const normalizedMutes = normalizeMutes(mutes);
  const scored = [];
  for (const candidate of rows) {
    if (normalizedMutes.contents.has(candidate.id)) continue;
    if (candidate.source_id && normalizedMutes.sources.has(candidate.source_id)) continue;
    if (candidate.category && normalizedMutes.categories.has(candidate.category)) continue;
    // 已成事件簇的非主条不再单独占精选位；主条承载多源事件。
    if (candidate.story_primary_id && candidate.story_primary_id !== candidate.id) continue;
    // 阅读层明确判为证据不足/纯宣传的内容不进入首页；未生成的旧数据仍可降级展示。
    if (candidate.decision_verdict === 'exclude') continue;
    scored.push(explainCandidate(candidate, { now }));
  }
  // Node 的 Array#sort 是稳定排序；同分时保留 SQL 的 created_at 倒序。
  scored.sort((a, b) => b.score - a.score);

  const selected = [];
  const seenSources = new Set();
  const seenArticles = new Set();
  for (const item of scored) {
    const key = sourceKey(item.candidate);
    const articleUrl = canonicalArticleUrl(item.candidate);
    if (seenSources.has(key)) continue;
    if (articleUrl && seenArticles.has(articleUrl)) continue;
    seenSources.add(key);
    if (articleUrl) seenArticles.add(articleUrl);
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function presentCuratedCandidate({ candidate: c, why }) {
  return {
    id: c.id,
    title: c.title,
    summary: (c.summ || '').slice(0, 220),
    decisionSummary: c.decision_summary || null,
    decisionVerdict: c.decision_verdict || null,
    decisionReason: c.decision_reason || null,
    evidenceStatus: c.evidence_status || null,
    src: c.src || 'AI HOT',
    sourceId: c.source_id,
    category: c.category,
    url: c.url,
    permalink: c.permalink,
    why,
    badge: c.sc > 1
      ? { t: `${c.sc} 源同报`, cls: 'cl' }
      : (isOfficial(c.tier)
          ? { t: '官方一手', cls: 'of' }
          : (c.reg ? { t: '你登记的源', cls: 'rg' } : null)),
    pub: (c.published_at || c.created_at || '').slice(0, 10),
  };
}
