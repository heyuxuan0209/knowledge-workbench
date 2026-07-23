// M17 迁移（2026-07-21 飞书接入 · ADR-037）：飞书「待整理」暂存表 feishu_inbox。
//
// 为什么单开一张表、不塞进 ideas：
//  1) ideas.status 有 CHECK 约束（suggested/adopted/dismissed/created），塞不进"待整理"这个中间态；
//  2) 飞书原始捕获（文档/妙记/群聊）在用户分诊前既不是灵感也不是素材，混进 ideas 会污染灵感库/看板；
//  3) 分诊后才落地：文档/纪要→采纳为素材(notes)，群聊/想法→提为灵感(走 createIdea, source_kind='feishu')。
// 这样"所有连接器统一 POST 到 /api/ideas/ingest"这条接缝在「提为灵感」这一步兑现，核心库不依赖飞书凭证。
//
// feishu_id 唯一 → sync 幂等（同一篇文档/同一条消息重复拉取只留一条）。幂等：表已存在则跳过。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM17() {
  const db = new DatabaseSync(DB_PATH);
  const exists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='feishu_inbox'"
  ).get();
  if (exists) {
    console.log('✅ M17 migration skipped: feishu_inbox 已存在');
    db.close();
    return;
  }
  db.exec(`
    CREATE TABLE feishu_inbox (
      id            TEXT PRIMARY KEY,
      obj_type      TEXT NOT NULL,                      -- docx | minute | message | wiki
      feishu_id     TEXT NOT NULL UNIQUE,               -- 飞书侧唯一 id（document_id/minute_token/message_id/node_token），去重键
      title         TEXT,
      snippet       TEXT,                               -- 短预览（消息=正文本身；文档=标题/摘要，正文分诊时再抓）
      url           TEXT,                               -- 回链
      author        TEXT,                               -- 发送人/所有者（可空）
      source_name   TEXT,                               -- 群名/文件夹/知识库名（可空）
      extra         TEXT DEFAULT '{}',                  -- JSON：抓正文所需的额外定位（chat_id/obj_token/space_id 等）
      suggested     TEXT NOT NULL DEFAULT 'idea',       -- 建议去向：material | idea
      status        TEXT NOT NULL DEFAULT 'pending',    -- pending | accepted | ignored
      result_kind   TEXT,                               -- 分诊后落地类型：note | idea
      result_id     TEXT,                               -- 落地对象 id
      feishu_time   TEXT,                               -- 飞书侧创建/修改时间（排序用）
      created_at    TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_feishu_inbox_status ON feishu_inbox(status);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_feishu_inbox_type ON feishu_inbox(obj_type);');
  console.log('✅ M17 migration done: 新建 feishu_inbox 表');
  db.close();
}

// 路径含中文目录「项目」，不能用 import.meta.url === `file://${argv[1]}` 判断入口（百分号编码不相等）
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM17();
}
