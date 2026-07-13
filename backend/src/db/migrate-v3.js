import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

// items.source 里常见的写法: "MarkTechPost（RSS）" / "X：阿易 AI Notes (@AYi_AInotes)" / "IT之家（RSS）"
// 只在能明确解析出人名 + handle 时才创建 Source，其余情况 source_id 留空（不强行归一）。
function parseAuthorFromAIHotSource(sourceText) {
  if (!sourceText) return null;

  const xMatch = sourceText.match(/^X[：:]\s*(.+?)\s*\(@([\w_]+)\)$/);
  if (xMatch) {
    return { displayName: xMatch[1].trim(), platform: 'X', handle: xMatch[2] };
  }

  return null; // RSS 源（媒体名）不算作 Source，媒体不是"人"
}

function detectContentType(url) {
  if (!url) return 'text';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'video';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'tweet';
  if (url.includes('github.com')) return 'repo';
  if (url.includes('arxiv.org')) return 'paper';
  return 'article';
}

export function migrateToV3() {
  const db = new DatabaseSync(DB_PATH);

  console.log('🔄 Migrating database to v3 (Content / Source / Topic / Story)...');

  try {
    const schemaV3 = readFileSync(join(__dirname, 'schema-v3.sql'), 'utf-8');
    db.exec(schemaV3);
    console.log('✅ Schema v3 tables created');

    migrateAIHotItems(db);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    db.close();
  }
}

function migrateAIHotItems(db) {
  const itemsExist = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='items'")
    .get();
  if (!itemsExist) {
    console.log('ℹ️  No legacy items table found, skip data migration');
    return;
  }

  const alreadyMigrated = db
    .prepare("SELECT COUNT(*) as count FROM contents WHERE source_app = 'aihot'")
    .get();
  if (alreadyMigrated.count > 0) {
    console.log(`ℹ️  ${alreadyMigrated.count} AI HOT contents already migrated, skip`);
    return;
  }

  const items = db.prepare('SELECT * FROM items').all();
  if (items.length === 0) {
    console.log('ℹ️  Legacy items table is empty, nothing to migrate');
    return;
  }

  const insertSource = db.prepare(`
    INSERT OR IGNORE INTO sources (id, source_type, display_name, followed_since, status)
    VALUES (?, 'Person', ?, datetime('now'), 'active')
  `);
  const insertPlatform = db.prepare(`
    INSERT OR IGNORE INTO source_platforms (source_id, platform, handle, track_mode)
    VALUES (?, ?, ?, 'passive')
  `);
  const findSourceByHandle = db.prepare(`
    SELECT source_id FROM source_platforms WHERE platform = ? AND handle = ?
  `);

  const insertContent = db.prepare(`
    INSERT OR IGNORE INTO contents (
      id, source_id, content_type, url, published_at,
      original_lang, has_translation,
      zh_title, zh_summary, en_title,
      input_method, source_app, fetch_status, external_score,
      user_read_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'feed', 'aihot', 'success', ?, 'unread', ?, ?)
  `);

  let migrated = 0;
  let sourcesCreated = 0;

  for (const item of items) {
    const author = parseAuthorFromAIHotSource(item.source);
    let sourceId = null;

    if (author) {
      const existing = findSourceByHandle.get(author.platform, author.handle);
      if (existing) {
        sourceId = existing.source_id;
      } else {
        sourceId = randomUUID();
        insertSource.run(sourceId, author.displayName);
        insertPlatform.run(sourceId, author.platform, author.handle);
        sourcesCreated++;
      }
    }

    const hasEnTitle = item.title_en && item.title_en.length > 0;

    insertContent.run(
      item.id,
      sourceId,
      detectContentType(item.url),
      item.url,
      item.pub_date,
      hasEnTitle ? 'en' : 'zh',
      hasEnTitle ? 1 : 0,
      item.title,
      item.summary,
      item.title_en || null,
      item.score,
      item.created_at,
      item.updated_at
    );
    migrated++;
  }

  console.log(`✅ Migrated ${migrated} items → contents (source_app=aihot)`);
  console.log(`✅ Created ${sourcesCreated} sources from recognizable X authors`);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  migrateToV3();
}
