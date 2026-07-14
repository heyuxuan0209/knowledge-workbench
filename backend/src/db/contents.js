import { getDatabase } from './init.js';
import { randomUUID } from 'crypto';

// 找到或创建 Source（按 platform+handle 判重，同一个人重复出现时复用已有记录）。
// sourceInfo 为空（无法识别作者，如 RSS 媒体源）时返回 null，content.source_id 留空。
function findOrCreateSource(db, sourceInfo) {
  if (!sourceInfo) return null;

  const existing = db
    .prepare('SELECT source_id FROM source_platforms WHERE platform = ? AND handle = ?')
    .get(sourceInfo.platform, sourceInfo.handle);

  if (existing) return existing.source_id;

  const sourceId = randomUUID();
  db.prepare(`
    INSERT INTO sources (id, source_type, display_name, followed_since, status)
    VALUES (?, 'Person', ?, datetime('now'), 'active')
  `).run(sourceId, sourceInfo.displayName);

  // AI HOT 覆盖到的内容按 ADR-007 定为 passive（纯被动，等 AI HOT 推送，零额外成本）
  db.prepare(`
    INSERT INTO source_platforms (source_id, platform, handle, track_mode)
    VALUES (?, ?, ?, 'passive')
  `).run(sourceId, sourceInfo.platform, sourceInfo.handle);

  return sourceId;
}

// 批量 upsert content + 关联 source。AI HOT 的 item.id 稳定不变，重复同步应更新而非报错。
export function upsertContents(items) {
  const db = getDatabase();

  const upsertStmt = db.prepare(`
    INSERT INTO contents (
      id, source_id, content_type, url, published_at,
      original_lang, has_translation,
      zh_title, zh_summary, en_title, en_summary,
      input_method, source_app, fetch_status, external_score, tags, permalink,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_id = excluded.source_id,
      zh_title = excluded.zh_title,
      zh_summary = excluded.zh_summary,
      en_title = excluded.en_title,
      external_score = excluded.external_score,
      tags = excluded.tags,
      permalink = excluded.permalink,
      updated_at = excluded.updated_at
  `);

  let upserted = 0;
  let sourcesTouched = 0;

  for (const { content, sourceInfo } of items) {
    try {
      const sourceId = findOrCreateSource(db, sourceInfo);
      if (sourceId) sourcesTouched++;

      upsertStmt.run(
        content.id,
        sourceId,
        content.content_type,
        content.url,
        content.published_at,
        content.original_lang,
        content.has_translation,
        content.zh_title,
        content.zh_summary,
        content.en_title,
        content.en_summary ?? null,
        content.input_method,
        content.source_app,
        content.fetch_status,
        content.external_score,
        content.tags ?? '[]',   // RSS/HN 等 transform 未设置 tags 时兜底（undefined 无法绑定）
        content.permalink ?? null,
        content.created_at,
        content.updated_at
      );
      upserted++;
    } catch (error) {
      console.error(`Failed to upsert content ${content.id}:`, error.message);
    }
  }

  db.close();

  console.log(`✅ Upserted ${upserted}/${items.length} contents (${sourcesTouched} linked to a source)`);
  return upserted;
}

export function getContents(limit = 20, offset = 0) {
  const db = getDatabase();
  // 已登记信息源（ADR-007 登记处）的内容加权：等效于把发布时间前移 12 小时，
  // 既保证"我关注的人"浮上来，又不至于把时间线彻底打乱（新热内容仍能正常冒头）。
  const rows = db.prepare(`
    SELECT c.*, s.display_name as source_display_name, s.registered_by_user as source_registered,
           sp.platform as source_platform, sp.handle as source_handle
    FROM contents c
    LEFT JOIN sources s ON c.source_id = s.id
    LEFT JOIN source_platforms sp ON sp.source_id = s.id
    ORDER BY julianday(COALESCE(c.published_at, c.created_at))
             + CASE WHEN s.registered_by_user = 1 THEN 0.5 ELSE 0 END DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  db.close();
  return rows;
}

export function getContentById(id) {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT c.*, s.display_name as source_display_name, sp.platform as source_platform, sp.handle as source_handle
    FROM contents c
    LEFT JOIN sources s ON c.source_id = s.id
    LEFT JOIN source_platforms sp ON sp.source_id = s.id
    WHERE c.id = ?
  `).get(id);
  db.close();
  return row;
}
