import { getDatabase } from './init.js';
import { randomUUID } from 'crypto';

// 找到或创建 Source（按 platform+handle 判重，同一个人重复出现时复用已有记录）。
// sourceInfo 为空（无法识别作者，如 RSS 媒体源）时返回 null，content.source_id 留空。
function findOrCreateSource(db, sourceInfo) {
  if (!sourceInfo) return null;

  // handle 大小写不敏感：AI HOT 的 @Handle 写法与用户登记的 handle 大小写可能不同，
  // 必须合并成同一个源（X 借道归属依赖这一点）
  const existing = db
    .prepare('SELECT source_id FROM source_platforms WHERE platform = ? AND handle = ? COLLATE NOCASE')
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
      -- COALESCE 语义：重复同步只用"有值"覆盖，空值不清洗已有数据。
      -- 场景：active-query 的 YouTube 条目 flat 列表阶段 zh_title/简介/发布时间为空，
      -- 翻译与详情增强在后续轮次补上——若直接 excluded 覆盖，会把已补好的字段又抹回 null
      -- （翻译被抹掉 → 下轮重译 → 无限循环花钱）。
      zh_title = COALESCE(excluded.zh_title, zh_title),
      zh_summary = COALESCE(excluded.zh_summary, zh_summary),
      en_title = COALESCE(excluded.en_title, en_title),
      en_summary = COALESCE(excluded.en_summary, en_summary),
      published_at = COALESCE(excluded.published_at, published_at),
      external_score = COALESCE(excluded.external_score, external_score),
      tags = excluded.tags,
      permalink = COALESCE(excluded.permalink, permalink),
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

// 热度归一（2026-07-14 用户决策：评分逻辑要一致）：统一 0-100 的"热度"。
// aihot 的 score 本身是 0-100 质量分直接用；HN points 用平方根映射（300 分 ≈ 87）；
// GitHub 不进资讯流（独立区块，展示 ⭐日增星原值）；RSS 无分 → null（前端隐藏）。
function normalizeHeat(sourceApp, externalScore) {
  const x = externalScore || 0;
  if (sourceApp === 'aihot') return Math.round(Math.min(100, x));
  if (sourceApp === 'hackernews') return Math.min(99, Math.round(Math.sqrt(x) * 5));
  return null;
}

export function getContents(limit = 20, offset = 0, { q = null, starred = false, category = null, followed = false } = {}) {
  const db = getDatabase();
  // GitHub Trending 不混入资讯流（产品与内容分离，走 /api/github-trending 独立区块）。
  // 已登记信息源（ADR-007 登记处）的内容加权：等效于把发布时间前移 12 小时，
  // 既保证"我关注的人"浮上来，又不至于把时间线彻底打乱（新热内容仍能正常冒头）。
  // q/starred（2026-07-16 反馈 #2）：Feed 搜索与星标过滤，与素材库同款多关键词 AND 语义。
  // 星标视图不排除 GitHub 项目——星标是用户主动选择，不受"不混入资讯流"规则限制
  const where = [];
  if (!starred) where.push("c.source_app != 'github_trending'");
  const params = [];
  if (q?.trim()) {
    for (const kw of q.trim().split(/\s+/).slice(0, 5)) {
      where.push('(c.zh_title LIKE ? OR c.en_title LIKE ? OR c.zh_summary LIKE ?)');
      const like = `%${kw}%`;
      params.push(like, like, like);
    }
  }
  if (starred) where.push('c.starred = 1');
  if (followed) where.push('s.registered_by_user = 1'); // 「关注」筛选：只看你关注的信源
  if (category) { where.push('c.category = ?'); params.push(category); } // 资讯页分类 chips（2b）

  const rows = db.prepare(`
    SELECT c.*, s.display_name as source_display_name, s.registered_by_user as source_registered,
           sp.platform as source_platform, sp.handle as source_handle
    FROM contents c
    LEFT JOIN sources s ON c.source_id = s.id
    LEFT JOIN source_platforms sp ON sp.source_id = s.id
    WHERE ${where.join(' AND ')}
    ORDER BY julianday(COALESCE(c.published_at, c.created_at))
             + CASE WHEN s.registered_by_user = 1 THEN 0.5 ELSE 0 END DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  db.close();
  return rows.map(r => ({ ...r, heat: normalizeHeat(r.source_app, r.external_score) }));
}

// 星标切换（M7）：返回新状态；内容不存在返回 null
export function toggleStar(id) {
  const db = getDatabase();
  const row = db.prepare('SELECT starred FROM contents WHERE id = ?').get(id);
  if (!row) { db.close(); return null; }
  const next = row.starred ? 0 : 1;
  db.prepare("UPDATE contents SET starred = ?, updated_at = datetime('now') WHERE id = ?").run(next, id);
  db.close();
  return next;
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
