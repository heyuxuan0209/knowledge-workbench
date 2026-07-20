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
    idea.related_note_ids = JSON.parse(idea.related_note_ids || '[]'); // 自动补料的建议（未采纳，不计火候）
    idea.consensus = JSON.parse(idea.consensus || '[]');
    idea.non_consensus = JSON.parse(idea.non_consensus || '[]');
    idea.supporting_content_ids.forEach(id => contentIds.add(id));
    idea.supporting_note_ids.forEach(id => noteIds.add(id));
    idea.related_note_ids.forEach(id => noteIds.add(id));
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
    // 相关素材建议：排除已在 supporting 里的（采纳后不重复出现）
    idea.related_notes = idea.related_note_ids
      .filter(id => !idea.supporting_note_ids.includes(id))
      .map(id => noteMap.get(id)).filter(Boolean);
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

// 合并支撑素材（真·料）：把 noteIds 并进 supporting_note_ids，去重。返回是否有新增。
export function addIdeaSupportNotes(id, noteIds = []) {
  if (!noteIds.length) return false;
  const db = getDatabase();
  const row = db.prepare('SELECT supporting_note_ids FROM ideas WHERE id = ?').get(id);
  if (!row) { db.close(); return false; }
  const cur = JSON.parse(row.supporting_note_ids || '[]');
  const merged = [...new Set([...cur, ...noteIds])];
  const changed = merged.length !== cur.length;
  if (changed) {
    db.prepare("UPDATE ideas SET supporting_note_ids = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(merged), id);
  }
  db.close();
  return changed;
}

// 写相关素材建议（自动补料的落点，不计火候）：并进 related_note_ids，去重。返回是否有新增。
export function addIdeaRelatedNotes(id, noteIds = []) {
  if (!noteIds.length) return false;
  const db = getDatabase();
  const row = db.prepare('SELECT related_note_ids, supporting_note_ids FROM ideas WHERE id = ?').get(id);
  if (!row) { db.close(); return false; }
  const supporting = new Set(JSON.parse(row.supporting_note_ids || '[]'));
  const cur = JSON.parse(row.related_note_ids || '[]');
  // 已是 supporting 的不必再当建议
  const merged = [...new Set([...cur, ...noteIds])].filter(x => !supporting.has(x));
  const changed = JSON.stringify(merged) !== JSON.stringify(cur);
  if (changed) {
    db.prepare("UPDATE ideas SET related_note_ids = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(merged), id);
  }
  db.close();
  return changed;
}

// 采纳一条相关建议为真·料：从 related 移到 supporting。
export function adoptRelatedNote(id, noteId) {
  const db = getDatabase();
  const row = db.prepare('SELECT related_note_ids, supporting_note_ids FROM ideas WHERE id = ?').get(id);
  if (!row) { db.close(); return false; }
  const related = JSON.parse(row.related_note_ids || '[]').filter(x => x !== noteId);
  const supporting = [...new Set([...JSON.parse(row.supporting_note_ids || '[]'), noteId])];
  db.prepare("UPDATE ideas SET related_note_ids = ?, supporting_note_ids = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(related), JSON.stringify(supporting), id);
  db.close();
  return true;
}

// 编辑灵感（Q3 可编辑）：改标题/角度/为什么现在。只更新传入的字段。
export function updateIdea(id, { title, angle, whyNow } = {}) {
  const sets = [];
  const params = [];
  if (title !== undefined) { sets.push('title = ?'); params.push(String(title).trim().slice(0, 300)); }
  if (angle !== undefined) { sets.push('angle = ?'); params.push(angle || null); }
  if (whyNow !== undefined) { sets.push('why_now = ?'); params.push(whyNow || null); }
  if (!sets.length) return false;
  const db = getDatabase();
  const r = db.prepare(`UPDATE ideas SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...params, id);
  db.close();
  return r.changes > 0;
}

// 硬删（用户主动删一条灵感）。区别于 updateIdeaStatus('dismissed')——后者是"忽略但留痕"。
export function deleteIdea(id) {
  const db = getDatabase();
  const r = db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
  db.close();
  return r.changes > 0;
}
