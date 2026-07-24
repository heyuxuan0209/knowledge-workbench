// M21 迁移（2026-07-24 · P3 追踪型主题 · ADR-040 补充）：追踪主题数据模型。
// - tracking_topics：实体 + 别名集(JSON) + 状态(active/paused) + created_by + last_seen_at(增量) + 一句话总览 + centroid。
// - tracking_topic_contents：内容 ↔ 追踪主题 多对多，存"收录理由"一句 + 归属主线 + muted(踢出)。
// - storylines：主线（判据=因果连通性，≤6）；四槽位 脉络/判断/待追/钩子；status active/scattered(零散区)。
// 幂等：表已存在则跳过。追踪主题只由用户建、AI 绝不自动建（收录/归线/综述才自动）。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM21() {
  const db = new DatabaseSync(DB_PATH);
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tracking_topics'").get();
  if (exists) { console.log('✅ M21 skipped: tracking_topics 已存在'); db.close(); return; }
  db.exec(`
    CREATE TABLE tracking_topics (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
      created_by TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user','suggestion')),
      overview TEXT,
      centroid_embedding TEXT,
      embedding_model TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE tracking_topic_contents (
      tracking_topic_id TEXT NOT NULL,
      content_id TEXT NOT NULL,
      reason TEXT,
      storyline_id TEXT,
      relevance REAL,
      muted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tracking_topic_id, content_id)
    );
    CREATE INDEX idx_ttc_topic ON tracking_topic_contents(tracking_topic_id);
    CREATE INDEX idx_ttc_storyline ON tracking_topic_contents(storyline_id);
    CREATE TABLE storylines (
      id TEXT PRIMARY KEY,
      tracking_topic_id TEXT NOT NULL,
      name TEXT NOT NULL,
      narrative TEXT,
      verdict TEXT,
      watch TEXT,
      hook TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','scattered')),
      ord INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_storylines_topic ON storylines(tracking_topic_id);
  `);
  db.close();
  console.log('✅ M21: tracking_topics / tracking_topic_contents / storylines 已建');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  migrateM21();
}
