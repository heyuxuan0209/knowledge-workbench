import { getDatabase } from '../db/init.js';
import { embedText, embedBatch, cosine, MODEL_NAME } from './embeddings.js';

// 素材语义检索（VISION-V4 阶段1a）：把"模糊需求→找到对的素材"从关键词 LIKE 升级为语义。
// 规模只有几百~几千条，全量取回在 JS 里暴力算余弦即可（<50ms），不需要向量库/扩展。
// 索引与查询用同一模型（embeddings.MODEL_NAME）；行内 embedding_model 不匹配的视为过期需重建。

// 供 embedding 的文本：标题 + 来源标题 + 摘要正文（截断在 embeddings.prep 里做）。
// 标题/来源权重靠重复一次轻微加权（够用，不做复杂加权）。
function noteText(note) {
  const head = [note.title, note.source_title].filter(Boolean).join(' · ');
  return `${head}\n${note.excerpt || ''}`.trim();
}

// 解析 DB 里的 JSON 向量；坏数据当作无向量
function parseVec(json) {
  if (!json) return null;
  try { const v = JSON.parse(json); return Array.isArray(v) && v.length ? v : null; } catch { return null; }
}

// 给单条素材生成并写入向量（保存素材后台调用）
export async function embedNoteById(noteId) {
  const db = getDatabase();
  const note = db.prepare('SELECT id, title, source_title, excerpt FROM notes WHERE id = ?').get(noteId);
  if (!note) { db.close(); return false; }
  db.close();

  const vec = await embedText(noteText(note), { isQuery: false });

  const db2 = getDatabase();
  db2.prepare("UPDATE notes SET embedding = ?, embedding_model = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(vec), MODEL_NAME, noteId);
  db2.close();
  return true;
}

// 批量重建：给所有缺向量或模型过期的素材补向量（首次上线 / 换模型后跑一次）
export async function reindexNotes({ force = false } = {}) {
  const db = getDatabase();
  const rows = db.prepare('SELECT id, title, source_title, excerpt, embedding, embedding_model FROM notes').all();
  db.close();

  const todo = rows.filter(r => force || !r.embedding || r.embedding_model !== MODEL_NAME);
  if (!todo.length) return { total: rows.length, embedded: 0, skipped: rows.length };

  // 小批（4）：批内会 padding 到最长序列，长文大批会让张量爆炸变慢；bge-m3 尤甚
  let embedded = 0;
  const BATCH = 4;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const vecs = await embedBatch(batch.map(noteText), { isQuery: false });
    const db2 = getDatabase();
    const stmt = db2.prepare('UPDATE notes SET embedding = ?, embedding_model = ? WHERE id = ?');
    for (let j = 0; j < batch.length; j++) stmt.run(JSON.stringify(vecs[j]), MODEL_NAME, batch[j].id);
    db2.close();
    embedded += batch.length;
  }
  return { total: rows.length, embedded, skipped: rows.length - embedded };
}

// 语义检索：返回按余弦降序的素材（带 score）。limit 之外用 minScore 过滤过弱匹配。
// 只在有向量的素材上算；未建索引的素材不参与（首次需先 reindexNotes）。
export async function searchNotes(query, { limit = 20, minScore = 0 } = {}) {
  if (!query?.trim()) return [];
  const qvec = await embedText(query, { isQuery: true });

  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, title, excerpt, note_type, stance, source_title, source_url, content_id,
           created_at, updated_at, keywords, embedding
    FROM notes WHERE embedding IS NOT NULL
  `).all();
  db.close();

  const scored = [];
  for (const r of rows) {
    const v = parseVec(r.embedding);
    if (!v) continue;
    const score = cosine(qvec, v);
    if (score < minScore) continue;
    delete r.embedding;
    scored.push({ ...r, score: Math.round(score * 1000) / 1000 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// 索引状态（给前端提示"还有 N 条未建语义索引"）
export function indexStatus() {
  const db = getDatabase();
  const total = db.prepare('SELECT COUNT(*) c FROM notes').get().c;
  const indexed = db.prepare('SELECT COUNT(*) c FROM notes WHERE embedding IS NOT NULL AND embedding_model = ?').get(MODEL_NAME).c;
  db.close();
  return { total, indexed, model: MODEL_NAME, stale: total - indexed };
}
