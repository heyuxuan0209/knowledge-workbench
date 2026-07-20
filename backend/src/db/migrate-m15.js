// M15 迁移（2026-07-20 ADR-035 灵感能养大）：给 ideas 加 body（正文/草稿种子）。
// 背景：随手记原本只有 title（还静默截 300 字），想在灵感里接着写、粘长文都无处安放。
// 决策：ideas 加 body 承载"你自己的字"，正文不截断；title 仍是那句"要写什么"。
// body 是草稿种子、非终稿——终稿仍走 drafts 表（守 ADR-025 三层）。幂等：列已存在则跳过。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM15() {
  const db = new DatabaseSync(DB_PATH);
  const has = db.prepare('PRAGMA table_info(ideas)').all().some(c => c.name === 'body');
  if (has) {
    console.log('✅ M15 migration skipped: ideas.body 已存在');
  } else {
    db.exec('ALTER TABLE ideas ADD COLUMN body TEXT;');
    console.log('✅ M15 migration done: 新增列 ideas.body');
  }
  db.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM15();
}
