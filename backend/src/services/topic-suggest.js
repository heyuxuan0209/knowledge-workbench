import { getDatabase } from '../db/init.js';
import { embedBatch, cosine, MODEL_NAME } from './embeddings.js';
import { chat } from './llm.js';

function safeKw(s) { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }

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

// 新主题启发（VISION-V4 ③）：把"彼此语义相关、但不属于任何现有主题"的素材聚成堆，
// 建议你建个新主题（治"有被忽略的主题"）。语义聚类 + LLM 起名，比关键词 union-find 准。
// 返回 shape 与 note-clusters.getClusterSuggestions 对齐，复用前端"聚成新主题"横条。
async function nameClusters(clusters) {
  const list = clusters.map((c, i) => `${i + 1}. ${c._titles.slice(0, 5).map(t => (t || '').slice(0, 30)).join(' / ')}`).join('\n');
  const prompt = `下面每组是语义相关的素材标题。给每组起一个简洁的中文主题名（4-10字，概括这组的共同主题，别用引号）。
${list}

只输出 JSON（不要 markdown）：{"1":"主题名","2":"主题名",...}，覆盖 1 到 ${clusters.length}。`;
  try {
    const r = await chat([{ role: 'user', content: prompt }]);
    const p = JSON.parse(r.content.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim());
    clusters.forEach((c, i) => { c.suggestedName = (p[String(i + 1)] || c.sharedKeywords[0] || '新主题').slice(0, 20); });
  } catch {
    clusters.forEach(c => { c.suggestedName = c.sharedKeywords[0] || '新主题'; });
  }
}

export async function suggestNewTopics({ clusterSim = 0.6, minCluster = 3, coveredSim = 0.58 } = {}) {
  const db = getDatabase();
  const notes = db.prepare('SELECT id, title, excerpt, source_title, keywords, embedding FROM notes WHERE embedding IS NOT NULL AND embedding_model = ?').all(MODEL_NAME);
  const topics = db.prepare('SELECT id, name, description, body FROM topics').all();
  db.close();
  if (notes.length < minCluster) return [];

  const vecs = notes.map(n => parseVec(n.embedding));
  const topicVecs = topics.length ? await embedBatch(topics.map(topicText), { isQuery: false }) : [];

  // 只在"无家可归"的素材里聚类：对所有现有主题相似度都 < coveredSim 的才算候选。
  // 这样既避开"全库都是 AI、union-find 把所有东西链成一坨"的问题，又精确对应"你还没有的主题"。
  const cand = [];
  for (let i = 0; i < notes.length; i++) {
    if (!vecs[i]) continue;
    let best = 0;
    for (const tv of topicVecs) { const s = cosine(vecs[i], tv); if (s > best) best = s; }
    if (best < coveredSim) cand.push(i);
  }
  if (cand.length < minCluster) return [];

  // 候选之间语义聚类（数量少，不会成一坨）
  const parent = new Map(cand.map(i => [i, i]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  for (let a = 0; a < cand.length; a++) for (let b = a + 1; b < cand.length; b++) {
    if (cosine(vecs[cand[a]], vecs[cand[b]]) >= clusterSim) union(cand[a], cand[b]);
  }
  const groups = new Map();
  for (const i of cand) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }

  const out = [];
  for (const members of groups.values()) {
    if (members.length < minCluster) continue;
    const kwCount = {};
    for (const m of members) safeKw(notes[m].keywords).forEach(k => { kwCount[k] = (kwCount[k] || 0) + 1; });
    const shared = Object.entries(kwCount).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 5);
    out.push({
      noteIds: members.map(m => notes[m].id),
      notes: members.map(m => ({ id: notes[m].id, title: notes[m].title, excerpt: (notes[m].excerpt || '').slice(0, 140), source_title: notes[m].source_title })),
      sharedKeywords: shared.length ? shared : ['语义相关'],
      _titles: members.map(m => notes[m].title || notes[m].source_title || ''),
    });
  }
  if (out.length) await nameClusters(out);
  return out.map(({ _titles, ...s }) => s).sort((a, b) => b.noteIds.length - a.noteIds.length);
}
