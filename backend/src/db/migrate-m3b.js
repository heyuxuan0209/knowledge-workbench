// M3b 迁移（ADR-014 active-query 执行器）：
// 1. contents.source_app 枚举加 'active_query'（登记源主动查询拉回的内容）
// 2. source_platforms.platform 枚举加 'Bilibili'
//
// SQLite 无法修改 CHECK 约束，按官方推荐流程重建表：
// 取 sqlite_master 里的原 CREATE 语句做字符串替换 → 建新表 → 整表拷贝 → 换名 → 重建索引。
// ⚠️ contents 被 story_contents/content_topics（CASCADE）、notes（SET NULL）引用，
// 重建期间必须关闭外键约束，否则 DROP 旧表会级联删掉子表数据。
// （node:sqlite 默认 enableForeignKeyConstraints=true，这里显式关闭本连接的约束）
//
// 幂等：可重复执行。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

// 用原表 SQL 改 CHECK 后重建，保留全部列定义与数据；索引取自 sqlite_master 原样重建
function rebuildTable(db, table, transformSql) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!row) throw new Error(`table ${table} not found`);

  const newSql = transformSql(row.sql);
  if (newSql === row.sql) return false; // 无需变更（已迁移过）

  const indexes = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL"
  ).all(table).map(r => r.sql);

  const tmp = `${table}__new`;
  db.exec(newSql.replace(new RegExp(`TABLE\\s+(IF NOT EXISTS\\s+)?["']?${table}["']?`, 'i'), `TABLE ${tmp}`));
  db.exec(`INSERT INTO ${tmp} SELECT * FROM ${table};`);
  db.exec(`DROP TABLE ${table};`);
  db.exec(`ALTER TABLE ${tmp} RENAME TO ${table};`);
  for (const idx of indexes) db.exec(idx);
  return true;
}

export function migrateM3b() {
  const db = new DatabaseSync(DB_PATH, { enableForeignKeyConstraints: false });

  db.exec('BEGIN');
  let changed = { contents: false, source_platforms: false };
  try {
    changed.contents = rebuildTable(db, 'contents', sql =>
      sql.includes("'active_query'")
        ? sql
        : sql.replace("'manual', 'unknown'", "'manual', 'active_query', 'unknown'")
    );

    changed.source_platforms = rebuildTable(db, 'source_platforms', sql =>
      sql.includes("'Bilibili'")
        ? sql
        : sql.replace("'Podcast'", "'Podcast', 'Bilibili'")
    );

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  // 完整性自检：重建后行数与外键引用健康
  const counts = {
    ...changed,
    contents_rows: db.prepare('SELECT COUNT(*) c FROM contents').get().c,
    source_platforms_rows: db.prepare('SELECT COUNT(*) c FROM source_platforms').get().c,
    fk_violations: db.prepare('PRAGMA foreign_key_check').all().length,
  };
  db.close();
  console.log('✅ M3b migration done:', counts);
  return counts;
}

// 路径含中文目录，不能用 import.meta.url === `file://${argv[1]}` 判断入口（百分号编码问题）
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM3b();
}
