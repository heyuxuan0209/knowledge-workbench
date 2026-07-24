import dotenv from 'dotenv'; dotenv.config();
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';
import { pathToFileURL } from 'url';
import { resolve } from 'path';
import { getDatabase } from './init.js';
import { embedBatch, cosine } from '../services/embeddings.js';
import { backfillMissingSummaries } from '../services/summary-backfill.js';

// 错位存量回扫（P1 §六 返工①）：老 title/summary 互串 bug（及"派早报/聚合"类 RSS 把别条正文当摘要）
// 留下一批"标题讲 A、摘要讲 B"的错位条，污染事件簇（无关条入簇、甚至抢主条）。
// 检测：对每条分别嵌入 title 与 zh_summary，二者语义应一致（同一篇的标题与摘要余弦高）；
// 实测错位对 cos≈0.35-0.41、正常对 ≥0.72 → 阈值 0.5 干净分开。
// 修复：命中的 id 交给 backfillMissingSummaries 定向重生成（抓真正文→出新摘要→清 embedding 让簇重算）。
//
// 用法：node src/db/rescan-summary-mismatch.js [--dry] [--days N] [--threshold 0.5]

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };

export async function rescanMismatchedSummaries({ days = 31, threshold = 0.5, dry = false } = {}) {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, COALESCE(zh_title, en_title) AS title, zh_summary AS summary
    FROM contents
    WHERE source_app != 'github_trending'
      AND content_type != 'video'   -- 视频标题多为隐喻/口播式，与描述性摘要天然低余弦，非错位（排除假阳）
      AND zh_summary IS NOT NULL AND length(trim(zh_summary)) >= 10
      AND COALESCE(zh_title, en_title) IS NOT NULL
      AND datetime(COALESCE(published_at, created_at)) > datetime('now', '-${days} days')
  `).all();
  db.close();
  if (!rows.length) return { scanned: 0, mismatched: 0, fixed: 0 };

  // 分别嵌入标题与摘要（批量），算一致性余弦
  const titleVecs = await embedBatch(rows.map(r => r.title));
  const sumVecs = await embedBatch(rows.map(r => r.summary));
  const mismatched = [];
  for (let i = 0; i < rows.length; i++) {
    const c = cosine(titleVecs[i], sumVecs[i]);
    if (c < threshold) mismatched.push({ id: rows[i].id, cos: c, title: rows[i].title });
  }
  mismatched.sort((a, b) => a.cos - b.cos);
  console.log(`🔎 扫描 ${rows.length} 条，发现 ${mismatched.length} 条标题-摘要错位（cos<${threshold}）：`);
  for (const m of mismatched.slice(0, 20)) console.log(`   ${m.cos.toFixed(3)} ${m.id.slice(0, 14)} — ${m.title.slice(0, 34)}`);
  if (dry || !mismatched.length) return { scanned: rows.length, mismatched: mismatched.length, fixed: 0 };

  // 定向重生成（抓真正文，分批走 backfill；每轮 10 条防打爆）
  const ids = mismatched.map(m => m.id);
  let fixed = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const r = await backfillMissingSummaries({ ids: ids.slice(i, i + 10), limit: 10 });
    fixed += r.summarized;
  }
  console.log(`✅ 错位回扫：重生成 ${fixed}/${mismatched.length} 条（已清 embedding，下次聚簇按新摘要重算）`);
  return { scanned: rows.length, mismatched: mismatched.length, fixed };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
  rescanMismatchedSummaries({
    days: parseInt(arg('--days', '31')),
    threshold: parseFloat(arg('--threshold', '0.5')),
    dry: process.argv.includes('--dry'),
  }).then(r => { console.log(JSON.stringify(r)); process.exit(0); });
}
