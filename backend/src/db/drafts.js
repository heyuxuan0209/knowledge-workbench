import { getDatabase } from './init.js';
import { randomUUID } from 'crypto';

// 稿件 CRUD（M4 创作层）。paragraph_refs 段落级溯源随稿持久化——
// 创作台关页不再丢稿，引用链（草稿段落 → 素材卡 → 原始内容）可回溯。

function parseRow(r) {
  return r ? { ...r, paragraph_refs: JSON.parse(r.paragraph_refs || '[]') } : null;
}

export function createDraft({ platform, title = null, body = '', paragraphRefs = [], sourceKind = 'manual', sourceId = null, sourceLabel = null, tokens = 0, costYuan = 0 }) {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO drafts (id, platform, title, body, paragraph_refs, source_kind, source_id, source_label, tokens, cost_yuan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, platform, title, body, JSON.stringify(paragraphRefs), sourceKind, sourceId, sourceLabel, tokens, costYuan);
  const row = parseRow(db.prepare('SELECT * FROM drafts WHERE id = ?').get(id));
  db.close();
  return row;
}

export function updateDraft(id, { title, body, paragraphRefs, status }) {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM drafts WHERE id = ?').get(id);
  if (!existing) { db.close(); return null; }
  db.prepare(`
    UPDATE drafts SET
      title = COALESCE(?, title),
      body = COALESCE(?, body),
      paragraph_refs = COALESCE(?, paragraph_refs),
      status = COALESCE(?, status),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(title ?? null, body ?? null, paragraphRefs ? JSON.stringify(paragraphRefs) : null, status ?? null, id);
  const row = parseRow(db.prepare('SELECT * FROM drafts WHERE id = ?').get(id));
  db.close();
  return row;
}

export function listDrafts({ platform = null, limit = 30 } = {}) {
  const db = getDatabase();
  const rows = (platform
    ? db.prepare('SELECT * FROM drafts WHERE platform = ? ORDER BY updated_at DESC LIMIT ?').all(platform, limit)
    : db.prepare('SELECT * FROM drafts ORDER BY updated_at DESC LIMIT ?').all(limit)
  ).map(parseRow);
  db.close();
  return rows;
}

export function getDraft(id) {
  const db = getDatabase();
  const row = parseRow(db.prepare('SELECT * FROM drafts WHERE id = ?').get(id));
  db.close();
  return row;
}

export function deleteDraft(id) {
  const db = getDatabase();
  const r = db.prepare('DELETE FROM drafts WHERE id = ?').run(id);
  db.close();
  return r.changes > 0;
}
