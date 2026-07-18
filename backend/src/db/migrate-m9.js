// M9 迁移（VISION-V4 阶段1a 语义层）：给 notes 加向量字段。
// notes 表此前没有 embedding 列（schema-v3 只给 contents/topics/stories 预留了，notes 漏了）。
// - embedding：归一化向量的 JSON 数组（几百~几千条素材，JSON 存储足够，无需向量库/扩展）。
// - embedding_model：记录用哪个模型生成——换模型时据此识别需重建的行（索引/查询必须同模型）。
// 幂等：列已存在则跳过。contents.embedding 已在 schema-v3，这里补 contents.embedding_model 便于统一管理。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

function hasColumn(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

export function migrateM9() {
  const db = new DatabaseSync(DB_PATH);
  const added = [];

  const ensure = (table, col, ddl) => {
    if (!hasColumn(db, table, col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl};`);
      added.push(`${table}.${col}`);
    }
  };

  ensure('notes', 'embedding', 'TEXT');            // JSON 数组
  ensure('notes', 'embedding_model', 'TEXT');
  ensure('contents', 'embedding_model', 'TEXT');   // contents.embedding 已由 schema-v3 预留

  if (added.length === 0) {
    console.log('✅ M9 migration skipped: 向量字段已存在');
  } else {
    console.log(`✅ M9 migration done: 新增列 ${added.join(', ')}`);
  }
  db.close();
  return { added };
}

// 路径含中文目录，不能用 import.meta.url === `file://${argv[1]}` 判断入口（百分号编码问题）
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM9();
}
