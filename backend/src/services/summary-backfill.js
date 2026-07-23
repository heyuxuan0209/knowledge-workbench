import { getDatabase } from '../db/init.js';
import { batchSummarize, fetchFirstParagraph } from './ai-relevance.js';

// 摘要兜底（P1 层1，PRODUCT-REVIEW 5.4）：有些 RSS（Anthropic/OpenAI 官网这类）不带
// description → zh_summary 为 null → 资讯列表只剩光杆标题，好内容静默被埋。
// 同步后异步跑：挑"有正文链接却没摘要"的条目，抓正文首段让 DeepSeek 出一句话摘要。
// 抓不到正文时 batchSummarize 会退化为"基于标题保守概括"（仍胜过纯标题）。
// 排序优先关注源 + 最新；每轮限量控成本，跑不完下轮续（不阻塞同步）。
// 配对靠 batchSummarize 的按序号绑定（2026-07-23 修的铁律），绝不错位。
// 注：trust tier（P1 层2）落地后可把"关注源优先"升级为"关注源/T1 官源优先"。
export async function backfillMissingSummaries({ limit = 30, batchSize = 10 } = {}) {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT c.id, COALESCE(c.zh_title, c.en_title) AS title, c.url,
           COALESCE(s.registered_by_user, 0) AS followed
    FROM contents c
    LEFT JOIN sources s ON c.source_id = s.id
    WHERE (c.zh_summary IS NULL OR c.zh_summary = '')
      AND c.url IS NOT NULL AND c.url != ''
      AND c.source_app != 'github_trending'   -- 项目区有独立摘要路径
    ORDER BY followed DESC,
             datetime(COALESCE(c.published_at, c.created_at)) DESC
    LIMIT ?
  `).all(limit);
  db.close();
  if (!rows.length) return { summarized: 0, total: 0 };

  const wdb = getDatabase();
  const upd = wdb.prepare("UPDATE contents SET zh_summary = ?, updated_at = datetime('now') WHERE id = ?");
  let summarized = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    // 抓正文首段（并行、失败静默）；抓不到就交给标题兜底
    const excerpts = await Promise.all(
      batch.map(r => fetchFirstParagraph(r.url, 8000).catch(() => null))
    );
    const summaries = await batchSummarize(
      batch.map((r, j) => ({ id: r.id, title: r.title, excerpt: excerpts[j] }))
    );
    for (const r of batch) {
      const s = summaries.get(r.id);
      if (s) { upd.run(s, r.id); summarized++; }
    }
  }
  wdb.close();
  return { summarized, total: rows.length };
}
