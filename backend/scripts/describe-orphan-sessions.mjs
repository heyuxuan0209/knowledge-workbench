// 给「没有智能纪要」的场次补一段场次描述，让它们的索引跟有纪要的那批同一水准。
//
//   node scripts/describe-orphan-sessions.mjs [--dry] [--force]
//
// 背景：场次索引优先用飞书智能纪要正文当索引文本；有 8 场没有纪要，退回拿逐字稿开头凑，
// 而开头往往是寒暄和调试设备，压不住这场真正在讲什么——实测「护城河」那次误路由，
// 顶上来的正是这类兜底索引的场次。
// 于是拿逐字稿采样喂给 DeepSeek，让它写一段**只描述这场讲了什么**的索引文本，
// 形态对齐智能纪要：主题 + 参与者在争什么 + 关键词。写回 index_text 并重建向量。
//
// 只处理 index_source = 'transcript_head' 的场次；--force 可重做全部。
import 'dotenv/config';
import { getDatabase } from '../src/db/init.js';
import { chat } from '../src/services/llm.js';
import { embedText, MODEL_NAME } from '../src/services/embeddings.js';

const dry = process.argv.includes('--dry');
const force = process.argv.includes('--force');
const SAMPLE_CHARS = 9000;   // 采样上限：头 + 中 + 尾各取一段，避免只看开头的寒暄

const PROMPT = `你在为一个逐字稿检索库写「场次索引」。下面是一场录音的逐字稿采样（头/中/尾三段）。

请写一段 200-300 字的中文描述，只回答这一场**在讲什么**：
- 第一句点出这场的主题和场合类型（分享/对谈/讨论/演示/参观…）
- 然后写清楚讨论了哪几件事、谁在主张什么、有没有分歧
- 最后一行以「关键词：」开头，列 8-15 个这场特有的名词（人名、公司、产品、专有概念）

要求：只描述内容，不要评价，不要写「本场录音」之类的套话，不要分点编号，直接出正文。
如果采样里大段是寒暄、设备调试或与主题无关的闲聊，忽略它们。`;

function sample(text) {
  if (text.length <= SAMPLE_CHARS) return text;
  const n = Math.floor(SAMPLE_CHARS / 3);
  const mid = Math.floor(text.length / 2);
  return [text.slice(0, n), text.slice(mid - n / 2, mid + n / 2), text.slice(-n)].join('\n……\n');
}

const db0 = getDatabase();
const targets = db0.prepare(`SELECT file_token, session_title, session_date, index_source
                             FROM transcript_sessions
                             WHERE ${force ? '1=1' : "index_source = 'transcript_head'"}`).all();
db0.close();
console.log(`要处理 ${targets.length} 场`);

let spent = 0;
for (const t of targets) {
  const db = getDatabase();
  const chunks = db.prepare('SELECT text FROM transcript_chunks WHERE file_token = ? ORDER BY seq').all(t.file_token);
  db.close();
  const body = chunks.map((c) => c.text).join('\n');
  if (!body.trim()) { console.log(`  ⚠️  没有正文，跳过  ${t.session_title}`); continue; }

  if (dry) { console.log(`  [dry] ${chunks.length} 片 / ${body.length} 字  ${t.session_title}`); continue; }

  const res = await chat([
    { role: 'system', content: PROMPT },
    { role: 'user', content: `场次标题：${t.session_title}\n日期：${t.session_date || '未知'}\n\n${sample(body)}` },
  ], 'deepseek');

  if (!res.success || !res.content?.trim()) { console.log(`  ❌ 生成失败  ${t.session_title}`); continue; }
  spent += res.cost || 0;

  const indexText = res.content.trim();
  const vec = await embedText(`${t.session_title}\n${indexText}`, { isQuery: false });
  const db2 = getDatabase();
  db2.prepare(`UPDATE transcript_sessions
               SET index_text = ?, index_source = 'llm_summary', embedding = ?, embedding_model = ?, updated_at = datetime('now')
               WHERE file_token = ?`)
    .run(indexText, JSON.stringify(vec), MODEL_NAME, t.file_token);
  db2.close();
  console.log(`  ✅ ${t.session_title}\n     ${indexText.replace(/\n/g, ' ').slice(0, 110)}…`);
}

if (!dry) {
  const db = getDatabase();
  const s = db.prepare(`SELECT SUM(index_source='summary') s, SUM(index_source='llm_summary') l,
                               SUM(index_source='transcript_head') h FROM transcript_sessions`).get();
  db.close();
  console.log(`\n索引来源：智能纪要 ${s.s} / AI 生成 ${s.l} / 逐字稿开头 ${s.h || 0}　·　本次花费约 ¥${spent.toFixed(4)}`);
}
