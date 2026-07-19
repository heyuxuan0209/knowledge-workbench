// M11 迁移（2026-07-19 周报重构）：给 ideas 加 supporting_note_ids，
// 让"值得写的选题"既能引外部热门内容、也能引你自己的素材（取材两头都要）。幂等：列已存在则跳过。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM11() {
  const db = new DatabaseSync(DB_PATH);
  const has = db.prepare('PRAGMA table_info(ideas)').all().some(c => c.name === 'supporting_note_ids');
  if (has) {
    console.log('✅ M11 migration skipped: ideas.supporting_note_ids 已存在');
  } else {
    db.exec("ALTER TABLE ideas ADD COLUMN supporting_note_ids TEXT DEFAULT '[]';");
    console.log('✅ M11 migration done: 新增列 ideas.supporting_note_ids');
  }
  db.close();
}

// 路径含中文目录，不能用 import.meta.url === `file://${argv[1]}` 判断入口
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM11();
}
