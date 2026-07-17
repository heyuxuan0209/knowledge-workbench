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
const FEED_PROBE_PATHS = ['/feed', '/rss', '/atom.xml', '/index.xml', '/feed.xml', '/rss.xml', '/feeds/posts/default'];

// 取 feed 自身的标题（channel/feed 级 <title>，头 500 字符内必然出现）；失败返回 null
async function fetchFeedTitle(feedUrl) {
  try {
    const res = await fetch(feedUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeWorkbench/0.1)' },
    });
    if (!res.ok) return null;
    const head = (await res.text()).slice(0, 500);
    return head.match(/<title[^>]*>(?:<!\[CDATA\[)?([^<\]]+)/i)?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

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

// 已知无 RSS 站点的社区镜像 feed（与 OFFICIAL_PACK 同源：Olshansk/rss-feeds，逐日从官网生成）。
// 2026-07-17 反馈：用户贴 claude.com/blog 文章链接被登记为 link-only（"加了没反应"）——
// 该站确实无 feed（<link> 无声明 + 常见路径全 404，实测），但镜像可用，应直接升级为 active-rss。
// 匹配规则：host 相同（已去 www）且路径落在 pathPrefix 下（含文章内页链接）。
const KNOWN_FEED_MIRRORS = [
  { host: 'claude.com', pathPrefix: '/blog', displayName: 'Claude Blog（官方博客）', feedUrl: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml', siteUrl: 'https://claude.com/blog' },
  { host: 'anthropic.com', pathPrefix: '/news', displayName: 'Anthropic News（Claude 官方动态）', feedUrl: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml', siteUrl: 'https://www.anthropic.com/news' },
  { host: 'anthropic.com', pathPrefix: '/engineering', displayName: 'Anthropic Engineering（工程博客）', feedUrl: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_engineering.xml', siteUrl: 'https://www.anthropic.com/engineering' },
  { host: 'anthropic.com', pathPrefix: '/research', displayName: 'Anthropic Research（研究文章）', feedUrl: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_research.xml', siteUrl: 'https://www.anthropic.com/research' },
];

// 自动识别输入 → 身份预览（不落库）。返回结构给前端确认后再 register。
export async function identifyInput(rawInput) {
  const input = rawInput.trim();
  if (!input) throw new Error('input is required');

  // ---- 非 URL：先认 @handle（X 账号），再按公众号名称处理 ----
  // 2026-07-16 反馈：用户输入 @AnthropicAI 被当成公众号登记——@ 开头的 ASCII handle
  // 是 X 的通用写法，必须识别为 X 账号（借道 AI HOT，与 x.com 链接同路）
  if (!/^https?:\/\//i.test(input)) {
    const atHandle = input.match(/^@([A-Za-z0-9_]{1,15})$/);
    if (atHandle) {
      return {
        sourceType: 'Person',
        displayName: atHandle[1],
        platform: 'X',
        handle: atHandle[1],
        trackMode: 'passive',
        note: 'X 暂不支持直接抓取（需登录态）。已登记借道 AI HOT：该作者被 AI HOT 转载的热门内容会自动归属此源、进 Feed 并加权',
      };
    }
    return {
      sourceType: 'Media',
      displayName: input,
      platform: 'WeChat',
      handle: input,
      trackMode: 'link-only',
      note: '公众号不抓取，只标记 + 等 AI HOT 推送 + 跳转原文。若想登记 X 账号，请输入 @用户名 或 x.com 链接',
    };
  }

  const url = new URL(input);
  const host = url.hostname.replace(/^www\./, '');

  // ---- X / Twitter：从链接提取用户名（支持个人主页和推文链接） ----
  // 借道 AI HOT（2026-07-16 用户拍板）：X 直接抓取属登录态渠道（后置），登记为 passive——
  // AI HOT 转载的同 handle 内容会按 platform+handle 自动归属此源并进 Feed 加权，
  // 不再标 active-query（那档只会被 sync 永远跳过，用户看到的就是"加了没反应"）
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
      trackMode: 'passive',
      note: 'X 暂不支持直接抓取（需登录态）。已登记借道 AI HOT：该作者被 AI HOT 转载的热门内容会自动归属此源、进 Feed 并加权',
    };
  }

  // ---- YouTube：@handle / channel/ID / c/name；视频链接自动归到所属频道 ----
  if (host === 'youtube.com' || host === 'youtu.be') {
    const parts = url.pathname.split('/').filter(Boolean);
    let handle = null;
    if (parts[0]?.startsWith('@')) handle = parts[0];
    else if (parts[0] === 'channel' || parts[0] === 'c' || parts[0] === 'user') handle = parts[1];
    if (!handle) {
      // 2026-07-17 反馈：Feed 流里复制的就是 watch 链接，必须能识别——解析视频所属频道
      const videoId = host === 'youtu.be' ? parts[0]
        : (url.searchParams.get('v') || (parts[0] === 'shorts' || parts[0] === 'live' ? parts[1] : null));
      if (videoId) {
        const { fetchYoutubeVideoChannel } = await import('./active-query-channels.js');
        const ch = await fetchYoutubeVideoChannel(videoId);
        if (ch) {
          return {
            sourceType: 'YouTubeChannel',
            displayName: ch.name,
            platform: 'YouTube',
            handle: ch.handle,
            trackMode: 'active-query',
            note: `已从视频自动识别所属频道 ${ch.name}，登记后每日追更该频道`,
          };
        }
      }
      throw new Error('无法从该 YouTube 链接识别出频道，请使用频道主页链接（youtube.com/@xxx）或视频链接');
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

  // ---- Bilibili 视频链接：/video/BV… 自动归到 UP 主（2026-07-17 反馈，同 YouTube） ----
  if (host === 'bilibili.com' && /^\/video\//.test(url.pathname)) {
    const { fetchBiliVideoOwner } = await import('./active-query-channels.js');
    const owner = await fetchBiliVideoOwner(input);
    if (owner) {
      return {
        sourceType: 'Person',
        displayName: owner.name,
        platform: 'Bilibili',
        handle: owner.uid,
        trackMode: 'active-query',
        note: `已从视频自动识别 UP 主 ${owner.name}，登记后每日追更（bili-cli 免登录，ADR-014）`,
      };
    }
    throw new Error('无法从该视频解析出 UP 主，请使用 UP 主主页链接（space.bilibili.com/UID）');
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

  // ---- 小宇宙播客：节目页 /podcast/<pid> 或单集页 /episode/<eid>（自动归到所属节目） ----
  // 小宇宙无公开 RSS，走 active-query：每日抓节目页 __NEXT_DATA__ 追更（免登录零成本）
  if (host === 'xiaoyuzhoufm.com') {
    if (!/\/(podcast|episode)\//.test(url.pathname)) {
      throw new Error('请使用小宇宙节目页链接（xiaoyuzhoufm.com/podcast/…）或任意单集链接');
    }
    const { fetchXiaoyuzhouMeta } = await import('./active-query-channels.js');
    const meta = await fetchXiaoyuzhouMeta(input);
    return {
      sourceType: 'Media',
      displayName: meta.title,
      platform: 'Podcast',
      handle: meta.pid,
      trackMode: 'active-query',
      note: '每日抓取该节目最新单集进 Feed（小宇宙无公开 RSS，走页面数据，免登录）。单集可点"精读"转写解读',
    };
  }

  // ---- Hacker News：内置源，无需登记 ----
  if (host === 'news.ycombinator.com') {
    throw new Error('无需登记：Hacker News 是内置源，每天 7:30 自动同步进 Feed（登记反而会造成重复入库）');
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

  // ---- 已知无 RSS 站点 → 社区镜像 feed（升级为 active-rss，而不是降级 link-only） ----
  const mirror = KNOWN_FEED_MIRRORS.find(
    (m) => m.host === host && (url.pathname === m.pathPrefix || url.pathname.startsWith(m.pathPrefix + '/'))
  );
  if (mirror) {
    return {
      sourceType: 'Blog',
      displayName: mirror.displayName,
      platform: 'RSS',
      handle: mirror.feedUrl,
      trackMode: 'active-rss',
      feedUrl: mirror.feedUrl,
      siteUrl: mirror.siteUrl,
      note: '官网不提供 RSS，已自动改用社区镜像 feed（Olshansk/rss-feeds，逐日从官网生成）持续追踪',
    };
  }

  // ---- 通用网页：尝试 RSS 发现 ----
  try {
    const res = await fetchWithTimeout(input);
    // Cloudflare 盾/限流页不是内容页（标题是 "Attention Required!" 这类，绝不能当显示名），
    // 转入 catch 的探测降级链。404 除外：内容页 404 的 HTML 里常仍声明整站 feed
    if ([401, 403, 429].includes(res.status) || res.status >= 500) throw new Error(`HTTP ${res.status}`);
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
      // 2026-07-17 反馈：复制文章链接登记时，页面 <title> 是文章标题（404 页甚至是
      // "Page not found"），但登记的是整站 feed——显示名优先取 feed 自己的标题
      const feedTitle = await fetchFeedTitle(feedUrl);
      return {
        sourceType: 'Blog',
        displayName: feedTitle || title,
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
    // 2026-07-17 反馈：复制任意 URL 都应能识别——网站拒绝抓取也不报错终结，
    // 降级为 link-only（与"有页面但无 feed"同档），至少完成登记 + 跳转
    return {
      sourceType: 'Blog',
      displayName: host,
      platform: 'Blog',
      handle: input,
      trackMode: 'link-only',
      note: `该网站拒绝抓取或无法访问（${err.message}），且常见 feed 路径均不可用：只登记跳转，无法自动追踪`,
    };
  }
}

// 官方源包（2026-07-16 反馈 #9：想关注 Claude/OpenAI/Anthropic/ChatGPT/Google 官方动态与研究）。
// 每条 feed 都实测可达后才入包（2026-07-16 验证）。Anthropic 官网不提供 RSS（/rss.xml 404），
// 用社区维护的镜像 feed（Olshansk/rss-feeds，逐日从官网生成）；OpenAI/Google 系为官方 feed。
export const OFFICIAL_PACK = [
  { displayName: 'Claude Blog（官方博客）', feedUrl: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml', siteUrl: 'https://claude.com/blog' },
  { displayName: 'Anthropic News（Claude 官方动态）', feedUrl: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml', siteUrl: 'https://www.anthropic.com/news' },
  { displayName: 'Anthropic Engineering（工程博客）', feedUrl: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_engineering.xml', siteUrl: 'https://www.anthropic.com/engineering' },
  { displayName: 'Anthropic Research（研究文章）', feedUrl: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_research.xml', siteUrl: 'https://www.anthropic.com/research' },
  { displayName: 'OpenAI News（含 ChatGPT 发布动态）', feedUrl: 'https://openai.com/news/rss.xml', siteUrl: 'https://openai.com/news' },
  { displayName: 'Google AI Blog', feedUrl: 'https://blog.google/technology/ai/rss/', siteUrl: 'https://blog.google/technology/ai/' },
  { displayName: 'Google Research Blog', feedUrl: 'https://research.google/blog/rss/', siteUrl: 'https://research.google/blog/' },
  { displayName: 'Google DeepMind Blog', feedUrl: 'https://deepmind.google/blog/rss.xml', siteUrl: 'https://deepmind.google/blog/' },
];

// 一键登记官方源包（findOrCreate 幂等，重复点击不会建重）
export function registerOfficialPack() {
  const results = [];
  for (const p of OFFICIAL_PACK) {
    try {
      const source = registerSource({
        sourceType: 'Blog', displayName: p.displayName, platform: 'RSS',
        handle: p.feedUrl, trackMode: 'active-rss', feedUrl: p.feedUrl, siteUrl: p.siteUrl,
      });
      results.push({ displayName: p.displayName, success: true, sourceId: source.id });
    } catch (err) {
      results.push({ displayName: p.displayName, success: false, error: err.message });
    }
  }
  return results;
}

// 登记：findOrCreate（按 platform+handle 判重，与 contents.js 的 findOrCreateSource 同约定）
// 已存在的 Source（如 AI HOT 同步时自动建的）→ 标记 registered_by_user=1，不重复建。
export function registerSource(identified) {
  const { sourceType, displayName, platform, handle, trackMode, feedUrl, siteUrl } = identified;
  const db = getDatabase();

  try {
    // handle 大小写不敏感（X/GitHub/YouTube 的 handle 均不区分大小写）：
    // 用户登记 karpathy、AI HOT 写 Karpathy 时必须合并成同一个源，否则借道归属失效
    const existing = db
      .prepare('SELECT source_id FROM source_platforms WHERE platform = ? AND handle = ? COLLATE NOCASE')
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
