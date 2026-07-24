// M23：contents.starred_at —— ★挂账（「以后再看」）需要挂账时间，才能算「已挂 N 天」并催办（ADR-045②）。
// 幂等：列已存在则跳过；给现有星标条回填一个挂账时间（用 updated_at 近似，没有就用 now）。
import { getDatabase } from './init.js';

export function migrateM23() {
  const db = getDatabase();
  const cols = db.prepare("PRAGMA table_info(contents)").all().map(c => c.name);
  if (!cols.includes('starred_at')) {
    db.exec('ALTER TABLE contents ADD COLUMN starred_at TEXT;');
    // 存量星标回填挂账时间：优先 updated_at（多为最近一次操作），兜底 now
    db.exec("UPDATE contents SET starred_at = COALESCE(updated_at, datetime('now')) WHERE starred = 1 AND starred_at IS NULL;");
    console.log('[m23] contents.starred_at 已添加并回填存量星标');
  } else {
    console.log('[m23] contents.starred_at 已存在，跳过');
  }
  db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) migrateM23();
