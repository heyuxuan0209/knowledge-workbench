import dotenv from 'dotenv';
dotenv.config();

import { getDatabase } from '../db/init.js';
import { setNoteTitle } from '../db/notes.js';
import { chat } from './llm.js';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolve } from 'path';

// 素材标题生成（M4 可用性）：保存素材后后台起一个 ≤12 字的人话标题，
// 解决"素材列表全是粘贴 URL 和 AI 开场白，认不出哪张是哪张"的问题。
// 单条一次 Deepseek 调用（¥0.0002 级）；失败不影响素材本身（title 留空，
// 前端回退显示来源标题）。CLI 直跑 = 回填所有无标题存量素材。

export async function generateNoteTitle(noteId, excerpt) {
  try {
    const result = await chat([{
      role: 'user',
      content: `给这段知识素材起一个中文标题，要求：12 字以内、说清核心内容是什么（不要"关于/浅谈"这类空词）、只输出标题本身。\n\n${excerpt.slice(0, 1500)}`,
    }]);
    if (!result.success) throw new Error(result.error);
    const title = result.content.trim().replace(/^["「《#\s]+|["」》\s]+$/g, '').slice(0, 24);
    if (title) setNoteTitle(noteId, title);
    return title || null;
  } catch (err) {
    console.error(`[note-title] ${noteId} 标题生成失败:`, err.message);
    return null;
  }
}

// 回填存量：cd backend && node src/services/note-title.js
export async function backfillTitles() {
  const db = getDatabase();
  const rows = db.prepare("SELECT id, excerpt FROM notes WHERE title IS NULL OR title = ''").all();
  db.close();
  console.log(`🔄 ${rows.length} 张素材待补标题`);
  let done = 0;
  for (const n of rows) {
    const t = await generateNoteTitle(n.id, n.excerpt);
    if (t) { done++; console.log(`  ✓ ${t}`); }
  }
  console.log(`✅ 补齐 ${done}/${rows.length}`);
  return done;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  backfillTitles().then(() => process.exit(0));
}
