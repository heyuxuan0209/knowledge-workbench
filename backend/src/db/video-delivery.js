import { getDatabase } from './init.js';
import { normalizeUrlKey } from './ingest-cache.js';

let ready = false;

function ensureTable(db) {
  if (ready) return;
  db.exec(`CREATE TABLE IF NOT EXISTS video_delivery_cache (
    url_key TEXT PRIMARY KEY,
    source_hash TEXT,
    translated_body TEXT,
    translation_status TEXT,
    doc_token TEXT,
    doc_url TEXT,
    document_hash TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  ready = true;
}

export function getVideoDelivery(url) {
  const db = getDatabase();
  ensureTable(db);
  const row = db.prepare('SELECT * FROM video_delivery_cache WHERE url_key = ?')
    .get(normalizeUrlKey(url));
  db.close();
  return row || null;
}

export function saveVideoDelivery(url, patch) {
  const db = getDatabase();
  ensureTable(db);
  const key = normalizeUrlKey(url);
  db.prepare(`INSERT INTO video_delivery_cache (
      url_key, source_hash, translated_body, translation_status,
      doc_token, doc_url, document_hash, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(url_key) DO UPDATE SET
      source_hash = COALESCE(excluded.source_hash, video_delivery_cache.source_hash),
      translated_body = COALESCE(excluded.translated_body, video_delivery_cache.translated_body),
      translation_status = COALESCE(excluded.translation_status, video_delivery_cache.translation_status),
      doc_token = COALESCE(excluded.doc_token, video_delivery_cache.doc_token),
      doc_url = COALESCE(excluded.doc_url, video_delivery_cache.doc_url),
      document_hash = COALESCE(excluded.document_hash, video_delivery_cache.document_hash),
      updated_at = datetime('now')`)
    .run(
      key,
      patch.sourceHash ?? null,
      patch.translatedBody ?? null,
      patch.translationStatus ?? null,
      patch.docToken ?? null,
      patch.docUrl ?? null,
      patch.documentHash ?? null,
    );
  const row = db.prepare('SELECT * FROM video_delivery_cache WHERE url_key = ?').get(key);
  db.close();
  return row;
}

