// M28 迁移（2026-08-12）：给逐字稿加一层「场次索引」，让检索先选场、再进场内找原话。
// 背景：transcript_chunks 是扁平的一堆片，query 直接跟全库片算余弦。实测搜「护城河」
//   全库最高分只有 0.393，且 top1 是某场录音里混进的影视解说——口语材料的片级向量
//   区分度本来就低，片一多就互相淹没。
// 决策：一场一条索引。索引文本优先用飞书**智能纪要**正文——它是 AI 已经写好的一页总结，
//   一场一份、短、便宜，正是索引该有的样子（当材料嫌它提炼过头，当索引恰好合适）；
//   没有纪要的场次退回用该场逐字稿开头兜底。
//   检索改两段：先在几十条场次索引上选 top-N 场，再只在这几场的片里找。
// 幂等：表已存在则跳过。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM28() {
  const db = new DatabaseSync(DB_PATH);
  const existed = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transcript_sessions'").get();

  db.exec(`
    CREATE TABLE IF NOT EXISTS transcript_sessions (
      file_token      TEXT PRIMARY KEY,          -- 与 transcript_chunks.file_token 同键（docx token 或 minute_token）
      session_title   TEXT NOT NULL,
      session_date    TEXT,
      source_kind     TEXT NOT NULL DEFAULT 'docx',   -- docx（文字记录文档）| minutes（妙记转写接口）
      index_text      TEXT NOT NULL,             -- 索引文本：智能纪要正文，或逐字稿开头兜底
      index_source    TEXT NOT NULL,             -- summary | transcript_head
      summary_url     TEXT,                      -- 智能纪要文档回链（有才填）
      doc_url         TEXT,                      -- 逐字稿/妙记回链
      chunk_count     INTEGER DEFAULT 0,
      embedding       TEXT,
      embedding_model TEXT,
      updated_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ts_date ON transcript_sessions(session_date);
  `);

  console.log(existed
    ? '✅ M28 migration skipped: transcript_sessions 已存在'
    : '✅ M28 migration done: 新建 transcript_sessions 表');
  db.close();
}

if (process.argv[1] && process.argv[1].includes('migrate-m28')) migrateM28();
