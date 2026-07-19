import { getDatabase } from '../db/init.js';
import { embedBatch, cosine, MODEL_NAME } from './embeddings.js';

// 语义补归类建议（VISION-V4：用 1a 向量替代词面 TF 余弦，治"凭感性归错/漏归"）：
// 每条素材向量 vs 每个主题向量，找它语义贴合、但你还没标的主题 → 建议归入。
// 一条素材可贴合多个主题（多主题），跨用词也能抓——比词面匹配准得多。

function parseVec(json) {
  try { const v = JSON.parse(json); return Array.isArray(v) && v.length ? v : null; } catch { return null; }
}

// 主题的语义文本：名字（重）+ 描述 + 当前综述（有多少算多少）
function topicText(t) {
  let cur = '';
  try { cur = (JSON.parse(t.body || '{}').current || ''); } catch { /* noop */ }
  return `${t.name}。${t.name}。${t.description || ''} ${cur}`.slice(0, 2000);
}

// 阈值 0.58：只出高置信"漏归"（实测更低会把弱相关全推出来，反增负担；主题综述成型后会自然多起来）
export async function suggestTopicsForAllNotes({ minScore = 0.58, perNote = 2 } = {}) {
  const db = getDatabase();
  const notes = db.prepare('SELECT id, embedding FROM notes WHERE embedding IS NOT NULL AND embedding_model = ?').all(MODEL_NAME);
  const topics = db.prepare('SELECT id, name, description, body FROM topics').all();
  const links = db.prepare('SELECT note_id, topic_id FROM note_topics').all();
  db.close();
  if (!notes.length || !topics.length) return { suggestions: {}, noteCount: 0 };

  const assigned = new Map();
  for (const l of links) {
    if (!assigned.has(l.note_id)) assigned.set(l.note_id, new Set());
    assigned.get(l.note_id).add(l.topic_id);
  }

  const topicVecs = await embedBatch(topics.map(topicText), { isQuery: false });

  const suggestions = {};
  let noteCount = 0;
  for (const n of notes) {
    const v = parseVec(n.embedding);
    if (!v) continue;
    const a = assigned.get(n.id) || new Set();
    const matches = [];
    topics.forEach((t, i) => {
      if (a.has(t.id)) return; // 已标的不再建议
      const s = cosine(v, topicVecs[i]);
      if (s >= minScore) matches.push({ topicId: t.id, name: t.name, score: Math.round(s * 1000) / 1000 });
    });
    if (matches.length) {
      matches.sort((x, y) => y.score - x.score);
      suggestions[n.id] = matches.slice(0, perNote);
      noteCount++;
    }
  }
  return { suggestions, noteCount };
}
