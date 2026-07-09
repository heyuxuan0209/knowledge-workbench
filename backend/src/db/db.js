import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

let db = null;

export function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
  }
  return db;
}

export function saveItems(items) {
  const db = getDb();
  
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO items 
    (id, source, title, title_en, url, summary, category, score, pub_date, extracted_keywords, user_action, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  for (const item of items) {
    try {
      insertStmt.run(
        item.id,
        item.source,
        item.title,
        item.title_en,
        item.url,
        item.summary,
        item.category,
        item.score,
        item.pub_date,
        item.extracted_keywords,
        item.user_action,
        item.created_at,
        item.updated_at
      );
      inserted++;
    } catch (error) {
      console.error(`Failed to insert item ${item.id}:`, error.message);
    }
  }

  console.log(`✅ Saved ${inserted}/${items.length} items to database`);
  return inserted;
}

export function getItems(limit = 20, offset = 0) {
  const db = getDb();
  
  const stmt = db.prepare(`
    SELECT * FROM items 
    ORDER BY pub_date DESC 
    LIMIT ? OFFSET ?
  `);
  
  return stmt.all(limit, offset);
}

export function getItemById(id) {
  const db = getDb();
  
  const stmt = db.prepare('SELECT * FROM items WHERE id = ?');
  return stmt.get(id);
}

export function updateUserAction(itemId, action) {
  const db = getDb();
  
  const stmt = db.prepare(`
    UPDATE items 
    SET user_action = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  
  const result = stmt.run(action, itemId);
  return result.changes > 0;
}

export function getItemsByCategory(category, limit = 20) {
  const db = getDb();
  
  const stmt = db.prepare(`
    SELECT * FROM items 
    WHERE category = ?
    ORDER BY pub_date DESC 
    LIMIT ?
  `);
  
  return stmt.all(category, limit);
}
