import { getDatabase } from '../db/init.js';
import { batchSummarize } from './ai-relevance.js';
import { officialDomainTier } from './trust-tier.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

// 摘要兜底（P1 层1，PRODUCT-REVIEW 5.4 / P1-ACCEPTANCE §二）：
// Anthropic/OpenAI 官网这类 RSS（T1 一手）常只给光杆标题或极短 description（实测 31 天内
// 17/58 条摘要缺失或 <30 字）→ 资讯列表读不出讲了啥，好内容静默被埋。
//
// 修法（验收要求"抓正文生成、不是标题复读"）：对 T1/关注源里"没摘要或太短(<30字)"的条目，
// 走真实正文抓取链路 resolveContentBody（ingestUrl 直抓→Jina 兜底，出网过全局代理，翻译并缓存
// 进 contents.zh_body），拿正文首段让 DeepSeek 出 ≥50 字真摘要。每轮限量防打爆；跑不完下轮续。
// 配对靠 batchSummarize 按序号绑定不错位（2026-07-23 铁律）。
//
// 范围只挑 T1/T1.5/关注源：这些是"值得花抓取成本"的一手源；泛 T2 噪音不在内（控成本）。

const SHORT_THRESHOLD = 30;   // 摘要 < 30 字视为"太短、需重做"（验收清单样本最长 28 字）
const MIN_SUMMARY_LEN = 50;   // 目标：真摘要 ≥50 字

export async function backfillMissingSummaries({ limit = 10, ids = null } = {}) {
  const { resolveContentBody } = await import('./content-body-resolver.js');
  const db = getDatabase();
  // ids 指定：定向补这几条（验收样本用）。否则按范围挑：
  // RSS 文章多无 source_id（sync-rss 无 creator 时不建源）→ 拿不到 s.trust_tier，
  // 故范围用 source_app='rss'（用户自配的一手/关注 feed）兜住 + 有档/关注源。URL 官方域名优先。
  const all = ids?.length
    ? db.prepare(`SELECT c.id, c.content_type, c.url, c.zh_title, c.en_title, c.zh_summary, c.zh_body,
                         c.published_at, c.created_at, 'T2' AS trust_tier, 0 AS followed
                  FROM contents c WHERE c.id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : db.prepare(`
    SELECT c.id, c.content_type, c.url, c.zh_title, c.en_title, c.zh_summary, c.zh_body,
           c.published_at, c.created_at,
           COALESCE(s.trust_tier, 'T2') AS trust_tier, COALESCE(s.registered_by_user, 0) AS followed
    FROM contents c
    LEFT JOIN sources s ON c.source_id = s.id
    WHERE c.source_app != 'github_trending'
      AND c.url IS NOT NULL AND c.url != ''
      AND (c.source_app = 'rss' OR s.trust_tier IN ('T1','T1.5') OR s.registered_by_user = 1)
      AND (c.zh_summary IS NULL OR length(trim(c.zh_summary)) < ${SHORT_THRESHOLD})
  `).all();
  db.close();
  if (!all.length) return { summarized: 0, total: 0 };
  // 官方一手域名（T1）优先 → 关注源 → 最新；再截前 limit 条（每轮限量防打爆）
  const rank = r => (officialDomainTier(r.url) === 'T1' ? 0 : r.trust_tier === 'T1' || r.trust_tier === 'T1.5' ? 1 : r.followed ? 2 : 3);
  const rows = all
    .sort((a, b) => rank(a) - rank(b) ||
      (b.published_at || b.created_at || '').localeCompare(a.published_at || a.created_at || ''))
    .slice(0, limit);

  // 逐条抓正文（resolveContentBody 内部 40s 超时 + Jina 兜底 + 缓存；失败降级用原摘要/标题）
  const withBody = [];
  for (const r of rows) {
    let excerpt = '';
    try {
      const res = await resolveContentBody({
        id: r.id, content_type: r.content_type || 'article', url: r.url,
        zh_summary: r.zh_summary, zh_body: r.zh_body,
      });
      if (res.isFullText && res.body) excerpt = res.body.replace(/\s+/g, ' ').trim().slice(0, 800);
    } catch { /* 抓取失败 → 交给标题兜底 */ }
    withBody.push({ id: r.id, title: r.zh_title || r.en_title || '', excerpt });
  }

  // 拿真正文让模型写摘要（真正文喂进去通常 ≥50，抓不到正文的退化为标题概括）。
  // 分 5 条一批：正文摘录长（每条 ~800 字），一次塞 10+ 条会让响应过长、易漏/解析失败。
  const summaries = new Map();
  for (let i = 0; i < withBody.length; i += 5) {
    const part = await batchSummarize(withBody.slice(i, i + 5));
    for (const [k, v] of part) summaries.set(k, v);
  }
  const wdb = getDatabase();
  // 连带清掉 embedding：摘要变长了，向量得按新文本重算（否则事件簇仍用旧的标题+短摘要向量）
  const upd = wdb.prepare("UPDATE contents SET zh_summary = ?, embedding = NULL, embedding_model = NULL, updated_at = datetime('now') WHERE id = ?");
  let summarized = 0, short = 0;
  for (const it of withBody) {
    const s = summaries.get(it.id);
    if (s && s.length >= MIN_SUMMARY_LEN) { upd.run(s, it.id); summarized++; }
    else if (s) { upd.run(s, it.id); summarized++; short++; }   // 仍写入（比旧的更长），记短数
  }
  wdb.close();
  console.log(`[摘要兜底] 补 ${summarized}/${rows.length} 条${short ? `（其中 ${short} 条 <${MIN_SUMMARY_LEN} 字，多为抓不到正文的标题概括）` : ''}`);
  return { summarized, total: rows.length, short };
}

// CLI：node src/services/summary-backfill.js [轮数]
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  (await import('dotenv')).default.config();
  // 标准运行时代理由 server.js 挂；独立 CLI 得自己挂，否则 openai.com/anthropic.com 出网抓不到
  const { setGlobalDispatcher, EnvHttpProxyAgent } = await import('undici');
  setGlobalDispatcher(new EnvHttpProxyAgent());
  const rounds = parseInt(process.argv[2]) || 6;
  for (let i = 0; i < rounds; i++) {
    const r = await backfillMissingSummaries({ limit: 10 });
    console.log(`round ${i + 1}: ${JSON.stringify(r)}`);
    if (r.total === 0) break;
  }
  process.exit(0);
}
