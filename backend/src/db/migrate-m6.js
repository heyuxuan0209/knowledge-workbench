// M6 迁移（2026-07-16 用户反馈轮：报告可信化 + 信源修复）
// 1. note_topics.matched_terms —— 素材↔主题匹配命中的共享关键词（JSON 数组），
//    回答"为什么这条素材被并入这个主题"（此前只存相似度分数，可解释性不到关键词级）
// 2. X 源 track_mode: active-query → passive —— X 抓取器未实现（登录态渠道后置），
//    active-query 档只会被 sync 永远跳过；改 passive 走"借道 AI HOT"：AI HOT 转载的
//    同 handle 内容自动归属该信源并加权（findOrCreateSource 按 platform+handle 合并）
//
// 幂等：可重复执行。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateM6() {
  const db = new DatabaseSync(DB_PATH);
  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);

  if (!hasColumn('note_topics', 'matched_terms')) {
    db.exec('ALTER TABLE note_topics ADD COLUMN matched_terms TEXT;');
  }

  const xFixed = db.prepare(
    "UPDATE source_platforms SET track_mode = 'passive' WHERE platform = 'X' AND track_mode = 'active-query'"
  ).run().changes;

  // 3. 存量文案清洗：「活页」→「主题页」（2026-07-16 全局统一用词）。
  //    旧 changelog / 报告 / 综述是 LLM 按旧 prompt 写的，含"活页"，会持续渗回 UI 和新报告
  //    （周报 prompt 引用 changelog 原文）。REPLACE 幂等，只动 AI 生成的字段，不碰用户素材/草稿。
  let cleaned = 0;
  cleaned += db.prepare("UPDATE topic_changelog SET summary = REPLACE(summary, '活页', '主题页') WHERE summary LIKE '%活页%'").run().changes;
  cleaned += db.prepare("UPDATE topics SET body = REPLACE(body, '活页', '主题页') WHERE body LIKE '%活页%'").run().changes;
  cleaned += db.prepare("UPDATE topics SET description = REPLACE(description, '活页', '主题页') WHERE description LIKE '%活页%'").run().changes;
  for (const col of ['summary', 'trends', 'page_changes', 'emergent', 'focus']) {
    cleaned += db.prepare(`UPDATE reports SET ${col} = REPLACE(${col}, '活页', '主题页') WHERE ${col} LIKE '%活页%'`).run().changes;
  }
  for (const col of ['title', 'angle', 'why_now', 'consensus', 'non_consensus']) {
    cleaned += db.prepare(`UPDATE ideas SET ${col} = REPLACE(${col}, '活页', '主题页') WHERE ${col} LIKE '%活页%'`).run().changes;
  }

  const ok = hasColumn('note_topics', 'matched_terms');
  db.close();
  console.log('✅ M6 migration done:', { note_topics_matched_terms: ok, x_sources_repathed: xFixed, huoye_cleaned_rows: cleaned });
  return { note_topics_matched_terms: ok, x_sources_repathed: xFixed, huoye_cleaned_rows: cleaned };
}

// 路径含中文目录，不能用 import.meta.url === `file://${argv[1]}` 判断入口（百分号编码问题）
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateM6();
}
