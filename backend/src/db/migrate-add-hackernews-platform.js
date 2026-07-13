import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

// schema-v3.sql 的 source_platforms.platform CHECK 约束原本只有 X/YouTube/WeChat/GitHub/
// Blog/Newsletter/Reddit/RSS，缺了 HackerNews（任务 #5 接入时发现）。SQLite 不支持直接
// ALTER 一个 CHECK 约束，用「建新表 → 搬数据 → 删旧表 → 改名」的标准做法重建。
export function migrate() {
  const db = new DatabaseSync(DB_PATH);

  console.log('🔄 Adding HackerNews to source_platforms.platform CHECK constraint...');

  try {
    db.exec('BEGIN TRANSACTION');

    db.exec(`
      CREATE TABLE source_platforms_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT NOT NULL,
          platform TEXT NOT NULL
              CHECK (platform IN ('X', 'YouTube', 'WeChat', 'GitHub', 'Blog', 'Newsletter', 'Reddit', 'RSS', 'HackerNews')),
          handle TEXT,
          track_mode TEXT NOT NULL
              CHECK (track_mode IN ('passive', 'active', 'link-only')),
          platform_metadata TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
          UNIQUE(source_id, platform)
      );
    `);

    db.exec(`
      INSERT INTO source_platforms_new
      SELECT id, source_id, platform, handle, track_mode, platform_metadata, created_at
      FROM source_platforms;
    `);

    db.exec('DROP TABLE source_platforms;');
    db.exec('ALTER TABLE source_platforms_new RENAME TO source_platforms;');

    db.exec('CREATE INDEX IF NOT EXISTS idx_source_platforms_source_id ON source_platforms(source_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_source_platforms_track_mode ON source_platforms(track_mode);');

    db.exec('COMMIT');
    console.log('✅ Migration completed');
  } catch (error) {
    db.exec('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    db.close();
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  migrate();
}
