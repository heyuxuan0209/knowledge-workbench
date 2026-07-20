// M12 迁移（2026-07-20 灵感库）：给 ideas 加 source_kind + source_ref，
// 把"选题种子"扶正成一级灵感库——种子不只 AI 生成，还能来自用户手记 / 资讯收进 /
// 飞书等外部连接器。source_kind ∈ ai|user|feed|feishu|external；
// source_ref 存回链（JSON 或 URL），让一条灵感能跳回它的出处（飞书文档/消息链接等）。
// 幂等：列已存在则跳过。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM12() {
  const db = new DatabaseSync(DB_PATH);
  const cols = db.prepare('PRAGMA table_info(ideas)').all().map(c => c.name);
  const adds = [];
  if (!cols.includes('source_kind')) {
    db.exec("ALTER TABLE ideas ADD COLUMN source_kind TEXT DEFAULT 'ai';");
    adds.push('source_kind');
  }
  if (!cols.includes('source_ref')) {
    db.exec('ALTER TABLE ideas ADD COLUMN source_ref TEXT;');
    adds.push('source_ref');
  }
  // 历史 ideas 均由 AI 从报告生成，回填 source_kind='ai'（新加列默认已是 'ai'，此处兜底旧空值）
  db.exec("UPDATE ideas SET source_kind = 'ai' WHERE source_kind IS NULL;");
  db.exec('CREATE INDEX IF NOT EXISTS idx_ideas_source_kind ON ideas(source_kind);');
  console.log(adds.length
    ? `✅ M12 migration done: 新增列 ideas.${adds.join(', ideas.')}`
    : '✅ M12 migration skipped: ideas.source_kind / source_ref 已存在');
  db.close();
}

// 路径含中文目录，不能用 import.meta.url === `file://${argv[1]}` 判断入口
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM12();
}
