import { getDb } from '../db/db.js';
import { extractKeywords } from './keyword-extractor.js';

// 为数据库中缺少关键词的文章提取关键词
export async function backfillKeywords(limit = 10) {
  const db = getDb();

  // 查询缺少关键词的文章
  const items = db.prepare(`
    SELECT id, title, summary
    FROM items
    WHERE extracted_keywords IS NULL
    LIMIT ?
  `).all(limit);

  if (items.length === 0) {
    console.log('✅ All items already have keywords');
    return { success: true, updated: 0 };
  }

  console.log(`🔄 Extracting keywords for ${items.length} items...`);

  const updateStmt = db.prepare(`
    UPDATE items
    SET extracted_keywords = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  let updated = 0;

  for (const item of items) {
    const keywords = await extractKeywords(item.title, item.summary);

    if (keywords) {
      updateStmt.run(keywords, item.id);
      updated++;
      console.log(`  ✓ ${item.title.substring(0, 40)}... → ${keywords}`);
    }

    // 延迟 500ms 避免 API 限流
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`✅ Updated ${updated}/${items.length} items with keywords`);

  return {
    success: true,
    updated,
    total: items.length
  };
}

// 如果直接运行此脚本，提取前 20 条
if (import.meta.url === `file://${process.argv[1]}`) {
  const limit = parseInt(process.argv[2]) || 20;
  backfillKeywords(limit).then(result => {
    console.log('Result:', result);
    process.exit(result.success ? 0 : 1);
  });
}
