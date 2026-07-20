import { getDatabase } from './init.js';
import { randomUUID } from 'crypto';
import { stripPreamble } from '../util/strip-preamble.js';

// 灵感库（ADR-029，2026-07-20）：ideas 表从"AI 从报告提议的选题"扩为完整的选题种子收集箱。
// 三种收录姿势：user 随手记一句 / feed 从资讯一键收进 / feishu 等外部连接器 ingest。
// 与素材（notes）分工：素材是"料/弹药"，灵感是"要写什么"——两者用 supporting_note_ids 挂钩。
// AI 从周报涌现出的选题仍走 report-generation 落库（source_kind='ai'），在这里统一被 listIdeas 收口。

const SOURCE_KINDS = ['ai', 'user', 'feed', 'feishu', 'external'];

// 把 ideas 行里的 supporting_*_ids 解析成可点击的 {id,title,url}（读取时解析而非落库冗余，
// 内容/素材被删后自然消失不留死链，与 report-generation.resolveReportRefs 同策）。
function hydrate(db, ideas) {
  const contentIds = new Set();
  const noteIds = new Set();
  for (const idea of ideas) {
    idea.supporting_content_ids = JSON.parse(idea.supporting_content_ids || '[]');
    idea.supporting_note_ids = JSON.parse(idea.supporting_note_ids || '[]');
    idea.consensus = JSON.parse(idea.consensus || '[]');
    idea.non_consensus = JSON.parse(idea.non_consensus || '[]');
    idea.supporting_content_ids.forEach(id => contentIds.add(id));
    idea.supporting_note_ids.forEach(id => noteIds.add(id));
  }
  const inClause = (ids) => ids.map(() => '?').join(',');
  const contentMap = new Map(contentIds.size
    ? db.prepare(`SELECT id, COALESCE(zh_title, en_title) AS title, url FROM contents WHERE id IN (${inClause([...contentIds])})`)
        .all(...contentIds).map(r => [r.id, r])
    : []);
  const noteMap = new Map(noteIds.size
    ? db.prepare(`SELECT id, COALESCE(title, source_title, substr(excerpt, 1, 40)) AS title FROM notes WHERE id IN (${inClause([...noteIds])})`)
        .all(...noteIds).map(r => [r.id, r])
    : []);
  for (const idea of ideas) {
    idea.supporting_contents = idea.supporting_content_ids.map(id => contentMap.get(id)).filter(Boolean);
    idea.supporting_notes = idea.supporting_note_ids.map(id => noteMap.get(id)).filter(Boolean);
  }
  return ideas;
}

// 灵感库列表：跨全部报告 + 用户手记 + 外部连接器，一处收口。
// 默认排除 dismissed（忽略掉的不再出现）。可按 status / source_kind 过滤。
export function listIdeas({ status = null, sourceKind = null, includeDismissed = false, limit = 200 } = {}) {
  const db = getDatabase();
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  else if (!includeDismissed) { where.push("status != 'dismissed'"); }
  if (sourceKind) { where.push('source_kind = ?'); params.push(sourceKind); }
  const sql = `SELECT * FROM ideas ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY datetime(created_at) DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...params, limit);
  hydrate(db, rows);
  db.close();
  return rows;
}

export function getIdea(id) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
  if (row) hydrate(db, [row]);
  db.close();
  return row || null;
}

// 收录一条灵感。手记(user)/资讯收进(feed)/外部连接器(feishu…)共用。
// title 必填（就是那句"要写什么"）；其余可选。source_ref 存回链（URL 或 JSON 字符串）。
export function createIdea({
  title, angle = null, whyNow = null,
  sourceKind = 'user', sourceRef = null,
  supportingContentIds = [], supportingNoteIds = [],
  status = 'suggested',
} = {}) {
  if (!title || !title.trim()) throw new Error('title is required');
  if (!SOURCE_KINDS.includes(sourceKind)) throw new Error(`invalid sourceKind: ${sourceKind}`);
  title = stripPreamble(title).trim().slice(0, 300);

  const db = getDatabase();
  const id = randomUUID();
  const ref = sourceRef && typeof sourceRef === 'object' ? JSON.stringify(sourceRef) : sourceRef;
  db.prepare(`
    INSERT INTO ideas (id, report_id, title, angle, why_now, source_kind, source_ref,
      supporting_content_ids, supporting_note_ids, status)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, angle, whyNow, sourceKind, ref || null,
    JSON.stringify(supportingContentIds || []), JSON.stringify(supportingNoteIds || []), status);
  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
  hydrate(db, [row]);
  db.close();
  return row;
}

// 硬删（用户主动删一条灵感）。区别于 updateIdeaStatus('dismissed')——后者是"忽略但留痕"。
export function deleteIdea(id) {
  const db = getDatabase();
  const r = db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
  db.close();
  return r.changes > 0;
}
