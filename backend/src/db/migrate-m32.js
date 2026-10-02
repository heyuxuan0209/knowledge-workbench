// M32（2026-10-02）：精选阅读决策摘要。
// 原始 zh_summary 保留为事实层；本表缓存“把事实、结论和边界讲完整”的首页阅读层。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export const CURATED_READING_DECISIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS curated_reading_decisions (
    content_id          TEXT PRIMARY KEY,
    prompt_version      INTEGER NOT NULL,
    source_updated_at   TEXT,
    decision_summary    TEXT NOT NULL,
    verdict             TEXT NOT NULL CHECK (verdict IN ('deep', 'brief', 'exclude')),
    evidence_status     TEXT NOT NULL CHECK (evidence_status IN ('full', 'summary', 'title_only')),
    reason              TEXT,
    generated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_crd_verdict_generated
    ON curated_reading_decisions(verdict, generated_at DESC);
`;

export function migrateM32() {
  const db = new DatabaseSync(DB_PATH);
  const existed = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='curated_reading_decisions'").get();
  db.exec(CURATED_READING_DECISIONS_SCHEMA);
  console.log(existed
    ? '✅ M32 migration skipped: curated_reading_decisions 已存在'
    : '✅ M32 migration done: 新建精选阅读决策摘要表');
  db.close();
}

if (process.argv[1] && process.argv[1].includes('migrate-m32')) migrateM32();
