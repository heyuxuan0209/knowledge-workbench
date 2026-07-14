// M2 洞察层迁移（docs/PRODUCT-DESIGN-V2.md M2 / DECISIONS.md ADR-008）
// 1. reports 表 —— 日报/周报/月报（节奏化简报，不实时刷新）
// 2. ideas 表 —— 选题（角度 + 为什么是现在 + 共识/非共识 + 支撑素材）
// 3. contents.tags —— 复用 AI HOT 的标签（category / 精选），Feed 卡片展示用
//
// 幂等：可重复执行。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM2() {
  const db = new DatabaseSync(DB_PATH);

  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);

  db.exec('BEGIN');
  try {
    // ---- 1. reports 简报 ----
    db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
          id TEXT PRIMARY KEY,
          period_type TEXT NOT NULL
              CHECK (period_type IN ('daily', 'weekly', 'monthly')),
          period_key TEXT NOT NULL,           -- '2026-07-14' / '2026-W29' / '2026-07'
          summary TEXT,                       -- AI 简报导语
          focus TEXT DEFAULT '[]',            -- JSON: [{headline, whyHot, contentIds}]
          tokens INTEGER DEFAULT 0,
          cost_yuan REAL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(period_type, period_key)     -- 同一天重跑 = 覆盖，不产生多份
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_reports_period ON reports(period_type, period_key DESC);');

    // ---- 2. ideas 选题 ----
    db.exec(`
      CREATE TABLE IF NOT EXISTS ideas (
          id TEXT PRIMARY KEY,
          report_id TEXT,                     -- 来自哪份简报；独立生成时可空
          title TEXT NOT NULL,
          angle TEXT,                         -- 切入角度
          why_now TEXT,                       -- 为什么是现在
          consensus TEXT DEFAULT '[]',        -- JSON: [string]
          non_consensus TEXT DEFAULT '[]',    -- JSON: [string]
          supporting_content_ids TEXT DEFAULT '[]', -- JSON: [contentId]
          status TEXT DEFAULT 'suggested'
              CHECK (status IN ('suggested', 'adopted', 'dismissed', 'created')),
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_ideas_report ON ideas(report_id);');

    // ---- 3. contents.tags ----
    if (!hasColumn('contents', 'tags')) {
      db.exec("ALTER TABLE contents ADD COLUMN tags TEXT DEFAULT '[]';");
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  const counts = {
    reports: db.prepare('SELECT COUNT(*) c FROM reports').get().c,
    ideas: db.prepare('SELECT COUNT(*) c FROM ideas').get().c,
    tags_column: db.prepare('PRAGMA table_info(contents)').all().some(c => c.name === 'tags'),
  };
  db.close();
  console.log('✅ M2 migration done:', counts);
  return counts;
}

// 路径含中文目录，不能用 import.meta.url === `file://${argv[1]}` 判断入口（百分号编码问题）
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM2();
}
