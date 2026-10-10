// M34（2026-10-09）：关键版本之间的编辑观察与需人工确认的偏好候选。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export const EDITING_INSIGHTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS edit_observations (
    id TEXT PRIMARY KEY, work_id TEXT NOT NULL, from_release_id TEXT NOT NULL, to_release_id TEXT NOT NULL,
    preference_key TEXT NOT NULL, summary TEXT NOT NULL, suggested_rule TEXT, evidence_json TEXT NOT NULL DEFAULT '[]',
    platform TEXT, status TEXT NOT NULL DEFAULT 'observed' CHECK (status IN ('observed', 'dismissed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (work_id) REFERENCES content_works(id) ON DELETE CASCADE,
    FOREIGN KEY (from_release_id) REFERENCES artifact_releases(id),
    FOREIGN KEY (to_release_id) REFERENCES artifact_releases(id),
    UNIQUE (from_release_id, to_release_id, preference_key)
  );
  CREATE INDEX IF NOT EXISTS idx_edit_observations_work ON edit_observations(work_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_edit_observations_key ON edit_observations(preference_key, platform, status);

  CREATE TABLE IF NOT EXISTS preference_candidates (
    id TEXT PRIMARY KEY, preference_key TEXT NOT NULL, rule_text TEXT NOT NULL,
    scope_type TEXT NOT NULL DEFAULT 'platform' CHECK (scope_type IN ('global', 'platform')),
    scope_value TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'candidate'
      CHECK (status IN ('candidate', 'confirmed', 'rejected')),
    distinct_work_count INTEGER NOT NULL DEFAULT 0, evidence_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (preference_key, scope_type, scope_value)
  );
  CREATE INDEX IF NOT EXISTS idx_preference_candidates_status ON preference_candidates(status, updated_at DESC);
`;

export function migrateM34() {
  const db = new DatabaseSync(DB_PATH);
  const existed = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='edit_observations'").get();
  db.exec(EDITING_INSIGHTS_SCHEMA);
  db.close();
  console.log(existed ? '✅ M34 migration skipped: 编辑观察表已存在' : '✅ M34 migration done: 新建编辑观察与偏好候选表');
}

if (process.argv[1] && process.argv[1].includes('migrate-m34')) migrateM34();
