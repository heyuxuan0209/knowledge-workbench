// M18 迁移（2026-07-23 · P1 层2 · ADR-040）：sources 补 trust_tier 信任分层。
//
// 与 track_mode（抓取深度，ADR-007）正交：trust_tier 是"可信/权威"，喂给
// 资讯降维的事件簇选主条（官方 > 官方号 > KOL）与今日必看理由（T1 官方一手）。
// 三档 T1 / T1.5 / T2，默认 T2（保守，宁可少给高信任）。
// 既有源用 classifyTrustTier 启发式回填（域名/名号/账号白名单），命中不了落 T2。
// 幂等：列已存在则跳过 ALTER，仍回填一次（把 NULL 补上）。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';
import { classifyTrustTier } from '../services/trust-tier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM18() {
  const db = new DatabaseSync(DB_PATH);

  const cols = db.prepare('PRAGMA table_info(sources)').all();
  const hasCol = cols.some(c => c.name === 'trust_tier');
  if (!hasCol) {
    db.exec(`ALTER TABLE sources ADD COLUMN trust_tier TEXT DEFAULT 'T2'
             CHECK (trust_tier IN ('T1','T1.5','T2'))`);
    console.log('✅ M18: sources.trust_tier 列已添加');
  } else {
    console.log('ℹ️  M18: trust_tier 列已存在，仅回填 NULL');
  }

  // 回填：拿每个源的一个平台身份（handle/platform）+ 名称/类型跑分类器
  const rows = db.prepare(`
    SELECT s.id, s.source_type, s.display_name, s.trust_tier,
           sp.platform AS platform, sp.handle AS handle
    FROM sources s
    LEFT JOIN source_platforms sp ON sp.source_id = s.id
    GROUP BY s.id
  `).all();

  const upd = db.prepare('UPDATE sources SET trust_tier = ? WHERE id = ?');
  const counts = { T1: 0, 'T1.5': 0, T2: 0 };
  let changed = 0;
  for (const r of rows) {
    const tier = classifyTrustTier({
      sourceType: r.source_type, platform: r.platform,
      handle: r.handle, displayName: r.display_name,
    });
    counts[tier]++;
    if (r.trust_tier !== tier) { upd.run(tier, r.id); changed++; }
  }
  db.close();
  console.log(`✅ M18: 回填 trust_tier ${changed}/${rows.length} 条 —— T1:${counts.T1} · T1.5:${counts['T1.5']} · T2:${counts.T2}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  migrateM18();
}
