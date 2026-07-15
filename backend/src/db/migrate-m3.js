// M3 知识层迁移（docs/PRODUCT-DESIGN-V2.md M3 / DECISIONS.md ADR-009）
// 1. topics.body —— 活页正文（AI 维护的活文档，JSON: {current, views[], consensus}）
//    topics.origin_idea_id —— 由选题升级建页时回链 Idea（飞轮：洞察 → 知识库）
// 2. topic_changelog 表 —— 同化修订记录（演进时间线，涌现引擎的输入）
// 3. note_topics 表 —— 素材 ↔ 活页关联（pending 待并入 / assimilated 已并入）
// 4. reports 加 trends / page_changes / emergent —— 周报/月报的动向与涌现字段
//
// 幂等：可重复执行。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM3() {
  const db = new DatabaseSync(DB_PATH);

  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);

  db.exec('BEGIN');
  try {
    // ---- 1. topics 活页字段 ----
    if (!hasColumn('topics', 'body')) {
      db.exec('ALTER TABLE topics ADD COLUMN body TEXT;'); // JSON: {current, views: [{who, what, ref, conflict}], consensus}
    }
    if (!hasColumn('topics', 'origin_idea_id')) {
      db.exec('ALTER TABLE topics ADD COLUMN origin_idea_id TEXT;');
    }

    // ---- 2. topic_changelog 演进时间线 ----
    db.exec(`
      CREATE TABLE IF NOT EXISTS topic_changelog (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL,
          change_type TEXT NOT NULL
              CHECK (change_type IN ('created', 'assimilated', 'revised', 'conflict')),
          summary TEXT NOT NULL,              -- 一句话修订说明（AI 生成，changelog 即时间线）
          note_ids TEXT DEFAULT '[]',         -- JSON: 本次并入的素材 id
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_topic_changelog_topic ON topic_changelog(topic_id, created_at DESC);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_topic_changelog_created ON topic_changelog(created_at DESC);');

    // ---- 3. note_topics 素材↔活页关联 ----
    db.exec(`
      CREATE TABLE IF NOT EXISTS note_topics (
          note_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          status TEXT DEFAULT 'pending'
              CHECK (status IN ('pending', 'assimilated')),
          relevance REAL DEFAULT 1.0,         -- 自动匹配的相似度；用户手动指定为 1.0
          added_by TEXT DEFAULT 'ai'
              CHECK (added_by IN ('ai', 'user')),
          created_at TEXT DEFAULT (datetime('now')),
          assimilated_at TEXT,
          PRIMARY KEY (note_id, topic_id),
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
          FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_note_topics_topic ON note_topics(topic_id, status);');

    // ---- 4. reports 周报/月报字段 ----
    if (!hasColumn('reports', 'trends')) {
      db.exec("ALTER TABLE reports ADD COLUMN trends TEXT DEFAULT '[]';"); // JSON: [{theme, direction: rising|cooling, evidence}]
    }
    if (!hasColumn('reports', 'page_changes')) {
      db.exec("ALTER TABLE reports ADD COLUMN page_changes TEXT DEFAULT '[]';"); // JSON: [{topicId, topicName, summary, conflict}]
    }
    if (!hasColumn('reports', 'emergent')) {
      db.exec("ALTER TABLE reports ADD COLUMN emergent TEXT DEFAULT '{}';"); // JSON: {newTopics[], links[], conflicts[]}
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  const counts = {
    topics_body: hasColumn('topics', 'body'),
    topic_changelog: db.prepare('SELECT COUNT(*) c FROM topic_changelog').get().c,
    note_topics: db.prepare('SELECT COUNT(*) c FROM note_topics').get().c,
    reports_emergent: hasColumn('reports', 'emergent'),
  };
  db.close();
  console.log('✅ M3 migration done:', counts);
  return counts;
}

// 路径含中文目录，不能用 import.meta.url === `file://${argv[1]}` 判断入口（百分号编码问题）
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM3();
}
