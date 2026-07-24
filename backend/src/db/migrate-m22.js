// M22（2026-07-24 · P3 收尾）：tracking_topics 补 archived（归档可恢复，不删有积累的追踪主题）。
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');
export function migrateM22() {
  const db = new DatabaseSync(DB_PATH);
  const cols = db.prepare('PRAGMA table_info(tracking_topics)').all();
  if (cols.some(c => c.name === 'archived')) { console.log('ℹ️  M22: archived 已存在'); db.close(); return; }
  db.exec('ALTER TABLE tracking_topics ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  db.close();
  console.log('✅ M22: tracking_topics.archived 已添加');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) migrateM22();
