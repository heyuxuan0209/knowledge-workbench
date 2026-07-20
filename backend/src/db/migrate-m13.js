// M13 迁移（2026-07-20 灵感库批次2 修正）：给 ideas 加 related_note_ids。
// 背景（踩坑）：自动补料原本直接写进 supporting_note_ids → 空灵感被沾边素材顶成"料够了/可以写了"。
// 修正：自动补料的结果是**建议**，存 related_note_ids，用户点「采纳」才移进 supporting（真·料）；
// 火候(readiness)只数 supporting，related 只展示不计数。幂等：列已存在则跳过。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM13() {
  const db = new DatabaseSync(DB_PATH);
  const has = db.prepare('PRAGMA table_info(ideas)').all().some(c => c.name === 'related_note_ids');
  if (has) {
    console.log('✅ M13 migration skipped: ideas.related_note_ids 已存在');
  } else {
    db.exec("ALTER TABLE ideas ADD COLUMN related_note_ids TEXT DEFAULT '[]';");
    console.log('✅ M13 migration done: 新增列 ideas.related_note_ids');
  }
  db.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM13();
}
