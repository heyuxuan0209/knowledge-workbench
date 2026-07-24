// M20 迁移（2026-07-24 · P2 规则3 · HANDOFF §P2）：notes 补 archived 归档位。
// 大扫除素材层"不删只归档"（无垃圾、归档进冷区可恢复）；主视图默认不显示 archived 素材。
// 幂等：列已存在则跳过。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM20() {
  const db = new DatabaseSync(DB_PATH);
  const cols = db.prepare('PRAGMA table_info(notes)').all();
  if (cols.some(c => c.name === 'archived')) {
    console.log('ℹ️  M20: notes.archived 已存在，跳过');
    db.close();
    return;
  }
  db.exec('ALTER TABLE notes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  db.close();
  console.log('✅ M20: notes.archived 列已添加（0=活跃，1=归档冷区）');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  migrateM20();
}
