// M26：stories.digest —— 事件簇「AI 综合总结」缓存（需求2·话题卡）。
// 同一件事多源报道，综合成一段"这件事是什么、各源共识/分歧"，每簇生成一次、缓存复用。幂等。
import { getDatabase } from './init.js';

export function migrateM26() {
  const db = getDatabase();
  const cols = db.prepare("PRAGMA table_info(stories)").all().map(c => c.name);
  if (!cols.includes('digest')) {
    db.exec('ALTER TABLE stories ADD COLUMN digest TEXT;');
    console.log('[m26] stories.digest 已添加');
  } else {
    console.log('[m26] stories.digest 已存在，跳过');
  }
  db.close();
}

if (process.argv[1] && process.argv[1].includes('migrate-m26')) migrateM26();
