import dotenv from 'dotenv';
dotenv.config();

import { getDatabase } from '../db/init.js';
import { filterRelevant, batchSummarize, fetchFirstParagraph } from './ai-relevance.js';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolve } from 'path';

// 存量 Feed 清理（2026-07-14 用户决策，一次性脚本）：
// 1. HN/RSS 里与 AI/软件工程/科技产品无关的内容 → 物理删除（feed 数据可重新同步，非用户资产）
// 2. 保留下来但没有中文摘要的 → 抓原文首段补一句话摘要
// 素材卡片引用的 content 不删（notes.content_id 外键 ON DELETE SET NULL，但保守起见排除）。
// 星标内容也不删（2026-07-18 修 Bug2：migrate-m7 承诺"星标不被任何清理逻辑删除"，
// 但此处此前漏了 starred 排除——用户星标的 HN/RSS 文章会被相关性判定误删）。

export async function cleanupFeed() {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT c.id, COALESCE(c.zh_title, c.en_title) AS title, c.url, c.zh_summary
    FROM contents c
    WHERE c.source_app IN ('hackernews', 'rss')
      AND c.starred = 0
      AND c.id NOT IN (SELECT content_id FROM notes WHERE content_id IS NOT NULL)
  `).all();
  console.log(`📋 ${rows.length} HN/RSS contents to review`);
  if (rows.length === 0) { db.close(); return { deleted: 0, summarized: 0 }; }

  // 1. 相关性判断 → 删除无关
  const kept = await filterRelevant(rows.map(r => ({ id: r.id, title: r.title })));
  const toDelete = rows.filter(r => !kept.has(r.id));
  const delStmt = db.prepare('DELETE FROM contents WHERE id = ?');
  for (const r of toDelete) delStmt.run(r.id);
  console.log(`🗑  deleted ${toDelete.length} irrelevant contents:`);
  toDelete.slice(0, 10).forEach(r => console.log('   ·', r.title?.slice(0, 40)));

  // 2. 补摘要（每批 12 条，控制单次 prompt 长度）
  const needSummary = rows.filter(r => kept.has(r.id) && !r.zh_summary);
  console.log(`✍️  ${needSummary.length} contents missing zh_summary`);
  let summarized = 0;
  const updStmt = db.prepare("UPDATE contents SET zh_summary = ?, updated_at = datetime('now') WHERE id = ?");

  for (let i = 0; i < needSummary.length; i += 12) {
    const batch = needSummary.slice(i, i + 12);
    const excerpts = await Promise.all(batch.map(r => r.url ? fetchFirstParagraph(r.url, 8000) : null));
    const summaries = await batchSummarize(
      batch.map((r, j) => ({ id: r.id, title: r.title, excerpt: excerpts[j] }))
    );
    for (const r of batch) {
      const s = summaries.get(r.id);
      if (s) { updStmt.run(s, r.id); summarized++; }
    }
    console.log(`   batch ${Math.floor(i / 12) + 1}: +${batch.filter(r => summaries.get(r.id)).length}`);
  }

  db.close();
  console.log(`✅ cleanup done: deleted ${toDelete.length}, summarized ${summarized}`);
  return { deleted: toDelete.length, summarized };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  cleanupFeed().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
