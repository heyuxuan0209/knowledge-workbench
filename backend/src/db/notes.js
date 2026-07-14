import { getDatabase } from './init.js';
import { randomUUID } from 'crypto';

// 素材卡片（ADR-010 NotebookLM 模式）：只有用户主动"保存到笔记"的片段才落库。
// content_id 引用可空：adHoc 粘贴的内容未入库，此时靠 source_title/source_url 冗余字段溯源。

export function createNote({ excerpt, noteType = 'chat', contentId = null, sourceTitle = null, sourceUrl = null, stance = null }) {
  if (!excerpt || !excerpt.trim()) {
    throw new Error('excerpt is required');
  }

  const db = getDatabase();

  // adHoc 内容的 contentId 可能不在 contents 表里，置空以免脏引用（冗余字段仍保留溯源信息）
  let validContentId = null;
  if (contentId) {
    const exists = db.prepare('SELECT id FROM contents WHERE id = ?').get(contentId);
    validContentId = exists ? contentId : null;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO notes (id, excerpt, note_type, stance, content_id, source_title, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, excerpt.trim(), noteType, stance, validContentId, sourceTitle, sourceUrl);

  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  db.close();
  return row;
}

export function getNotes(limit = 50, offset = 0) {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT n.*, c.zh_title AS content_zh_title, c.url AS content_url
    FROM notes n
    LEFT JOIN contents c ON n.content_id = c.id
    ORDER BY n.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  db.close();
  return rows;
}

export function deleteNote(id) {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  db.close();
  return result.changes > 0;
}
