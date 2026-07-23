import { getDatabase } from './init.js';
import { randomUUID } from 'crypto';

// 飞书「待整理」暂存表的数据层（ADR-037，migrate-m17）。
// sync 往这里写（按 feishu_id 幂等去重）；前端收件箱读 pending；分诊后标 accepted/ignored 并记落地对象。

// 幂等插入一条飞书捕获。已存在（同 feishu_id）则跳过，返回是否为新增。
export function upsertInboxItem({
  objType, feishuId, title = null, snippet = null, url = null,
  author = null, sourceName = null, extra = {}, suggested = 'idea', feishuTime = null,
}) {
  if (!objType || !feishuId) throw new Error('objType 和 feishuId 必填');
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM feishu_inbox WHERE feishu_id = ?').get(feishuId);
  if (existing) { db.close(); return false; }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO feishu_inbox (id, obj_type, feishu_id, title, snippet, url, author, source_name, extra, suggested, feishu_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, objType, feishuId, title, snippet, url, author, sourceName,
    JSON.stringify(extra || {}), suggested, feishuTime);
  db.close();
  return true;
}

function hydrate(row) {
  if (!row) return row;
  try { row.extra = JSON.parse(row.extra || '{}'); } catch { row.extra = {}; }
  return row;
}

export function listInbox({ status = 'pending', limit = 100 } = {}) {
  const db = getDatabase();
  const rows = status
    ? db.prepare('SELECT * FROM feishu_inbox WHERE status = ? ORDER BY datetime(created_at) DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM feishu_inbox ORDER BY datetime(created_at) DESC LIMIT ?').all(limit);
  db.close();
  return rows.map(hydrate);
}

export function getInboxItem(id) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM feishu_inbox WHERE id = ?').get(id);
  db.close();
  return hydrate(row);
}

export function pendingCount() {
  const db = getDatabase();
  const r = db.prepare("SELECT COUNT(*) AS n FROM feishu_inbox WHERE status = 'pending'").get();
  db.close();
  return r?.n || 0;
}

// 分诊落地：标 accepted 并记录变成了哪条 note/idea。
export function markTriaged(id, { status, resultKind = null, resultId = null }) {
  const db = getDatabase();
  const r = db.prepare('UPDATE feishu_inbox SET status = ?, result_kind = ?, result_id = ? WHERE id = ?')
    .run(status, resultKind, resultId, id);
  db.close();
  return r.changes > 0;
}
