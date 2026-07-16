import { getDatabase } from './init.js';
import { randomUUID } from 'crypto';

// 素材卡片（ADR-010 NotebookLM 模式）：只有用户主动"保存到笔记"的片段才落库。
// content_id 引用可空：adHoc 粘贴的内容未入库，此时靠 source_title/source_url 冗余字段溯源。

// AI 回复常见开场白（"好的，以下是…的结构化解读。"）对素材是噪音，保存时剥掉首行
function stripPreamble(text) {
  const lines = text.trim().split('\n');
  if (lines.length > 1 && /^(好的|当然|以下是|这是)/.test(lines[0]) && /解读|材料|总结|分析/.test(lines[0])) {
    return lines.slice(1).join('\n').trim();
  }
  return text.trim();
}

export function createNote({ excerpt, noteType = 'chat', contentId = null, sourceTitle = null, sourceUrl = null, stance = null, title = null }) {
  if (!excerpt || !excerpt.trim()) {
    throw new Error('excerpt is required');
  }
  excerpt = stripPreamble(excerpt);

  const db = getDatabase();

  // adHoc 内容的 contentId 可能不在 contents 表里，置空以免脏引用（冗余字段仍保留溯源信息）
  let validContentId = null;
  if (contentId) {
    const exists = db.prepare('SELECT id FROM contents WHERE id = ?').get(contentId);
    validContentId = exists ? contentId : null;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO notes (id, title, excerpt, note_type, stance, content_id, source_title, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, excerpt, noteType, stance, validContentId, sourceTitle, sourceUrl);

  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  db.close();
  return row;
}

export function setNoteTitle(id, title) {
  const db = getDatabase();
  const r = db.prepare("UPDATE notes SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, id);
  db.close();
  return r.changes > 0;
}

// 关键词标签（M7）：保存后 AI 异步提取，存 JSON 数组
export function setNoteKeywords(id, keywords) {
  const db = getDatabase();
  const r = db.prepare("UPDATE notes SET keywords = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(keywords || []), id);
  db.close();
  return r.changes > 0;
}

// 来源标签（2026-07-16 反馈：下拉曾是一堆文章标题/裸 URL，不规范）——
// 归一为「登记信源名 > 渠道名 > 粘贴/对话」三级，getNotes 过滤与 getNoteSources 下拉共用
const SOURCE_LABEL_SQL = `COALESCE(s.display_name,
  CASE
    WHEN c.source_app = 'aihot' THEN 'AI HOT'
    WHEN c.source_app = 'rss' THEN 'RSS 订阅'
    WHEN c.source_app = 'github_trending' THEN 'GitHub Trending'
    WHEN c.source_app = 'active_query' THEN '主动查询源'
    WHEN n.content_id IS NOT NULL THEN '站内内容'
    ELSE '粘贴/对话'
  END)`;

// 素材库筛选/搜索（2026-07-16 反馈 #8）：全部在 SQL 层过滤（此前前端只能内存过滤已加载页，
// 老素材搜不到）。q 支持空格分隔多关键词模糊匹配（AND 语义），范围：标题/摘录/来源标题/原文标题。
export function getNotes({ limit = 50, offset = 0, q = null, topicId = null, source = null, ctype = null } = {}) {
  const db = getDatabase();
  const where = [];
  const params = [];

  if (q?.trim()) {
    // keywords（M7）：AI 提取的标签也参与匹配——LIKE 只认字面，标签补上近义表述的召回
    for (const kw of q.trim().split(/\s+/).slice(0, 5)) {
      where.push('(n.title LIKE ? OR n.excerpt LIKE ? OR n.source_title LIKE ? OR c.zh_title LIKE ? OR n.keywords LIKE ?)');
      const like = `%${kw}%`;
      params.push(like, like, like, like, like);
    }
  }
  if (topicId === '__none__') {
    // 未归类（收件箱）：主题 chips 的「未归类」tab 用
    where.push('NOT EXISTS (SELECT 1 FROM note_topics ntf WHERE ntf.note_id = n.id)');
  } else if (topicId) {
    where.push('EXISTS (SELECT 1 FROM note_topics ntf WHERE ntf.note_id = n.id AND ntf.topic_id = ?)');
    params.push(topicId);
  }
  if (source?.trim()) {
    // 与 getNoteSources 同一套来源标签（2026-07-16 反馈：下拉不能是一堆文章标题/裸 URL）
    where.push(`${SOURCE_LABEL_SQL} = ?`);
    params.push(source.trim());
  }
  // 来源类型筛选（2026-07-16 反馈：素材库要区分 GitHub 项目和文章）
  if (ctype === 'repo' || ctype === 'video') {
    where.push('c.content_type = ?');
    params.push(ctype);
  } else if (ctype === 'article') {
    where.push("c.content_type IN ('article', 'paper', 'tweet')");
  }

  // topic_ids/topic_names：素材归属的主题（M4 创作台按当前主题筛选素材用）
  const rows = db.prepare(`
    SELECT n.*, c.zh_title AS content_zh_title, c.url AS content_url,
      c.content_type AS content_content_type, c.source_app AS content_source_app,
      (SELECT group_concat(nt.topic_id) FROM note_topics nt WHERE nt.note_id = n.id) AS topic_ids,
      (SELECT group_concat(t.name, ' / ') FROM note_topics nt2 JOIN topics t ON t.id = nt2.topic_id WHERE nt2.note_id = n.id) AS topic_names,
      (SELECT json_group_array(json_object('id', nt3.topic_id, 'name', t3.name, 'status', nt3.status, 'addedBy', nt3.added_by))
         FROM note_topics nt3 JOIN topics t3 ON t3.id = nt3.topic_id WHERE nt3.note_id = n.id) AS topics_json
    FROM notes n
    LEFT JOIN contents c ON n.content_id = c.id
    LEFT JOIN sources s ON c.source_id = s.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY n.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  db.close();
  return rows;
}

// 来源下拉选项：登记信源名/渠道名（不再是文章标题——那是搜索框的事）
export function getNoteSources() {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT ${SOURCE_LABEL_SQL} AS source, COUNT(*) AS count
    FROM notes n
    LEFT JOIN contents c ON n.content_id = c.id
    LEFT JOIN sources s ON c.source_id = s.id
    GROUP BY source ORDER BY count DESC LIMIT 50
  `).all();
  db.close();
  return rows;
}

export function deleteNote(id) {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  db.close();
  return result.changes > 0;
}
