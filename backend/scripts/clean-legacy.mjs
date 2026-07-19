// 一次性数据清洗（配合本轮 UI 改造）：
//  1) 已存素材/精读稿的 AI 开场白剥离（新入库已在 createNote/interpretation 处理，这里洗旧的）
//  2) 分类 观点方法 → 观点
//  3) 主题演进记录（changelog）里的历史"并入" → "收进"，与新术语一致
import { getDatabase } from '../src/db/init.js';
import { stripPreamble } from '../src/util/strip-preamble.js';

const db = getDatabase();
let nNote = 0, nInt = 0, nCat = 0, nCl = 0;

// 1a. notes.excerpt
const upNote = db.prepare('UPDATE notes SET excerpt = ? WHERE id = ?');
for (const r of db.prepare('SELECT id, excerpt FROM notes').all()) {
  const cleaned = stripPreamble(r.excerpt || '');
  if (cleaned && cleaned !== (r.excerpt || '').trim()) { upNote.run(cleaned, r.id); nNote++; }
}

// 1b. contents.interpretation（精读稿缓存）
const upInt = db.prepare('UPDATE contents SET interpretation = ? WHERE id = ?');
for (const r of db.prepare("SELECT id, interpretation FROM contents WHERE interpretation IS NOT NULL AND interpretation != ''").all()) {
  const cleaned = stripPreamble(r.interpretation);
  if (cleaned && cleaned !== r.interpretation.trim()) { upInt.run(cleaned, r.id); nInt++; }
}

// 2. 分类改名
nCat = db.prepare("UPDATE contents SET category = '观点' WHERE category = '观点方法'").run().changes;

// 3. changelog 历史"并入" → "收进"
const upCl = db.prepare('UPDATE topic_changelog SET summary = ? WHERE id = ?');
for (const r of db.prepare("SELECT id, summary FROM topic_changelog WHERE summary LIKE '%并入%'").all()) {
  upCl.run(r.summary.replaceAll('并入', '收进'), r.id); nCl++;
}

console.log(`✅ 清洗完成：素材开场白 ${nNote} 条 · 精读稿 ${nInt} 条 · 分类改名 ${nCat} 条 · changelog并入→收进 ${nCl} 条`);
db.close();
process.exit(0);
