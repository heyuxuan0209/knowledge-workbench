// 把上传链路留下的双重编码标题回正，并重建这些行的向量。
//
//   node scripts/fix-mojibake-titles.mjs [--dry]
//
// 根因已在入口处堵住（src/util/decode-filename.js）；这个脚本只清历史数据。
// 注意 `[音频] xxx` 这种前缀标记本身是好的 UTF-8，跟着一起 latin1 反解会被打成 U+FFFD——
// 所以按「已经是合法中文的片段」切开，只回正坏掉的那部分。
import 'dotenv/config';
import { getDatabase } from '../src/db/init.js';
import { embedText, MODEL_NAME } from '../src/services/embeddings.js';

const dry = process.argv.includes('--dry');
const CJK = /[一-龥]/;

/** 整段 latin1 反解，只在「转完是合法中文」时才采用 */
function decodeWhole(s) {
  try {
    const d = Buffer.from(s, 'latin1').toString('utf8');
    return d !== s && CJK.test(d) && !d.includes(String.fromCharCode(0xFFFD)) ? d : s;
  } catch { return s; }
}

// 这些标题的形状是「KW 自己加的前缀 + 原始文件名」，例如 [音频] + 一串乱码。
// 前缀是代码里写死的、本来就是合法 UTF-8；坏的只有后面那段文件名。
// 所以必须先切开再整段转——**不能逐段扫**：坏段里夹着 ASCII（空格、Demo Day # 4），
// 按字符类切会把一个 UTF-8 序列拦腰截断，转出来是半通不通的「让 AI æ¥ä½...」。
function repair(s) {
  if (!s) return s;
  const m = s.match(/^(\[[^\]]*\]\s*)([\s\S]*)$/);
  if (m) return m[1] + decodeWhole(m[2]);
  return decodeWhole(s);
}

const db = getDatabase();
const rows = db.prepare('SELECT id, title, source_title, excerpt FROM notes').all();
db.close();

const todo = rows
  .map((r) => ({ ...r, fixedTitle: repair(r.title), fixedSource: repair(r.source_title) }))
  .filter((r) => r.fixedTitle !== r.title || r.fixedSource !== r.source_title);

console.log(`扫了 ${rows.length} 条素材，需要回正 ${todo.length} 条\n`);
for (const r of todo) {
  if (r.fixedSource !== r.source_title) console.log(`  ${r.source_title}\n    → ${r.fixedSource}`);
  if (r.fixedTitle !== r.title) console.log(`  ${r.title}\n    → ${r.fixedTitle}`);
}
if (dry || !todo.length) process.exit(0);

// source_title 参与 embedding（semantic-search 的 noteText），回正后必须重建向量，
// 否则库里存的还是那串乱码的语义。
for (const r of todo) {
  const head = [r.fixedTitle, r.fixedSource].filter(Boolean).join(' · ');
  const vec = await embedText(`${head}\n${r.excerpt || ''}`.trim(), { isQuery: false });
  const db2 = getDatabase();
  db2.prepare(`UPDATE notes SET title = ?, source_title = ?, embedding = ?, embedding_model = ?,
               updated_at = datetime('now') WHERE id = ?`)
    .run(r.fixedTitle, r.fixedSource, JSON.stringify(vec), MODEL_NAME, r.id);
  db2.close();
}
console.log(`\n✅ 回正 ${todo.length} 条并重建向量`);
