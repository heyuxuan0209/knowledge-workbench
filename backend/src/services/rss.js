import Parser from 'rss-parser';
import crypto from 'crypto';

// RSS feed 解析服务（复用现有 RSS 源，不重建订阅系统）
// 使用场景：
// 1. 用户手动添加 RSS 源（对应 WIREFRAMES.md §5-§7 的"管理数据源"流程）
// 2. 从博客、媒体、Newsletter 等 RSS 源摄入内容
// 3. 支持通过 RSSHub (https://docs.rsshub.app/) 将非 RSS 平台转换为 RSS
//
// 设计原则（对应 ADR-007 成本分层）：
// - RSS 源本身是"被动等待"（用户主动添加，产品定期拉取）
// - track_mode 设为 'passive'（不需要主动抓取，RSS 本身就是推送机制）
// - 与 AI HOT / HackerNews 的差异：RSS 源需要用户先配置，不是内置数据源

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  }
});

// 解析单个 RSS feed
export async function parseFeed(feedUrl) {
  try {
    const feed = await parser.parseURL(feedUrl);

    return {
      success: true,
      feedInfo: {
        title: feed.title,
        description: feed.description,
        link: feed.link,
        feedUrl: feedUrl
      },
      items: feed.items || []
    };
  } catch (error) {
    console.error(`Failed to parse RSS feed ${feedUrl}:`, error.message);
    return {
      success: false,
      error: error.message,
      items: []
    };
  }
}

// 批量解析多个 RSS feeds
export async function parseMultipleFeeds(feedUrls) {
  const results = await Promise.allSettled(
    feedUrls.map(url => parseFeed(url))
  );

  const allItems = [];
  const feedsInfo = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.success) {
      allItems.push(...result.value.items.map(item => ({
        ...item,
        feedUrl: feedUrls[index],
        feedTitle: result.value.feedInfo.title
      })));
      feedsInfo.push(result.value.feedInfo);
    } else {
      console.error(`Failed to parse feed ${feedUrls[index]}`);
    }
  });

  return { items: allItems, feedsInfo };
}

// 将 RSS item 转换成统一的 Content 模型（与 aihot.js/hackernews.js 保持一致）
export function transformRSSItem(item, feedUrl, feedTitle) {
  const now = new Date().toISOString();

  // RSS item 的发布时间可能有多种格式，优先使用 isoDate，回退到 pubDate
  const publishedAt = item.isoDate || item.pubDate || now;

  // 生成稳定的 content ID（基于 URL hash，确保同一文章不重复入库）
  const contentId = generateStableId(item.link);

  const content = {
    id: contentId,
    content_type: 'article',
    url: item.link,
    published_at: publishedAt,

    // RSS feed 语言检测：简单启发式（中文字符占比）
    original_lang: detectLanguage(item.title + ' ' + (item.contentSnippet || '')),
    has_translation: 0, // SQLite 使用整数表示布尔值

    // RSS item 通常有 title 和 contentSnippet，但完整正文需要抓取
    zh_title: null, // 待翻译（如果是英文 feed）
    zh_summary: null,
    en_title: item.title,

    input_method: 'feed', // 符合 schema-v3.sql 的 CHECK 约束
    source_app: 'rss', // 符合 schema-v3.sql 的 CHECK 约束
    fetch_status: 'pending', // 标题有，但正文待抓取
    external_score: 0, // RSS feed 通常没有评分

    created_at: now,
    updated_at: now
  };

  // RSS feed 通常有 creator 字段，但格式不统一（有些是名字，有些是邮箱）
  // 先提取，后续可以在 source-resolver.js 里进一步解析
  const sourceInfo = item.creator
    ? { displayName: item.creator, platform: 'RSS', handle: feedUrl }
    : null;

  return { content, sourceInfo };
}

// 根据 URL 生成稳定的 content ID（使用 URL hash）
function generateStableId(url) {
  const hash = crypto.createHash('sha256').update(url).digest('hex');
  return `rss-${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

// 简单语言检测（中文字符占比）
function detectLanguage(text) {
  if (!text) return 'unknown';
  const chineseChars = (text.match(/[一-龥]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  return totalChars > 0 && chineseChars / totalChars > 0.3 ? 'zh' : 'en';
}
