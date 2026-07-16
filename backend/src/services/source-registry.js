import { getDatabase } from '../db/init.js';
import { randomUUID } from 'crypto';

// 优质源登记处（ADR-007）：丢入 X 链接 / YouTube 链接 / 网页链接 / 公众号名称 → 自动识别身份 → 登记。
// 登记后的效果只有两个：该源内容进 Feed + 高权重排序（getContents 加权）。不是订阅系统。
//
// track_mode 判定（成本分层硬约束）：
// - X / YouTube / GitHub / B站 → active-query（sync-active-query.js 执行器，ADR-014；
//   免登录渠道 B站/YouTube/GitHub 已接，X 属登录态渠道执行器暂跳过）
// - 网页有 RSS/Atom feed  → active-rss（sync-rss.js 会从 source_platforms 读取并轮询）
// - 网页无 feed / 公众号  → link-only（只标记 + 跳转，不抓取）

const FETCH_TIMEOUT_MS = 10000;

function fetchWithTimeout(url) {
  return fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeWorkbench/0.1)' },
  });
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim().slice(0, 120) : null;
}

// 在 HTML 里发现 RSS/Atom feed 链接（<link rel="alternate" type="application/rss+xml|atom+xml">）
function discoverFeedUrl(html, baseUrl) {
  const linkTags = html.match(/<link[^>]+>/gi) || [];
  for (const tag of linkTags) {
    if (!/rel=["']alternate["']/i.test(tag)) continue;
    if (!/application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) return new URL(href, baseUrl).href;
  }
  return null;
}

// 判断一个 URL 本身是否就是 feed（用户直接丢 feed 地址的情况）
function looksLikeFeedUrl(url) {
  return /\/(feed|rss|atom)(\.xml)?\/?$/i.test(url) || /\.(rss|atom)$/i.test(url);
}

// 探测链第 2 步（RESEARCH-MULTI-SOURCE-AGGREGATION §二）：常见路径猜测。
// 实证：仅 35.9% 的网站通过 <link rel=alternate> 暴露 feed，只靠自动发现会漏掉
// 大多数真实存在的 feed（Product Hunt 有 /feed 但首页无 link 标签，就死在这）。
const FEED_PROBE_PATHS = ['/feed', '/rss', '/atom.xml', '/index.xml', '/feed.xml', '/rss.xml'];

async function probeFeedPaths(origin) {
  for (const path of FEED_PROBE_PATHS) {
    const candidate = origin + path;
    try {
      const res = await fetch(candidate, {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeWorkbench/0.1)' },
        redirect: 'follow',
      });
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') || '';
      const head = (await res.text()).slice(0, 500);
      const isFeed = contentType.includes('xml') || /^\s*<\?xml|<rss[\s>]|<feed[\s>]/i.test(head);
      if (isFeed) {
        const title = head.match(/<title[^>]*>(?:<!\[CDATA\[)?([^<\]]+)/i)?.[1]?.trim();
        return { feedUrl: candidate, feedTitle: title || null };
      }
    } catch { /* 下一个路径 */ }
  }
  return null;
}

// 自动识别输入 → 身份预览（不落库）。返回结构给前端确认后再 register。
export async function identifyInput(rawInput) {
  const input = rawInput.trim();
  if (!input) throw new Error('input is required');

  // ---- 非 URL：按公众号名称处理（ADR-007：公众号恒 link-only） ----
  if (!/^https?:\/\//i.test(input)) {
    return {
      sourceType: 'Media',
      displayName: input,
      platform: 'WeChat',
      handle: input,
      trackMode: 'link-only',
      note: '公众号不抓取，只标记 + 等 AI HOT 推送 + 跳转原文',
    };
  }

  const url = new URL(input);
  const host = url.hostname.replace(/^www\./, '');

  // ---- X / Twitter：从链接提取用户名（支持个人主页和推文链接） ----
  if (host === 'x.com' || host === 'twitter.com') {
    const handle = url.pathname.split('/').filter(Boolean)[0];
    if (!handle || ['home', 'search', 'explore', 'i'].includes(handle)) {
      throw new Error('无法从该 X 链接识别出用户，请使用个人主页或推文链接');
    }
    return {
      sourceType: 'Person',
      displayName: handle,
      platform: 'X',
      handle,
      trackMode: 'active-query',
      note: 'AI HOT 已覆盖的 builder 会自动推送；X 主动查询属登录态渠道，解锁需授权（ADR-014），当前执行器跳过',
    };
  }

  // ---- YouTube：@handle / channel/ID / c/name ----
  if (host === 'youtube.com' || host === 'youtu.be') {
    const parts = url.pathname.split('/').filter(Boolean);
    let handle = null;
    if (parts[0]?.startsWith('@')) handle = parts[0];
    else if (parts[0] === 'channel' || parts[0] === 'c' || parts[0] === 'user') handle = parts[1];
    if (!handle) {
      throw new Error('无法从该 YouTube 链接识别出频道，请使用频道主页链接（youtube.com/@xxx）');
    }
    return {
      sourceType: 'YouTubeChannel',
      displayName: handle.replace(/^@/, ''),
      platform: 'YouTube',
      handle,
      trackMode: 'active-query',
    };
  }

  // ---- Bilibili：space.bilibili.com/UID（UP 主主页，ADR-014 免登录渠道） ----
  if (host === 'space.bilibili.com') {
    const uid = url.pathname.split('/').filter(Boolean)[0];
    if (!uid || !/^\d+$/.test(uid)) {
      throw new Error('无法从该 B站 链接识别出 UP 主，请使用主页链接（space.bilibili.com/UID）');
    }
    // 尽力取真实昵称（bili-cli 免登录），拿不到用 UID 占位、登记后可改
    const { fetchBiliUser } = await import('./active-query-channels.js');
    const profile = await fetchBiliUser(uid);
    return {
      sourceType: 'Person',
      displayName: profile?.name || `B站 UP 主 ${uid}`,
      platform: 'Bilibili',
      handle: uid,
      trackMode: 'active-query',
      note: '每日主动查询该 UP 主最新视频（bili-cli 免登录，ADR-014）',
    };
  }

  // ---- GitHub：github.com/user ----
  if (host === 'github.com') {
    const user = url.pathname.split('/').filter(Boolean)[0];
    if (!user) throw new Error('无法从该 GitHub 链接识别出用户');
    return {
      sourceType: 'GitHubUser',
      displayName: user,
      platform: 'GitHub',
      handle: user,
      trackMode: 'active-query',
    };
  }

  // ---- 微信公众号文章链接 ----
  if (host === 'mp.weixin.qq.com') {
    return {
      sourceType: 'Media',
      displayName: '公众号（请在登记后修改名称）',
      platform: 'WeChat',
      handle: input,
      trackMode: 'link-only',
      note: '公众号不抓取。建议直接输入公众号名称登记，比文章链接更准确',
    };
  }

  // ---- 通用网页：尝试 RSS 发现 ----
  try {
    const res = await fetchWithTimeout(input);
    const contentType = res.headers.get('content-type') || '';
    const body = await res.text();

    // 用户直接丢的就是 feed 地址
    if (contentType.includes('xml') || looksLikeFeedUrl(input)) {
      const feedTitle = body.match(/<title[^>]*>(?:<!\[CDATA\[)?([^<\]]+)/i)?.[1]?.trim();
      return {
        sourceType: 'Blog',
        displayName: feedTitle || host,
        platform: 'RSS',
        handle: input,
        trackMode: 'active-rss',
        feedUrl: input,
      };
    }

    const feedUrl = discoverFeedUrl(body, input);
    const title = extractTitle(body) || host;
    if (feedUrl) {
      return {
        sourceType: 'Blog',
        displayName: title,
        platform: 'Blog',
        handle: feedUrl,
        trackMode: 'active-rss',
        feedUrl,
        siteUrl: input,
      };
    }

    // 探测链第 2 步：link 标签没有 ≠ 没有 feed，按常见路径猜（Product Hunt 类救回来）
    const probed = await probeFeedPaths(url.origin);
    if (probed) {
      return {
        sourceType: 'Blog',
        displayName: probed.feedTitle || title,
        platform: 'Blog',
        handle: probed.feedUrl,
        trackMode: 'active-rss',
        feedUrl: probed.feedUrl,
        siteUrl: input,
        note: `页面未声明 feed，但探测到 ${probed.feedUrl.replace(url.origin, '')} 可用`,
      };
    }

    return {
      sourceType: 'Blog',
      displayName: title,
      platform: 'Blog',
      handle: input,
      trackMode: 'link-only',
      note: '该网站未发现 RSS feed（含常见路径探测），只能标记 + 跳转，无法持续追踪',
    };
  } catch (err) {
    // 首页抓不到（反爬/超时）≠ 没有 feed：探测链照走一遍再下结论
    const probed = await probeFeedPaths(url.origin).catch(() => null);
    if (probed) {
      return {
        sourceType: 'Blog',
        displayName: probed.feedTitle || host,
        platform: 'Blog',
        handle: probed.feedUrl,
        trackMode: 'active-rss',
        feedUrl: probed.feedUrl,
        siteUrl: input,
        note: `站点首页拒绝抓取，但探测到 feed：${probed.feedUrl}`,
      };
    }
    throw new Error(`无法访问该网页（${err.message}），且常见 feed 路径均不可用，请检查链接或网络`);
  }
}

// 登记：findOrCreate（按 platform+handle 判重，与 contents.js 的 findOrCreateSource 同约定）
// 已存在的 Source（如 AI HOT 同步时自动建的）→ 标记 registered_by_user=1，不重复建。
export function registerSource(identified) {
  const { sourceType, displayName, platform, handle, trackMode, feedUrl, siteUrl } = identified;
  const db = getDatabase();

  try {
    const existing = db
      .prepare('SELECT source_id FROM source_platforms WHERE platform = ? AND handle = ?')
      .get(platform, handle);

    let sourceId;
    if (existing) {
      sourceId = existing.source_id;
      db.prepare("UPDATE sources SET registered_by_user = 1, updated_at = datetime('now') WHERE id = ?").run(sourceId);
    } else {
      sourceId = randomUUID();
      db.prepare(`
        INSERT INTO sources (id, source_type, display_name, registered_by_user, status)
        VALUES (?, ?, ?, 1, 'active')
      `).run(sourceId, sourceType, displayName);
      db.prepare(`
        INSERT INTO source_platforms (source_id, platform, handle, track_mode, platform_metadata)
        VALUES (?, ?, ?, ?, ?)
      `).run(sourceId, platform, handle, trackMode, JSON.stringify({ feedUrl: feedUrl || null, siteUrl: siteUrl || null }));
    }

    const source = getSourceWithPlatforms(db, sourceId);
    return source;
  } finally {
    db.close();
  }
}

function getSourceWithPlatforms(db, sourceId) {
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId);
  if (!source) return null;
  source.platforms = db.prepare('SELECT * FROM source_platforms WHERE source_id = ?').all(sourceId);
  return source;
}

// 信息源列表：已登记的排前面，附带每个源的内容数
export function listSources({ registeredOnly = false } = {}) {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT s.*,
           COUNT(c.id) AS content_count
    FROM sources s
    LEFT JOIN contents c ON c.source_id = s.id
    ${registeredOnly ? 'WHERE s.registered_by_user = 1' : ''}
    GROUP BY s.id
    ORDER BY s.registered_by_user DESC, content_count DESC, s.followed_since DESC
  `).all();

  const platformStmt = db.prepare('SELECT * FROM source_platforms WHERE source_id = ?');
  for (const row of rows) {
    row.platforms = platformStmt.all(row.id);
  }
  db.close();
  return rows;
}

// 取消登记：只摘掉登记标记（内容仍引用该 source，不删记录）
export function unregisterSource(sourceId) {
  const db = getDatabase();
  const result = db
    .prepare("UPDATE sources SET registered_by_user = 0, updated_at = datetime('now') WHERE id = ?")
    .run(sourceId);
  db.close();
  return result.changes > 0;
}

// "把作者加为信息源"闭环（飞轮：内容 → Source）：
// - 内容已识别到作者 → 直接标记登记
// - 未识别到作者但有 URL → 走 identifyInput 识别站点并登记，同时回填 content.source_id
export async function followSourceOfContent(contentId) {
  const db = getDatabase();
  const content = db.prepare('SELECT * FROM contents WHERE id = ?').get(contentId);

  if (!content) {
    db.close();
    throw new Error('Content not found');
  }

  if (content.source_id) {
    db.prepare("UPDATE sources SET registered_by_user = 1, updated_at = datetime('now') WHERE id = ?").run(content.source_id);
    const source = getSourceWithPlatforms(db, content.source_id);
    db.close();
    return source;
  }

  db.close();

  if (!content.url) {
    throw new Error('该内容没有识别到作者，也没有可用链接，无法加为信息源');
  }

  const identified = await identifyInput(content.url);
  const source = registerSource(identified);

  const db2 = getDatabase();
  db2.prepare("UPDATE contents SET source_id = ?, updated_at = datetime('now') WHERE id = ?").run(source.id, contentId);
  db2.close();
  return source;
}
