// M29 迁移（2026-08-12）：妙记待确认清单。
// 背景：新会议要自动进检索，但他的妙记里混着测试录音（「新录音 12」「机器人测试」）。
// 靠时长判不了——实测 49 场真实场次里最短的只有 4 分钟，跟测试录音的长度完全重叠。
// 最强的信号是标题：他给一场录音改名这个动作，本身就表示「这场我在乎」；
// 留着飞书默认名（新录音 N）或写明测试的，就是不要的。
// 决策：自动抓 + 自动按规则处置，但每一场都留一行在这张表里，判错了能一句话翻案。
// 幂等：表已存在则跳过。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM29() {
  const db = new DatabaseSync(DB_PATH);
  const existed = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='minute_watchlist'").get();

  db.exec(`
    CREATE TABLE IF NOT EXISTS minute_watchlist (
      minute_token  TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      summary_doc   TEXT,                     -- 智能纪要 docx token
      minute_url    TEXT,
      duration_min  INTEGER,
      chars         INTEGER,
      verdict       TEXT NOT NULL,            -- keep（该入库）| test（判为测试）| dup（跟已入库的重复）
      reason        TEXT,                     -- 判成这样的依据，发给他看的就是这句
      status        TEXT NOT NULL DEFAULT 'pending',  -- pending | ingested | skipped | failed
      note          TEXT,                     -- 失败原因 / 他事后翻案的记录
      discovered_at TEXT DEFAULT (datetime('now')),
      decided_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mw_status ON minute_watchlist(status);
  `);

  console.log(existed
    ? '✅ M29 migration skipped: minute_watchlist 已存在'
    : '✅ M29 migration done: 新建 minute_watchlist 表');
  db.close();
}

if (process.argv[1] && process.argv[1].includes('migrate-m29')) migrateM29();
