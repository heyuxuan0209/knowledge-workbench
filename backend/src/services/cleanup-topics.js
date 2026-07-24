import { getDatabase } from '../db/init.js';
import { cosine } from './embeddings.js';
import { chat } from './llm.js';

// P2 规则2 · 主题层收编（HANDOFF §P2）：19 个主题里 10 个碎片（≤2 条且久无新增）+ 泛词主题
// （Agent/Context/技术原理/行业影响）+ 文章名当主题名 → AI 提议「解散/并入/改名」，用户逐个裁决，
// 收成 8-10 个有边界的主题。解散=归档(status='archived')不删、可恢复；并入=关联迁到目标主题后归档源。

const GENERIC = new Set(['agent', 'context', '技术原理', '行业影响']); // 泛词主题，优先解散
const FRAGMENT_MAX = 2;        // ≤2 条关联算碎片
const STALE_DAYS = 7;          // 且 ≥7 天无新增
const ARTICLE_NAME_LEN = 20;   // 名字 ≥20 字疑似"文章标题当主题名"

function parseVec(json) { try { const v = JSON.parse(json); return Array.isArray(v) && v.length ? v : null; } catch { return null; } }

export async function proposeTopicCleanup() {
  const db = getDatabase();
  const topics = db.prepare(`
    SELECT t.id, t.name, t.description, t.centroid_embedding,
      (SELECT COUNT(*) FROM note_topics nt WHERE nt.topic_id = t.id) AS assoc,
      (SELECT MAX(nt.created_at) FROM note_topics nt WHERE nt.topic_id = t.id) AS last_link
    FROM topics t WHERE t.status = 'active'
  `).all();
  // 某主题名是否正好是某条素材的标题（文章名当主题名的信号）
  const noteTitles = new Set(db.prepare("SELECT DISTINCT COALESCE(title, source_title, '') t FROM notes").all().map(r => (r.t || '').trim()).filter(Boolean));
  db.close();

  const now = Date.now();
  const daysSince = iso => iso ? (now - new Date(/[zZ+]/.test(iso) ? iso : iso + 'Z').getTime()) / 86400000 : Infinity;
  const vecById = new Map(topics.map(t => [t.id, parseVec(t.centroid_embedding)]));

  // 第一遍：分类（哪些要解散）
  const classify = (t) => {
    if (t.name.trim() === 'build in pubilc') return { kind: 'rename', suggestedName: 'build in public', reason: '拼写修正' };
    const isGeneric = GENERIC.has(t.name.trim().toLowerCase());
    const isFragment = t.assoc <= FRAGMENT_MAX && daysSince(t.last_link) >= STALE_DAYS;
    if (isGeneric || isFragment) return { kind: 'dissolve', reason: isGeneric ? '泛词主题、无边界' : `碎片主题（${t.assoc} 条、${Math.round(daysSince(t.last_link))} 天无新增）` };
    if (t.name.length >= ARTICLE_NAME_LEN || noteTitles.has(t.name.trim())) return { kind: 'rename', suggestedName: null, reason: '文章标题当了主题名，建议改成话题名' };
    return null;
  };
  const cls = new Map(topics.map(t => [t.id, classify(t)]));
  const dissolving = new Set(topics.filter(t => cls.get(t.id)?.kind === 'dissolve').map(t => t.id));
  // 并入只推荐给"会留下"的主题（别并进一个也要被解散的）
  const nearest = (id) => {
    const v = vecById.get(id); if (!v) return null;
    let best = null, bestS = 0.3;
    for (const t of topics) { if (t.id === id || dissolving.has(t.id)) continue; const ov = vecById.get(t.id); if (!ov) continue; const s = cosine(v, ov); if (s > bestS) { best = { id: t.id, name: t.name, score: Math.round(s * 100) / 100 }; bestS = s; } }
    return best;
  };

  const proposals = [];
  const renameNeedsName = [];
  for (const t of topics) {
    const c = cls.get(t.id); if (!c) continue;
    if (c.kind === 'dissolve') proposals.push({ topicId: t.id, name: t.name, assoc: t.assoc, action: 'dissolve', mergeInto: nearest(t.id), reason: c.reason });
    else if (c.kind === 'rename') {
      proposals.push({ topicId: t.id, name: t.name, assoc: t.assoc, action: 'rename', suggestedName: c.suggestedName, reason: c.reason });
      if (!c.suggestedName) renameNeedsName.push(t.id);
    }
  }

  // 给 article-name 的改名候选起个短话题名（LLM，一次调用）
  if (renameNeedsName.length) {
    const db2 = getDatabase();
    const info = renameNeedsName.map(id => {
      const titles = db2.prepare('SELECT COALESCE(n.title, n.source_title) tt FROM note_topics nt JOIN notes n ON nt.note_id=n.id WHERE nt.topic_id=? LIMIT 5').all(id).map(r => r.tt).filter(Boolean);
      return { id, titles };
    });
    db2.close();
    try {
      const list = info.map((x, i) => `${i + 1}. 现名/成员：${x.titles.slice(0, 4).map(t => (t || '').slice(0, 24)).join(' / ')}`).join('\n');
      const r = await chat([{ role: 'user', content: `下面每组是一个主题的成员素材标题。给每个主题起一个简洁的**话题名**（4-10字，概括共同话题，别用文章标题、别加引号）。\n${list}\n\n只输出 JSON：{"1":"话题名",...}，覆盖 1 到 ${info.length}。` }]);
      const p = JSON.parse(r.content.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim());
      info.forEach((x, i) => { const pr = proposals.find(pp => pp.topicId === x.id); if (pr) pr.suggestedName = (p[String(i + 1)] || '').slice(0, 20) || null; });
    } catch { /* 起名失败就留空，用户自己填 */ }
  }

  return { proposals: proposals.sort((a, b) => a.assoc - b.assoc), before: topics.length, expectedAfter: topics.length - proposals.filter(p => p.action === 'dissolve').length };
}

// 应用：dissolve=归档、merge=迁关联后归档源、rename=改名。均可恢复（归档不删）。
export function applyTopicCleanup(actions = []) {
  const db = getDatabase();
  const archive = db.prepare("UPDATE topics SET status = 'archived', updated_at = datetime('now') WHERE id = ?");
  const rename = db.prepare("UPDATE topics SET name = ?, updated_at = datetime('now') WHERE id = ?");
  const moveLink = db.prepare("INSERT OR IGNORE INTO note_topics (note_id, topic_id, status, relevance, added_by) SELECT note_id, ?, status, relevance, added_by FROM note_topics WHERE topic_id = ?");
  const dropLinks = db.prepare('DELETE FROM note_topics WHERE topic_id = ?');
  let done = 0;
  db.exec('BEGIN');
  try {
    for (const a of actions) {
      if (a.action === 'rename' && a.newName) { rename.run(a.newName.slice(0, 60), a.topicId); done++; }
      else if (a.action === 'merge' && a.targetId) { moveLink.run(a.targetId, a.topicId); dropLinks.run(a.topicId); archive.run(a.topicId); done++; }
      else if (a.action === 'dissolve') { archive.run(a.topicId); done++; } // 关联保留，恢复主题即回来
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); db.close(); throw e; }
  db.close();
  return { applied: done };
}
