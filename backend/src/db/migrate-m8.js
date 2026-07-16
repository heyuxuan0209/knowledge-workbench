// M8 迁移（2026-07-16 创作层 P1 prompt 文件化配套）
// drafts.platform 去掉 CHECK (platform IN ('thread','long','script'))——
// 平台清单的唯一来源已收敛到 reference/prompts/creation/platforms/ 目录
// （creation-prompts.js getPlatform 在服务层校验，ADR-017 单一来源纪律）。
// schema 里再持有一份枚举 = 每加一个平台文件都要迁移一次，违背"加文件=加平台"。
// source_kind / status 的 CHECK 保留：那是程序状态机枚举，不是用户可扩展的清单。
//
// SQLite 不支持 DROP CONSTRAINT，走标准表重建；幂等：CHECK 已不在则跳过。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM8() {
  const db = new DatabaseSync(DB_PATH);

  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='drafts'").get()?.sql || '';
  if (!/platform\s+TEXT\s+NOT\s+NULL\s*CHECK/i.test(ddl.replace(/\n/g, ' '))) {
    console.log('✅ M8 migration skipped: drafts.platform 已无 CHECK 约束');
    db.close();
    return { rebuilt: false };
  }

  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE drafts_new (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          title TEXT,
          body TEXT NOT NULL DEFAULT '',
          paragraph_refs TEXT DEFAULT '[]',
          source_kind TEXT
              CHECK (source_kind IN ('topic', 'idea', 'content', 'manual')),
          source_id TEXT,
          source_label TEXT,
          status TEXT DEFAULT 'draft'
              CHECK (status IN ('draft', 'final', 'exported')),
          tokens INTEGER DEFAULT 0,
          cost_yuan REAL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO drafts_new SELECT * FROM drafts;
      DROP TABLE drafts;
      ALTER TABLE drafts_new RENAME TO drafts;
      CREATE INDEX IF NOT EXISTS idx_drafts_updated ON drafts(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_drafts_platform ON drafts(platform);
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  const count = db.prepare('SELECT COUNT(*) AS n FROM drafts').get().n;
  console.log(`✅ M8 migration done: drafts 表已重建（去 platform CHECK），存量 ${count} 条草稿完整保留`);
  db.close();
  return { rebuilt: true, drafts: count };
}

// 路径含中文目录，不能用 import.meta.url === `file://${argv[1]}` 判断入口（百分号编码问题）
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM8();
}
