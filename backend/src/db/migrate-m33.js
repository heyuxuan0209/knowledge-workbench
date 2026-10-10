// M33（2026-10-09）：内容作品、关键 Release 与跨工具血缘。
// 普通对话不入库；存量草稿只回填一条 provenance_status=inferred 的初始版本。

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export const CONTENT_LINEAGE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS content_works (
    id TEXT PRIMARY KEY, title TEXT, kind TEXT NOT NULL DEFAULT 'content',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'published', 'archived')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS artifact_releases (
    id TEXT PRIMARY KEY, work_id TEXT NOT NULL, sequence INTEGER NOT NULL,
    parent_release_id TEXT, release_kind TEXT NOT NULL, artifact_type TEXT NOT NULL,
    artifact_ref_type TEXT NOT NULL DEFAULT 'manual', artifact_ref TEXT, title TEXT,
    content_hash TEXT, content_snapshot TEXT, origin_tool TEXT NOT NULL DEFAULT 'unknown',
    origin_account TEXT,
    creator_type TEXT NOT NULL DEFAULT 'unknown' CHECK (creator_type IN ('human', 'ai', 'human_ai', 'unknown')),
    provenance_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (provenance_status IN ('confirmed', 'inferred')),
    sources_json TEXT NOT NULL DEFAULT '[]', metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (work_id) REFERENCES content_works(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_release_id) REFERENCES artifact_releases(id),
    UNIQUE (work_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS artifact_relations (
    id TEXT PRIMARY KEY, from_release_id TEXT NOT NULL, relation_type TEXT NOT NULL,
    to_entity_type TEXT NOT NULL, to_entity_id TEXT NOT NULL,
    provenance_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (provenance_status IN ('confirmed', 'inferred')),
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (from_release_id) REFERENCES artifact_releases(id) ON DELETE CASCADE,
    UNIQUE (from_release_id, relation_type, to_entity_type, to_entity_id)
  );

  CREATE INDEX IF NOT EXISTS idx_releases_work_sequence ON artifact_releases(work_id, sequence DESC);
  CREATE INDEX IF NOT EXISTS idx_releases_artifact ON artifact_releases(artifact_ref_type, artifact_ref);
  CREATE INDEX IF NOT EXISTS idx_relations_from ON artifact_relations(from_release_id);
  CREATE INDEX IF NOT EXISTS idx_relations_target ON artifact_relations(to_entity_type, to_entity_id);
`;

const sha256 = value => createHash('sha256').update(String(value || '')).digest('hex');

function addDraftColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(drafts)').all().map(column => column.name));
  if (!columns.has('work_id')) db.exec('ALTER TABLE drafts ADD COLUMN work_id TEXT REFERENCES content_works(id)');
  if (!columns.has('latest_release_id')) db.exec('ALTER TABLE drafts ADD COLUMN latest_release_id TEXT REFERENCES artifact_releases(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_drafts_work ON drafts(work_id)');
}

function backfillDrafts(db) {
  const drafts = db.prepare('SELECT * FROM drafts WHERE work_id IS NULL OR latest_release_id IS NULL').all();
  const insertWork = db.prepare("INSERT INTO content_works (id, title, kind, created_at, updated_at) VALUES (?, ?, 'content', COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))");
  const insertRelease = db.prepare(`
    INSERT INTO artifact_releases (
      id, work_id, sequence, release_kind, artifact_type, artifact_ref_type, artifact_ref,
      title, content_hash, content_snapshot, origin_tool, creator_type, provenance_status,
      sources_json, metadata_json, created_at
    ) VALUES (?, ?, 1, 'initial', 'draft', 'draft', ?, ?, ?, ?, 'knowledge_workbench',
              'human_ai', 'inferred', ?, ?, COALESCE(?, datetime('now')))
  `);
  const insertRelation = db.prepare(`
    INSERT OR IGNORE INTO artifact_relations
      (id, from_release_id, relation_type, to_entity_type, to_entity_id, provenance_status)
    VALUES (?, ?, ?, ?, ?, 'inferred')
  `);
  const updateDraft = db.prepare('UPDATE drafts SET work_id = ?, latest_release_id = ? WHERE id = ?');

  for (const draft of drafts) {
    let workId = draft.work_id;
    if (!workId) workId = randomUUID();
    if (!db.prepare('SELECT id FROM content_works WHERE id = ?').get(workId)) {
      insertWork.run(workId, draft.title || '未命名作品', draft.created_at, draft.updated_at);
    }
    let releaseId = draft.latest_release_id;
    if (!releaseId) {
      releaseId = randomUUID();
      const refs = JSON.parse(draft.paragraph_refs || '[]');
      insertRelease.run(releaseId, workId, draft.id, draft.title, sha256(`${draft.title || ''}\n${draft.body || ''}`), draft.body || '', JSON.stringify(refs), JSON.stringify({ backfilled: true, platform: draft.platform }), draft.created_at);
      if (draft.source_kind && draft.source_id) insertRelation.run(randomUUID(), releaseId, 'derived_from', draft.source_kind, draft.source_id);
      for (const ref of refs) {
        if (ref.noteId) insertRelation.run(randomUUID(), releaseId, 'cites', 'note', ref.noteId);
        if (ref.contentId) insertRelation.run(randomUUID(), releaseId, 'cites', 'content', ref.contentId);
      }
    }
    updateDraft.run(workId, releaseId, draft.id);
  }
  return drafts.length;
}

export function migrateM33() {
  const db = new DatabaseSync(DB_PATH);
  const hasDrafts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drafts'").get();
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(CONTENT_LINEAGE_SCHEMA);
    let backfilled = 0;
    if (hasDrafts) { addDraftColumns(db); backfilled = backfillDrafts(db); }
    db.exec('COMMIT');
    db.close();
    console.log(`✅ M33 migration done: 内容血缘表就绪，回填 ${backfilled} 篇草稿`);
    return { backfilled };
  } catch (error) {
    db.exec('ROLLBACK'); db.close(); throw error;
  }
}

if (process.argv[1] && process.argv[1].includes('migrate-m33')) migrateM33();
