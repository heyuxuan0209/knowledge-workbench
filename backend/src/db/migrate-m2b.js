// M2b 迁移：Feed 数据质量轮（2026-07-14 用户反馈）
// 1. contents.permalink —— AI HOT 自带的全文解读页链接（卡片"全文解读"入口）
// 2. app_meta 表 —— 轻量键值存储（GitHub Trending 当日趋势总结等）

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM2b() {
  const db = new DatabaseSync(DB_PATH);
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);

  if (!hasColumn('contents', 'permalink')) {
    db.exec('ALTER TABLE contents ADD COLUMN permalink TEXT;');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const ok = {
    permalink: hasColumn('contents', 'permalink'),
    app_meta: Boolean(db.prepare("SELECT name FROM sqlite_master WHERE name='app_meta'").get()),
  };
  db.close();
  console.log('✅ M2b migration done:', ok);
  return ok;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM2b();
}
