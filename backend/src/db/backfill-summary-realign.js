import dotenv from 'dotenv';
dotenv.config();

import { getDatabase } from './init.js';
import { batchSummarize } from '../services/ai-relevance.js';

// 存量回扫（配合 2026-07-23 title/summary 错位 bug 修复）：
// 病根——batchSummarize/filterRelevant 旧实现按数组下标 zip 回结果，LLM 漏/并/重排一条就整体错位一格，
// 相邻条目张冠李戴（Bilibili/X 相邻两条互串摘要）。管道已改为按 LLM 回带的序号 i 显式绑定。
// 但存量里已经错位的 zh_summary 无法反推正确归属，只能**从每条自己的 en 字段重生成**：
// en_title / en_summary 是逐条设置的（从不进批处理），是每条的真相源；只有 zh_summary 走了批处理会错位。
// 因此对"批摘要消费方"(hackernews / active_query) 且已有 zh_summary 的行，用修好的 batchSummarize
// 重新按 id 生成一遍 —— 无论原来是否错位，结果都保证和本行内容对齐。RSS 逐条翻译不错位，不在范围。
//
// 用法：
//   node src/db/backfill-summary-realign.js --dry   # 只统计、不写库
//   node src/db/backfill-summary-realign.js         # 实跑（会调 DeepSeek，成本约 ¥0.01 级）

const BATCH = 8;                                  // 小批降低 LLM 漏条概率（且漏条只会保留旧值、不会错位）
const SOURCE_APPS = ['hackernews', 'active_query']; // batchSummarize 的消费方；RSS 不在内（逐条翻译不错位）

async function run() {
  const dry = process.argv.includes('--dry');
  const db = getDatabase();
  const placeholders = SOURCE_APPS.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, source_app, zh_title, en_title, en_summary
    FROM contents
    WHERE source_app IN (${placeholders})
      AND zh_summary IS NOT NULL
    ORDER BY published_at DESC
  `).all(...SOURCE_APPS);

  console.log(`🔎 候选 ${rows.length} 条（批摘要消费方 ${SOURCE_APPS.join('/')}、已有 zh_summary）`);
  if (!rows.length) { db.close(); return; }

  const upd = db.prepare("UPDATE contents SET zh_summary = ?, updated_at = datetime('now') WHERE id = ?");
  const MAX_ROUNDS = 3;
  let pending = rows.slice();
  let fixed = 0;

  for (let round = 1; round <= MAX_ROUNDS && pending.length; round++) {
    const still = [];
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      let summaries = new Map();
      try {
        summaries = await batchSummarize(batch.map(r => ({
          id: r.id,
          title: r.zh_title || r.en_title || '',
          excerpt: r.en_summary || '', // 本行自己的原文摘录（真相源），空则 batchSummarize 按标题保守概括
        })));
      } catch (err) {
        console.error(`  第${round}轮 批${Math.floor(i / BATCH) + 1} 失败：${err.message}`);
      }
      for (const r of batch) {
        const s = summaries.get(r.id);
        if (s) { if (!dry) upd.run(s, r.id); fixed++; }
        else still.push(r); // 本轮没回 → 下一轮再试；始终保留旧值，绝不 blank
      }
    }
    console.log(`  第${round}轮：已对齐累计 ${fixed}/${rows.length}，剩 ${still.length} 条待重试`);
    if (still.length === pending.length) break; // 一整轮零进展 → 停（避免空转）
    pending = still;
  }

  db.close();
  console.log(`✅ ${dry ? '[dry] ' : ''}重新对齐 zh_summary ${fixed}/${rows.length} 条${pending.length ? `（${pending.length} 条多轮仍未回、保留旧值，可再跑一次）` : '（全部覆盖）'}`);
}

run().catch(err => { console.error('❌ 回扫失败:', err); process.exit(1); });
