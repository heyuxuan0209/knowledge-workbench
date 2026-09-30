// M30（2026-09-29）：单信源采集运行账本。
// 全局“上次同步”无法证明每个源都健康；逐次记录成功、空更新、失败和暂不支持，
// 才能区分“作者没更新”和“采集链坏了”。表只存运行事实，不改变源的启停状态。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export const SOURCE_FETCH_RUNS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS source_fetch_runs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id          TEXT NOT NULL,
    source_platform_id INTEGER,
    channel            TEXT NOT NULL,
    status             TEXT NOT NULL CHECK (status IN ('success', 'empty', 'failure', 'unsupported')),
    item_count         INTEGER NOT NULL DEFAULT 0,
    started_at         TEXT NOT NULL,
    finished_at        TEXT NOT NULL,
    duration_ms        INTEGER NOT NULL DEFAULT 0,
    error_kind         TEXT,
    error_message      TEXT,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
    FOREIGN KEY (source_platform_id) REFERENCES source_platforms(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sfr_source_finished ON source_fetch_runs(source_id, finished_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sfr_platform_finished ON source_fetch_runs(source_platform_id, finished_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sfr_status_finished ON source_fetch_runs(status, finished_at DESC);
`;

export function migrateM30() {
  const db = new DatabaseSync(DB_PATH);
  const existed = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='source_fetch_runs'").get();
  db.exec(SOURCE_FETCH_RUNS_SCHEMA);
  console.log(existed
    ? '✅ M30 migration skipped: source_fetch_runs 已存在'
    : '✅ M30 migration done: 新建单信源采集运行账本');
  db.close();
}

if (process.argv[1] && process.argv[1].includes('migrate-m30')) migrateM30();
