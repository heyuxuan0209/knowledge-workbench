// M31（2026-09-30）：LLM 调用凭证。
// 不保存 prompt / response 正文，只保存用途、指纹、状态、provider usage 与估算费用。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export const LLM_CALL_RECEIPTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS llm_call_receipts (
    id                   TEXT PRIMARY KEY,
    logical_key          TEXT,
    retry_of             TEXT,
    provider             TEXT NOT NULL,
    model                TEXT NOT NULL,
    purpose              TEXT NOT NULL,
    background           INTEGER NOT NULL DEFAULT 0,
    status               TEXT NOT NULL CHECK (status IN ('reserved', 'succeeded', 'failed', 'unknown', 'blocked')),
    request_fingerprint  TEXT NOT NULL,
    context_json         TEXT NOT NULL DEFAULT '[]',
    provider_request_id  TEXT,
    input_chars          INTEGER NOT NULL DEFAULT 0,
    output_chars         INTEGER NOT NULL DEFAULT 0,
    input_tokens         INTEGER NOT NULL DEFAULT 0,
    output_tokens        INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens     INTEGER NOT NULL DEFAULT 0,
    total_tokens         INTEGER NOT NULL DEFAULT 0,
    token_source         TEXT NOT NULL DEFAULT 'unknown',
    cost_yuan_estimate   REAL NOT NULL DEFAULT 0,
    error_kind           TEXT,
    error_message        TEXT,
    started_at           TEXT NOT NULL,
    dispatched_at        TEXT,
    finished_at          TEXT,
    duration_ms          INTEGER,
    reviewed_at          TEXT,
    review_note          TEXT,
    FOREIGN KEY (retry_of) REFERENCES llm_call_receipts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_lcr_started ON llm_call_receipts(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_lcr_purpose_started ON llm_call_receipts(purpose, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_lcr_status_started ON llm_call_receipts(status, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_lcr_logical_key ON llm_call_receipts(logical_key, started_at DESC);
`;

export function migrateM31() {
  const db = new DatabaseSync(DB_PATH);
  const existed = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='llm_call_receipts'").get();
  db.exec(LLM_CALL_RECEIPTS_SCHEMA);
  const columns = new Set(db.prepare('PRAGMA table_info(llm_call_receipts)').all().map(column => column.name));
  if (!columns.has('dispatched_at')) db.exec('ALTER TABLE llm_call_receipts ADD COLUMN dispatched_at TEXT');
  if (!columns.has('context_json')) db.exec("ALTER TABLE llm_call_receipts ADD COLUMN context_json TEXT NOT NULL DEFAULT '[]'");
  if (!columns.has('reviewed_at')) db.exec('ALTER TABLE llm_call_receipts ADD COLUMN reviewed_at TEXT');
  if (!columns.has('review_note')) db.exec('ALTER TABLE llm_call_receipts ADD COLUMN review_note TEXT');
  console.log(existed
    ? '✅ M31 migration skipped: llm_call_receipts 已存在'
    : '✅ M31 migration done: 新建 LLM 调用凭证表');
  db.close();
}

if (process.argv[1] && process.argv[1].includes('migrate-m31')) migrateM31();
