import { getDatabase } from '../db/init.js';
import { embedBatch, cosine, MODEL_NAME } from './embeddings.js';

// P2 规则1 · 关联层重算（大扫除最大头，HANDOFF §P2）：
// 病根——note_topics 的相关度是词面 TF cosine 乱挂的（183/212 <0.4、每素材平均归 6 个主题），
// 且 topics.centroid_embedding 0/19 全空（主题侧向量没通电）。
// 修：① 给每个主题算 bge-m3 centroid（成员素材向量均值，空主题用 名称+描述）→ 落库；
//     ② 用 centroid 重算全部关联相关度（替代词面 TF）；
//     ③ 提议移除：AI 关联新相关度 <0.45，或超出每素材 top-3 封顶（用户手动归的永远保留）。
// 全部是"提议"，用户裁决后才 apply；归档/移除不删素材本身。

const REL_THRESHOLD = 0.45; // 起试值（bge-m3 展开分布 0.32-0.62，设计窗口按首周校准）
const TOP_K = 3;            // 每素材归属封顶

function parseVec(json) { try { const v = JSON.parse(json); return Array.isArray(v) && v.length ? v : null; } catch { return null; } }
function topicText(t) { let cur = ''; try { cur = (JSON.parse(t.body || '{}').current || ''); } catch { /* noop */ } return `${t.name}。${t.name}。${t.description || ''} ${cur}`.slice(0, 2000); }
function meanNorm(vecs) { const d = vecs[0].length, c = new Array(d).fill(0); for (const v of vecs) for (let i = 0; i < d; i++) c[i] += v[i]; let n = 0; for (const x of c) n += x * x; n = Math.sqrt(n) || 1; return c.map(x => x / n); }

// 给所有主题算 centroid 并落库；返回 Map<topicId, vec>。
// centroid = 已并入(assimilated)成员素材向量均值；没有则用 名称+描述 embedding（空主题也能通电）。
export async function computeTopicCentroids() {
  const db = getDatabase();
  const topics = db.prepare('SELECT id, name, description, body FROM topics').all();
  const noteVecRows = db.prepare(`
    SELECT nt.topic_id, n.embedding
    FROM note_topics nt JOIN notes n ON nt.note_id = n.id
    WHERE nt.status = 'assimilated' AND n.embedding IS NOT NULL AND n.embedding_model = ?
  `).all(MODEL_NAME);
  const membersByTopic = new Map();
  for (const r of noteVecRows) {
    const v = parseVec(r.embedding); if (!v) continue;
    if (!membersByTopic.has(r.topic_id)) membersByTopic.set(r.topic_id, []);
    membersByTopic.get(r.topic_id).push(v);
  }
  // 空主题（无 assimilated 成员向量）用 名称+描述 embedding 兜底
  const needText = topics.filter(t => !membersByTopic.get(t.id)?.length);
  const textVecs = needText.length ? await embedBatch(needText.map(topicText), { isQuery: false }) : [];
  const textVecById = new Map(needText.map((t, i) => [t.id, textVecs[i]]));

  const centroids = new Map();
  const upd = db.prepare("UPDATE topics SET centroid_embedding = ?, updated_at = datetime('now') WHERE id = ?");
  for (const t of topics) {
    const mem = membersByTopic.get(t.id);
    const c = mem?.length ? meanNorm(mem) : textVecById.get(t.id);
    if (!c) continue;
    centroids.set(t.id, c);
    upd.run(JSON.stringify(c), t.id);
  }
  db.close();
  return centroids;
}

// 用 centroid 重算全部关联相关度并落库（纯数据改进，可独立跑）。返回重算条数。
export async function recomputeRelevance(centroids = null) {
  const cent = centroids || await computeTopicCentroids();
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT nt.note_id, nt.topic_id, n.embedding
    FROM note_topics nt JOIN notes n ON nt.note_id = n.id
    WHERE n.embedding IS NOT NULL AND n.embedding_model = ?
  `).all(MODEL_NAME);
  const upd = db.prepare('UPDATE note_topics SET relevance = ? WHERE note_id = ? AND topic_id = ?');
  let n = 0;
  for (const r of rows) {
    const nv = parseVec(r.embedding), cv = cent.get(r.topic_id);
    if (!nv || !cv) continue;
    upd.run(Math.round(cosine(nv, cv) * 1000) / 1000, r.note_id, r.topic_id);
    n++;
  }
  db.close();
  return { recomputed: n };
}

// 提议移除清单（不落库）：AI 关联新相关度 <0.45，或超出每素材 top-3 封顶。用户手动归的永远保留。
// 返回按主题分组的"将移除"关联 + 汇总。先跑 computeTopicCentroids + recomputeRelevance。
export async function proposeAssociationCleanup() {
  await recomputeRelevance();
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT nt.note_id, nt.topic_id, nt.relevance, nt.added_by, nt.status,
           COALESCE(n.title, n.source_title, '(无标题)') AS note_title,
           t.name AS topic_name
    FROM note_topics nt
    JOIN notes n ON nt.note_id = n.id
    JOIN topics t ON nt.topic_id = t.id
  `).all();
  db.close();

  // 按素材分组，决定每条去留
  const byNote = new Map();
  for (const r of rows) { if (!byNote.has(r.note_id)) byNote.set(r.note_id, []); byNote.get(r.note_id).push(r); }
  const toRemove = [];
  for (const [, links] of byNote) {
    const user = links.filter(l => l.added_by === 'user');
    const ai = links.filter(l => l.added_by !== 'user').sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
    const keepAiCount = Math.max(0, TOP_K - user.length); // 用户归的占坑，剩下的名额给高分 AI
    ai.forEach((l, i) => {
      const belowThreshold = (l.relevance || 0) < REL_THRESHOLD;
      const beyondTopK = i >= keepAiCount;
      if (belowThreshold || beyondTopK) {
        toRemove.push({ ...l, reason: belowThreshold ? 'low' : 'overflow' });
      }
    });
  }

  // 按主题分组展示
  const byTopic = new Map();
  for (const r of toRemove) {
    if (!byTopic.has(r.topic_id)) byTopic.set(r.topic_id, { topicId: r.topic_id, topicName: r.topic_name, items: [] });
    byTopic.get(r.topic_id).items.push({
      noteId: r.note_id, topicId: r.topic_id, noteTitle: r.note_title,
      relevance: r.relevance, status: r.status, reason: r.reason,
    });
  }
  const groups = [...byTopic.values()].map(g => ({ ...g, items: g.items.sort((a, b) => (a.relevance || 0) - (b.relevance || 0)) }))
    .sort((a, b) => b.items.length - a.items.length);
  const total = db2Count();
  return { groups, removeCount: toRemove.length, totalBefore: total, expectedAfter: total - toRemove.length };
}

function db2Count() { const db = getDatabase(); const c = db.prepare('SELECT COUNT(*) c FROM note_topics').get().c; db.close(); return c; }

// 应用：删除用户接受的 [note_id, topic_id] 关联（提议移除里的子集）。归档不删素材本身。
export function applyAssociationCleanup(pairs = []) {
  if (!pairs.length) return { removed: 0 };
  const db = getDatabase();
  const del = db.prepare('DELETE FROM note_topics WHERE note_id = ? AND topic_id = ?');
  let removed = 0;
  db.exec('BEGIN');
  try {
    for (const p of pairs) { removed += del.run(p.noteId ?? p.note_id, p.topicId ?? p.topic_id).changes; }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); db.close(); throw e; }
  db.close();
  return { removed };
}
