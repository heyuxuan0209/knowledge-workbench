import { getDatabase } from '../db/init.js';
import { fetchFeedItems, transformRSSItem } from './rss.js';
import { detectLanguage, translateText } from './translation.js';
import { upsertContents } from '../db/contents.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';
import dotenv from 'dotenv';

// translateText() 依赖 llm.js 读取的 DEEPSEEK_API_KEY，通过 server.js 的路由触发时已由
// server.js 顶部的 dotenv.config() 加载过；这里补一次是为了让 `node sync-rss.js` 单独跑时
// (CLI 入口，见文件末尾) 也能读到 .env，和 backfill-keywords.js 的做法一致。
dotenv.config();

// RSS 源和 AI HOT/HN 的关键差异：RSS 的 Source 身份在同步之前就已经确定——用户是通过
// /api/sources/add-by-input（source-resolver.js 识别 + routes/sources.js 落库）主动添加的，
// 不需要像 aihot.js 那样从条目文本里现场解析作者。这里直接读 source_platforms 拿到已知
// source_id，同步逻辑只负责"拉取这个 source 名下的 feed 有什么新内容"。
// 排查记录：resolveSourceFromInput()（source-resolver.js）在页面上找不到 <link rel="alternate">
// 时会退化为"单篇文章"，但仍然把 platform 记成 'RSS'、handle 记成那篇文章/视频的原始链接
// （platform_metadata.is_single_article = true），而不是真正的 feed URL。这类记录直接拿去
// fetchFeedItems() 会请求到一个普通网页而不是 XML feed，解析不出条目——同步阶段就该排除，
// 不能指望 add-by-input 那一层先修好（这是两个独立的坑，各自的行为都是"合理的降级"）。
function getActiveRSSFeeds(db) {
  const rows = db.prepare(`
    SELECT sp.source_id, sp.handle AS feed_url, sp.platform_metadata, s.display_name
    FROM source_platforms sp
    JOIN sources s ON s.id = sp.source_id
    WHERE sp.platform = 'RSS' AND s.status = 'active'
  `).all();

  return rows.filter(row => {
    try {
      return !JSON.parse(row.platform_metadata || '{}').is_single_article;
    } catch {
      return true;
    }
  });
}

// 标题/摘要必须翻译（ADR-010 硬约束），逐条翻译而非拼一次性大 prompt——RSS 条目数量不定，
// 拼在一起翻译会导致单次 prompt 过长且一条失败拖累全部；translateText 内部按字符长度分块，
// 单条摘要通常很短，逐条调用的额外开销可接受。
async function localizeItem(item) {
  const lang = detectLanguage(item._rawTitle);

  if (lang === 'zh') {
    return {
      original_lang: 'zh',
      has_translation: 0,
      zh_title: item._rawTitle,
      zh_summary: item._rawDescription || null,
      en_title: null
    };
  }

  const [zhTitle, zhSummary] = await Promise.all([
    item._rawTitle ? translateText(item._rawTitle) : null,
    item._rawDescription ? translateText(item._rawDescription) : null
  ]);

  return {
    original_lang: lang,
    has_translation: 1,
    zh_title: zhTitle,
    zh_summary: zhSummary,
    en_title: item._rawTitle || null
  };
}

export async function syncRSSFeeds(limit = 20) {
  console.log('🔄 Starting RSS feeds sync...');

  const db = getDatabase();
  let feeds;
  try {
    feeds = getActiveRSSFeeds(db);
  } finally {
    db.close();
  }

  if (feeds.length === 0) {
    console.log('⚠️  No active RSS feeds configured (add one via POST /api/sources/add-by-input)');
    return { success: true, count: 0, feedsProcessed: 0, feedsFailed: 0 };
  }

  const toUpsert = [];
  let feedsFailed = 0;

  for (const feed of feeds) {
    try {
      const rawItems = await fetchFeedItems(feed.feed_url, limit);

      for (const rawItem of rawItems) {
        const content = transformRSSItem(rawItem);
        Object.assign(content, await localizeItem(content));

        // sourceInfo.sourceId 让 upsertContents 直接复用已知 source，不再按 platform+handle 判重
        toUpsert.push({ content, sourceInfo: { sourceId: feed.source_id } });
      }

      console.log(`  · ${feed.display_name}: ${rawItems.length} items fetched`);
    } catch (error) {
      feedsFailed++;
      console.error(`❌ Failed to sync RSS feed "${feed.display_name}" (${feed.feed_url}):`, error.message);
    }
  }

  const savedCount = upsertContents(toUpsert);

  console.log(`✅ RSS sync completed: ${savedCount} contents from ${feeds.length - feedsFailed}/${feeds.length} feeds`);
  return {
    success: true,
    count: savedCount,
    feedsProcessed: feeds.length,
    feedsFailed
  };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  syncRSSFeeds().then(result => {
    console.log('Sync result:', result);
    process.exit(result.success ? 0 : 1);
  });
}
