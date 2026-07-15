import { getDatabase } from '../db/init.js';
import { randomUUID } from 'crypto';
import { tokenize } from './story-clustering.js';

// Topic 活页（M3 知识层，ADR-009）：Topic = AI 维护的活文档，不是文件夹。
// 本模块负责活页的建立/读取/素材匹配（全部零 LLM 成本）；
// 正文的更新（同化）在 assimilation.js —— 只有用户点"并入"才调 LLM。
//
// body 结构（JSON）：{ current: string, views: [{who, what, ref, conflict}], consensus: string }

export const EMPTY_BODY = { current: '', views: [], consensus: '' };

// 素材自动匹配阈值：TF 余弦（中文 bigram + 英文词，见 story-clustering.tokenize）。
// 素材摘录是长文本、主题文档较短，重叠稀疏，0.06 经验值能召回明显相关的素材，
// 匹配结果只是"待并入"建议（pending），误挂由用户在并入前把关，宁可略松。
const MATCH_THRESHOLD = 0.06;

function cosineTF(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const tf = tokens => {
    const m = new Map();
    for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
    return m;
  };
  const a = tf(tokensA), b = tf(tokensB);
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const w2 = big.get(t);
    if (w2) dot += w * w2;
  }
  const norm = m => Math.sqrt([...m.values()].reduce((s, w) => s + w * w, 0)) || 1;
  return dot / (norm(a) * norm(b));
}

function parseBody(row) {
  try { return { ...EMPTY_BODY, ...JSON.parse(row.body || '{}') }; } catch { return { ...EMPTY_BODY }; }
}

// 主题的"匹配文档"：名称权重最高（重复三遍），加描述和综述正文
function topicMatchTokens(topic, body) {
  return tokenize(`${topic.name} ${topic.name} ${topic.name} ${topic.description || ''} ${(body || parseBody(topic)).current}`);
}

// ---- 列表与详情 ----

export function listTopics() {
  const db = getDatabase();
  const topics = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM note_topics nt WHERE nt.topic_id = t.id AND nt.status = 'assimilated') AS note_count,
      (SELECT COUNT(*) FROM note_topics nt WHERE nt.topic_id = t.id AND nt.status = 'pending') AS pending_count,
      (SELECT COUNT(*) FROM topic_changelog cl WHERE cl.topic_id = t.id) AS changelog_count
    FROM topics t
    WHERE t.status != 'archived'
    ORDER BY t.last_active_at DESC
  `).all();

  const latestStmt = db.prepare(`
    SELECT summary, change_type, created_at FROM topic_changelog
    WHERE topic_id = ? ORDER BY created_at DESC LIMIT 1
  `);
  for (const t of topics) {
    t.body = parseBody(t);
    const latest = latestStmt.get(t.id);
    t.latest_change = latest || null;
    t.conflict = t.body.views.some(v => v.conflict)
      ? t.body.views.find(v => v.conflict).what?.slice(0, 60)
      : null;
  }
  db.close();
  return topics;
}

export function getTopicDetail(topicId) {
  const db = getDatabase();
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId);
  if (!topic) { db.close(); return null; }

  topic.body = parseBody(topic);
  topic.changelog = db.prepare(`
    SELECT * FROM topic_changelog WHERE topic_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(topicId).map(c => ({ ...c, note_ids: JSON.parse(c.note_ids || '[]') }));

  topic.pending_notes = db.prepare(`
    SELECT n.id, n.excerpt, n.source_title, n.source_url, nt.relevance, nt.created_at AS linked_at
    FROM note_topics nt JOIN notes n ON nt.note_id = n.id
    WHERE nt.topic_id = ? AND nt.status = 'pending'
    ORDER BY nt.created_at DESC
  `).all(topicId);

  topic.assimilated_count = db.prepare(
    "SELECT COUNT(*) c FROM note_topics WHERE topic_id = ? AND status = 'assimilated'"
  ).get(topicId).c;

  db.close();
  return topic;
}

// ---- 建页 ----

// 手动建页（主题库搜索框输入新主题）。零 LLM：正文空壳，综述由第一次同化生成。
// 建页时回扫已有素材，把相关的挂为 pending（新页不至于一片空白）。
export function createTopic({ name, description = null }) {
  if (!name?.trim()) throw new Error('name is required');
  const db = getDatabase();

  const dup = db.prepare("SELECT id FROM topics WHERE name = ? AND status != 'archived'").get(name.trim());
  if (dup) { db.close(); throw new Error(`主题「${name.trim()}」已存在`); }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO topics (id, name, description, status, evolution_phase, created_by, body)
    VALUES (?, ?, ?, 'active', 'emerging', 'user', ?)
  `).run(id, name.trim(), description, JSON.stringify(EMPTY_BODY));

  db.prepare(`
    INSERT INTO topic_changelog (id, topic_id, change_type, summary) VALUES (?, ?, 'created', ?)
  `).run(randomUUID(), id, `建立活页「${name.trim()}」`);

  const linked = backfillMatchesForTopic(db, id);
  db.close();
  return { ...getTopicDetail(id), backfilled: linked };
}

// 选题升级建页（洞察 → 知识库闭环）。用选题自带的角度/共识做初始综述，零 LLM。
export function createTopicFromIdea(ideaId) {
  const db = getDatabase();
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(ideaId);
  if (!idea) { db.close(); throw new Error('Idea not found'); }

  const existing = db.prepare('SELECT id FROM topics WHERE origin_idea_id = ?').get(ideaId);
  if (existing) { db.close(); return getTopicDetail(existing.id); }

  const consensus = JSON.parse(idea.consensus || '[]');
  const nonConsensus = JSON.parse(idea.non_consensus || '[]');
  const body = {
    current: [idea.angle, idea.why_now].filter(Boolean).join('\n\n') || '',
    views: [],
    consensus: [
      consensus.length ? `共识：${consensus.join('；')}` : '',
      nonConsensus.length ? `非共识：${nonConsensus.join('；')}` : '',
    ].filter(Boolean).join('\n'),
  };

  const id = randomUUID();
  db.prepare(`
    INSERT INTO topics (id, name, description, status, evolution_phase, created_by, body, origin_idea_id)
    VALUES (?, ?, ?, 'active', 'emerging', 'user', ?, ?)
  `).run(id, idea.title, idea.angle, JSON.stringify(body), ideaId);

  db.prepare(`
    INSERT INTO topic_changelog (id, topic_id, change_type, summary) VALUES (?, ?, 'created', ?)
  `).run(randomUUID(), id, `由选题「${idea.title}」升级建页，初始综述取自选题角度与共识/非共识`);

  db.prepare("UPDATE ideas SET status = 'adopted', updated_at = datetime('now') WHERE id = ?").run(ideaId);

  backfillMatchesForTopic(db, id);
  db.close();
  return getTopicDetail(id);
}

// 删除活页：changelog / note_topics 级联清除（FK CASCADE），素材卡片本身保留不动
export function deleteTopic(topicId) {
  const db = getDatabase();
  const r = db.prepare('DELETE FROM topics WHERE id = ?').run(topicId);
  db.close();
  return r.changes > 0;
}

// ---- 素材匹配（同化的零成本前置） ----

// 素材保存后调用：与所有活跃主题算相似度，达标的挂 pending 待并入。
// 返回命中的主题名（前端 toast 提示）。
export function matchNoteToTopics(noteId) {
  const db = getDatabase();
  const note = db.prepare('SELECT id, excerpt, source_title FROM notes WHERE id = ?').get(noteId);
  if (!note) { db.close(); return []; }

  const noteTokens = tokenize(`${note.source_title || ''} ${note.excerpt}`);
  const topics = db.prepare("SELECT id, name, description, body FROM topics WHERE status = 'active'").all();

  const matched = [];
  const link = db.prepare(`
    INSERT OR IGNORE INTO note_topics (note_id, topic_id, status, relevance, added_by)
    VALUES (?, ?, 'pending', ?, 'ai')
  `);
  for (const t of topics) {
    const sim = cosineTF(noteTokens, topicMatchTokens(t));
    if (sim >= MATCH_THRESHOLD) {
      link.run(noteId, t.id, Math.round(sim * 100) / 100);
      matched.push({ topicId: t.id, name: t.name, relevance: sim });
    }
  }
  db.close();
  return matched;
}

// 用户手动把素材归入主题（相关度 1.0，仍走 pending → 并入流程，保持同化入口唯一）
export function linkNoteToTopic(noteId, topicId) {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO note_topics (note_id, topic_id, status, relevance, added_by)
    VALUES (?, ?, 'pending', 1.0, 'user')
    ON CONFLICT(note_id, topic_id) DO UPDATE SET added_by = 'user', relevance = 1.0
  `).run(noteId, topicId);
  db.close();
  return true;
}

// 建页时回扫近期素材（最近 90 天、上限 200 条），相关的挂 pending
function backfillMatchesForTopic(db, topicId) {
  const topic = db.prepare('SELECT id, name, description, body FROM topics WHERE id = ?').get(topicId);
  const tTokens = topicMatchTokens(topic);
  const notes = db.prepare(`
    SELECT id, excerpt, source_title FROM notes
    WHERE datetime(created_at) > datetime('now', '-90 days')
    ORDER BY created_at DESC LIMIT 200
  `).all();

  const link = db.prepare(`
    INSERT OR IGNORE INTO note_topics (note_id, topic_id, status, relevance, added_by)
    VALUES (?, ?, 'pending', ?, 'ai')
  `);
  let count = 0;
  for (const n of notes) {
    const sim = cosineTF(tokenize(`${n.source_title || ''} ${n.excerpt}`), tTokens);
    if (sim >= MATCH_THRESHOLD) { link.run(n.id, topicId, Math.round(sim * 100) / 100); count++; }
  }
  return count;
}
