// M4 创作层迁移（docs/PRODUCT-DESIGN-V2.md M4 / 数据模型 §四 Draft 实体）
// drafts 表 —— 稿件：平台分化（thread/长文/口播脚本）+ 段落级素材引用（溯源）+
// 生成来源回链（topic/idea/content，创作飞轮的出处链）。
//
// 幂等：可重复执行。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM4() {
  const db = new DatabaseSync(DB_PATH);

  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS drafts (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL
              CHECK (platform IN ('thread', 'long', 'script')),
          title TEXT,                          -- 稿件标题（长文/脚本有，thread 可空）
          body TEXT NOT NULL DEFAULT '',       -- 草稿正文（Markdown / 分条文本）
          paragraph_refs TEXT DEFAULT '[]',    -- JSON: [{marker, noteId, sourceTitle, contentId}] 段落级溯源
          source_kind TEXT
              CHECK (source_kind IN ('topic', 'idea', 'content', 'manual')),
          source_id TEXT,                      -- 生成来源（活页/选题/内容）id，manual 时为空
          source_label TEXT,                   -- 冗余显示名（来源被删仍可读）
          status TEXT DEFAULT 'draft'
              CHECK (status IN ('draft', 'final', 'exported')),
          tokens INTEGER DEFAULT 0,
          cost_yuan REAL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_drafts_updated ON drafts(updated_at DESC);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_drafts_platform ON drafts(platform);');

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  const counts = { drafts: db.prepare('SELECT COUNT(*) c FROM drafts').get().c };
  db.close();
  console.log('✅ M4 migration done:', counts);
  return counts;
}

// 路径含中文目录，不能用 import.meta.url === `file://${argv[1]}` 判断入口（百分号编码问题）
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM4();
}
