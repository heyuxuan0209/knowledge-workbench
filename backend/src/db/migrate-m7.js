// M7 迁移（2026-07-16 用户反馈轮：Feed 星标 + 素材关键词标签）
// 1. contents.starred —— Feed 轻量收藏（星标 = "可能有用，先钉住"，无归属义务；
//    素材卡 = "确定有用，已归主题"。星标内容承诺不被任何清理逻辑删除）
// 2. notes.keywords —— 素材关键词标签（JSON 数组，保存时 AI 提取），
//    搜索时同时匹配标签，缓解 LIKE 字面匹配搜不到近义表述的问题
//
// 幂等：可重复执行。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM7() {
  const db = new DatabaseSync(DB_PATH);
  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);

  if (!hasColumn('contents', 'starred')) {
    db.exec('ALTER TABLE contents ADD COLUMN starred INTEGER DEFAULT 0;');
  }
  if (!hasColumn('notes', 'keywords')) {
    db.exec('ALTER TABLE notes ADD COLUMN keywords TEXT;');
  }

  const result = {
    contents_starred: hasColumn('contents', 'starred'),
    notes_keywords: hasColumn('notes', 'keywords'),
  };
  db.close();
  console.log('✅ M7 migration done:', result);
  return result;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  migrateM7();
}
