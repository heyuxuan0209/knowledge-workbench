// 按「意思」检索逐字稿知识库（两段式：先选场，再进场内找原话）。
//
//   node scripts/search-transcripts.mjs "我想做个能把长文变成可搜笔记的东西" [--limit=8] [--json] [--flat]
//
// 为什么要两段：口语材料的片级向量区分度天然低。实测搜「护城河」，全库扁平比对最高分
// 只有 0.393，top1 还是某场录音里混进的影视解说——片一多就互相淹没。
// 于是先在几十条**场次索引**（一场一条，正文优先用飞书智能纪要）上选出最像的几场，
// 再只在这几场的片里找。纪要负责「去哪一场」，逐字稿负责「那句原话」。
//
// 保底：路由选中的片排前面，全库扁平结果仍然垫在后面。路由判错也不会比改之前更差
// ——这是不引入回退风险的关键。--flat 可强制只走老路做对照。
import 'dotenv/config';
import { getDatabase } from '../src/db/init.js';
import { embedText, cosine, MODEL_NAME } from '../src/services/embeddings.js';

const args = process.argv.slice(2);
const q = args.find((a) => !a.startsWith('--'));
const limit = Number(args.find((a) => a.startsWith('--limit='))?.slice(8) || 8);
const asJson = args.includes('--json');
const flatOnly = args.includes('--flat');
const TOP_SESSIONS = Number(args.find((a) => a.startsWith('--sessions='))?.slice(11) || 3);
// 路由信心阈值：最像的那场都没到这个分，说明 query 太短/太泛，场次索引给不出可信判断，
// 此时**不路由**，直接走扁平。实测：问「做法律 AI 创业，护城河在哪」top 场 0.602，路由是对的；
// 只丢一个词「护城河」top 场才 0.326，路由会把不相干的场顶到第一——比不路由更差。
const ROUTE_MIN = Number(args.find((a) => a.startsWith('--route-min='))?.slice(12) || 0.45);
if (!q) { console.error('用法：node scripts/search-transcripts.mjs "<问题>" [--limit=8] [--json] [--flat]'); process.exit(1); }

const db = getDatabase();
const rows = db.prepare(`SELECT id, file_token, session_title, session_date, seq, speaker, timecode, text, doc_url, embedding, embedding_model
                         FROM transcript_chunks WHERE embedding IS NOT NULL`).all();
const sessions = flatOnly ? [] : db.prepare(`SELECT file_token, session_title, session_date, index_source, summary_url, embedding
                         FROM transcript_sessions WHERE embedding IS NOT NULL AND embedding_model = ?`).all(MODEL_NAME);
db.close();
if (!rows.length) { console.error('库里还没有数据，先跑 ingest-transcripts.mjs'); process.exit(1); }

const stale = rows.filter((r) => r.embedding_model !== MODEL_NAME).length;
if (stale) console.error(`⚠️ ${stale} 片是用别的模型嵌的，结果可能不可比（当前 ${MODEL_NAME}）`);
if (!flatOnly && !sessions.length) console.error('⚠️ 还没有场次索引（先跑 ingest-transcript-sessions.mjs），本次退回扁平检索');

const qv = await embedText(q, { isQuery: true });

// ── 第一段：选场 ────────────────────────────────────────
const sessionScores = sessions
  .map((s) => ({ ...s, score: cosine(qv, JSON.parse(s.embedding)) }))
  .sort((a, b) => b.score - a.score);
const confident = sessionScores.length && sessionScores[0].score >= ROUTE_MIN;
const routed = confident ? sessionScores.slice(0, TOP_SESSIONS) : [];
const routedTokens = new Set(routed.map((s) => s.file_token));

// ── 第二段：片级打分 ────────────────────────────────────
const scored = rows
  .map((r) => ({ ...r, score: cosine(qv, JSON.parse(r.embedding)) }))
  .sort((a, b) => b.score - a.score);

// 选中场次内的片排前面，全库其余的垫后面当保底
const ranked = routedTokens.size
  ? [...scored.filter((r) => routedTokens.has(r.file_token)), ...scored.filter((r) => !routedTokens.has(r.file_token))]
  : scored;

// 同场相邻片合并：一场里挑分最高的片，把它紧邻的片一并带出来当上下文
const picked = [];
const used = new Set();
for (const r of ranked) {
  if (picked.length >= limit) break;
  if (used.has(r.id)) continue;
  const neighbours = scored.filter((x) => x.session_title === r.session_title && Math.abs(x.seq - r.seq) <= 1);
  neighbours.forEach((n) => used.add(n.id));
  picked.push({
    ...r,
    routed: routedTokens.has(r.file_token),
    context: neighbours.sort((a, b) => a.seq - b.seq).map((n) => n.text).join('\n'),
  });
}

if (asJson) { console.log(JSON.stringify(picked.map(({ embedding, ...x }) => x), null, 2)); process.exit(0); }

console.log(`\n问题：${q}\n${'═'.repeat(60)}`);
if (!flatOnly && !confident && sessionScores.length) {
  console.log(`（场次路由未启用：最像的一场只有 ${sessionScores[0].score.toFixed(3)}，低于 ${ROUTE_MIN}，本次走扁平检索）`);
  console.log('─'.repeat(60));
}
if (routed.length) {
  console.log('路由选中的场次：');
  const SRC = { summary: '按纪要', llm_summary: '按AI描述', transcript_head: '按开头' };
  for (const s of routed) console.log(`  · ${s.score.toFixed(3)}  ${s.session_title}  [${SRC[s.index_source] || s.index_source}]`);
  console.log('─'.repeat(60));
}
for (const [i, r] of picked.entries()) {
  console.log(`\n【${i + 1}】相似度 ${r.score.toFixed(3)}${routed.length ? (r.routed ? ' ·「选中场次」' : ' ·（保底全库）') : ''}  ·  ${r.session_title}`);
  console.log(`     ${r.speaker} @ ${r.timecode}  ·  ${r.doc_url}`);
  console.log(`     ${r.text.replace(/\n/g, '\n     ').slice(0, 600)}`);
}
