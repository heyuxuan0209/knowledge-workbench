// M27 迁移（2026-08-08）：drafts 加飞书母稿的落点与内容指纹，让"发去飞书"变成幂等操作。
// 背景：createDocFromMarkdown 走 import_tasks，只能新建——同一篇稿改三版，内容工场就躺三篇同名文档，
// 点进去认不出哪篇是最新。根因是 draft-doc 路由无状态，认不出"这是同一篇的新版本"。
// 决策：把 doc_token（飞书那边的落点）+ content_hash（内容指纹）存回稿子旁边。
//   hash 没变 → 直接返回旧链接，不重建（顺手挡住手滑重复点）；变了 → 原地重写正文，URL 不动。
// 幂等：列已存在则跳过。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM27() {
  const db = new DatabaseSync(DB_PATH);
  const cols = db.prepare('PRAGMA table_info(drafts)').all().map(c => c.name);
  const added = [];
  for (const [name, type] of [['feishu_doc_token', 'TEXT'], ['feishu_url', 'TEXT'], ['feishu_hash', 'TEXT']]) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE drafts ADD COLUMN ${name} ${type};`);
      added.push(name);
    }
  }
  console.log(added.length
    ? `✅ M27 migration done: 新增列 drafts.${added.join(' / drafts.')}`
    : '✅ M27 migration skipped: drafts 飞书落点列已存在');
  db.close();
}

if (process.argv[1] && process.argv[1].includes('migrate-m27')) migrateM27();
