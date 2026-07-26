// M25：contents.archived —— feed 精选改造第一刀（近30天窗口 + 存量归档，可恢复）。
// archived=1 的内容从 feed 隐藏（getContents 默认排除），但记录还在、可恢复（设回 0）。
// 首次迁移顺带归档存量：发布超 30 天的陈旧内容归档；但**你 star 过的不动**（素材是资产，state-not-time）。
import { getDatabase } from './init.js';

export function migrateM25() {
  const db = getDatabase();
  const cols = db.prepare("PRAGMA table_info(contents)").all().map(c => c.name);
  if (!cols.includes('archived')) {
    db.exec('ALTER TABLE contents ADD COLUMN archived INTEGER DEFAULT 0;');
    // 首次归档：30 天前发布的陈旧内容（用 COALESCE 兜发布时间空的用入库时间）；排除 star 过的、GitHub trending
    const r = db.prepare(`
      UPDATE contents SET archived = 1, updated_at = datetime('now')
      WHERE source_app != 'github_trending'
        AND starred = 0
        AND datetime(COALESCE(published_at, created_at)) < datetime('now', '-30 days')
    `).run();
    console.log(`[m25] contents.archived 已添加，首次归档陈旧内容 ${r.changes} 条`);
  } else {
    console.log('[m25] contents.archived 已存在，跳过');
  }
  db.close();
}

if (process.argv[1] && process.argv[1].includes('migrate-m25')) migrateM25();
