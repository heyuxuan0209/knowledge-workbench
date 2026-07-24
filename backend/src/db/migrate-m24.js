// M24：source_platforms.last_query_at —— sync-x 分级轮换需要「每源上次拉取时间」，
// 才能保证轮换池每源至少每 2-3 天拉一次（按最旧优先排队）。幂等。
import { getDatabase } from './init.js';

export function migrateM24() {
  const db = getDatabase();
  const cols = db.prepare("PRAGMA table_info(source_platforms)").all().map(c => c.name);
  if (!cols.includes('last_query_at')) {
    db.exec('ALTER TABLE source_platforms ADD COLUMN last_query_at TEXT;');
    console.log('[m24] source_platforms.last_query_at 已添加');
  } else {
    console.log('[m24] last_query_at 已存在，跳过');
  }
  db.close();
}

if (fileUrlMatches()) migrateM24();
function fileUrlMatches() {
  try { return process.argv[1] && import.meta.url.includes('migrate-m24'); } catch { return false; }
}
