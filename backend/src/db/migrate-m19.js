// M19 迁移（2026-07-23 · P1 层3 返工 · ADR-040）：stories 落库主条 primary_content_id。
//
// 事件簇主条（官方 > 官方号 > KOL）此前只在 getStories 读时按信任档排序、没落库，
// 验收要求"主条落库、簇C 主条必须是 rss 官方条"。加 primary_content_id 一列，rebuildStories
// 写簇时按 trust tier 选定并存；getStories 以它为准把主条排最前。幂等：列已存在则跳过。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM19() {
  const db = new DatabaseSync(DB_PATH);
  const cols = db.prepare('PRAGMA table_info(stories)').all();
  if (cols.some(c => c.name === 'primary_content_id')) {
    console.log('ℹ️  M19: stories.primary_content_id 已存在，跳过');
    db.close();
    return;
  }
  db.exec('ALTER TABLE stories ADD COLUMN primary_content_id TEXT');
  db.close();
  console.log('✅ M19: stories.primary_content_id 列已添加（下次 rebuildStories 填充）');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  migrateM19();
}
