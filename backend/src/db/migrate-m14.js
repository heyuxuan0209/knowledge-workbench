// M14 迁移（2026-07-20 视频精读补全）：给 contents 加 interpretation_note / interpretation_truncated，
// 让"精读只覆盖了前段"这个状态能持久化（缓存命中也知道），供阅读器显示「转写全程」按钮。幂等。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM14() {
  const db = new DatabaseSync(DB_PATH);
  const cols = db.prepare('PRAGMA table_info(contents)').all().map(c => c.name);
  const add = [];
  if (!cols.includes('interpretation_note')) add.push("ALTER TABLE contents ADD COLUMN interpretation_note TEXT;");
  if (!cols.includes('interpretation_truncated')) add.push("ALTER TABLE contents ADD COLUMN interpretation_truncated INTEGER DEFAULT 0;");
  if (!add.length) { console.log('✅ M14 migration skipped: 列已存在'); }
  else { for (const sql of add) db.exec(sql); console.log(`✅ M14 migration done: 新增 ${add.length} 列（interpretation_note/truncated）`); }
  db.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM14();
}
