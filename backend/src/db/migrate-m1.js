// M1 沉淀层迁移（docs/PRODUCT-DESIGN-V2.md M1 / DECISIONS.md ADR-007、ADR-010）
// 1. 新建 notes 表 —— 素材卡片：结构化摘录 + 来源引用（stance 字段预留，TBD-004 未定不做 UI）
// 2. sources 表加 registered_by_user —— 用户主动登记的"优质源"，Feed 排序加权依据
// 3. source_platforms.track_mode 由三档扩为四档（passive / active-rss / active-query / link-only）
//    SQLite 无法修改 CHECK 约束，按官方推荐流程重建表迁数据。
//    旧值映射：'active' → 'active-query'（旧枚举里 active 只可能是 X/YouTube 主动查询语义）
//
// 可重复执行（幂等）：已迁移过的库再跑一遍只会跳过，不会破坏数据。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM1() {
  const db = new DatabaseSync(DB_PATH);

  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);

  db.exec('BEGIN');
  try {
    // ---- 1. notes 素材卡片 ----
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          excerpt TEXT NOT NULL,              -- 结构化摘录（Markdown，来自对话回复/解读产物）
          note_type TEXT DEFAULT 'chat'
              CHECK (note_type IN ('chat', 'excerpt', 'insight')),
          stance TEXT
              CHECK (stance IN ('agree', 'disagree', 'doubt')), -- 可空。TBD-004 预留，暂无 UI
          content_id TEXT,                    -- 来源引用；adHoc 粘贴内容未入库时可空
          source_title TEXT,                  -- 冗余保存，content 被删或未入库时仍可溯源
          source_url TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE SET NULL
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at DESC);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_notes_content_id ON notes(content_id);');

    // ---- 2. sources.registered_by_user ----
    if (!hasColumn('sources', 'registered_by_user')) {
      db.exec('ALTER TABLE sources ADD COLUMN registered_by_user INTEGER DEFAULT 0;');
    }

    // ---- 3. source_platforms track_mode 四档（重建表） ----
    const spSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'source_platforms'").get()?.sql || '';
    if (!spSql.includes('active-rss')) {
      db.exec(`
        CREATE TABLE source_platforms_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id TEXT NOT NULL,
            platform TEXT NOT NULL
                CHECK (platform IN ('X', 'YouTube', 'WeChat', 'GitHub', 'Blog', 'Newsletter', 'Reddit', 'RSS', 'HackerNews', 'Podcast')),
            handle TEXT,
            track_mode TEXT NOT NULL
                CHECK (track_mode IN ('passive', 'active-rss', 'active-query', 'link-only')),
            platform_metadata TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
            UNIQUE(source_id, platform)
        );
      `);
      db.exec(`
        INSERT INTO source_platforms_new (id, source_id, platform, handle, track_mode, platform_metadata, created_at)
        SELECT id, source_id, platform, handle,
               CASE track_mode WHEN 'active' THEN 'active-query' ELSE track_mode END,
               platform_metadata, created_at
        FROM source_platforms;
      `);
      db.exec('DROP TABLE source_platforms;');
      db.exec('ALTER TABLE source_platforms_new RENAME TO source_platforms;');
      db.exec('CREATE INDEX IF NOT EXISTS idx_source_platforms_source_id ON source_platforms(source_id);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_source_platforms_track_mode ON source_platforms(track_mode);');
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  const counts = {
    notes: db.prepare('SELECT COUNT(*) c FROM notes').get().c,
    sources: db.prepare('SELECT COUNT(*) c FROM sources').get().c,
    source_platforms: db.prepare('SELECT COUNT(*) c FROM source_platforms').get().c,
  };
  db.close();
  console.log('✅ M1 migration done:', counts);
  return counts;
}

// 注意：不能用 import.meta.url === `file://${argv[1]}` 判断入口——本项目路径含中文目录，
// import.meta.url 会百分号编码而 argv[1] 不会，永远不相等。必须解码后比路径。
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM1();
}
