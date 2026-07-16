// M5 迁移（2026-07-16 用户反馈：读全文 = 结构化精读稿，不是逐字译文）
// contents.interpretation —— 精读稿缓存（Markdown，instant-analysis 模板产物，
// 设计文档 §四 Content 早已预留该字段，本次落地）
//
// 幂等：可重复执行。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM5() {
  const db = new DatabaseSync(DB_PATH);
  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);

  if (!hasColumn('contents', 'interpretation')) {
    db.exec('ALTER TABLE contents ADD COLUMN interpretation TEXT;');
  }
  const ok = hasColumn('contents', 'interpretation');
  db.close();
  console.log('✅ M5 migration done:', { contents_interpretation: ok });
  return { contents_interpretation: ok };
}

// 路径含中文目录，不能用 import.meta.url === `file://${argv[1]}` 判断入口（百分号编码问题）
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM5();
}
