// M10 迁移（VISION-V4 UI 改造 2b）：给 contents 加 category 字段，供资讯页分类 chips。
// 文章分 模型/产品/行业/观点方法，GitHub 项目分 工具Agent/模型/应用/基建（都不合适=其他）。
// 由 content-classify.js 用 DeepSeek 批量分类填充，缓存不重算。幂等：列已存在则跳过。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM10() {
  const db = new DatabaseSync(DB_PATH);
  const has = db.prepare('PRAGMA table_info(contents)').all().some(c => c.name === 'category');
  if (has) {
    console.log('✅ M10 migration skipped: contents.category 已存在');
  } else {
    db.exec('ALTER TABLE contents ADD COLUMN category TEXT;');
    console.log('✅ M10 migration done: 新增列 contents.category');
  }
  db.close();
}

// 路径含中文目录，不能用 import.meta.url === `file://${argv[1]}` 判断入口（百分号编码问题）
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM10();
}
