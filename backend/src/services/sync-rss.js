import dotenv from 'dotenv';
dotenv.config(); // 在导入其他模块前加载环境变量

import { parseMultipleFeeds, transformRSSItem } from './rss.js';
import { translateText } from './translation.js';
import { upsertContents } from '../db/contents.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

// RSS 数据同步服务（对标 sync-aihot.js / sync-hackernews.js）
//
// 与 AI HOT/HackerNews 的差异：
// - RSS 源需要用户先配置（不是内置数据源）
// - 支持从数据库的 sources 表读取已配置的 RSS 源
// - 可以通过参数传入临时 RSS URL（测试/一次性导入）
//
// 使用方式：
// 1. 从数据库读取已配置的 RSS 源：syncRSSData()
// 2. 临时同步指定的 RSS 源：syncRSSData(['https://example.com/feed.xml'])

// 从数据库读取已配置的 RSS 源
// 注意：当前版本 (2026-07-12) 还没有 source_platforms 表，这是为未来预留
// 实际使用时需要先执行数据库迁移添加 RSS 源配置
async function getConfiguredRSSFeeds() {
  try {
    // TODO: 等 source_platforms 表实现后，从数据库读取
    // const { getDatabase } = await import('../db/init.js');
    // const db = getDatabase();
    // const rows = db.prepare(`
    //   SELECT sp.handle as feed_url, s.display_name
    //   FROM source_platforms sp
    //   JOIN sources s ON sp.source_id = s.id
    //   WHERE sp.platform = 'RSS' AND sp.track_mode = 'active'
    // `).all();
    // return rows.map(r => ({ url: r.feed_url, title: r.display_name }));

    // 临时方案：从环境变量读取（逗号分隔的 RSS URL）
    const envFeeds = process.env.RSS_FEEDS?.split(',').map(s => s.trim()).filter(Boolean);
    return envFeeds || [];
  } catch (error) {
    console.error('Failed to read RSS feeds from database:', error.message);
    return [];
  }
}

export async function syncRSSData(feedUrls = null, limitPerFeed = 20) {
  console.log('🔄 Starting RSS data sync...');

  // 如果没有传入 feedUrls，从数据库读取已配置的 RSS 源
  const feeds = feedUrls || await getConfiguredRSSFeeds();

  if (feeds.length === 0) {
    console.log('⚠️  No RSS feeds configured. Set RSS_FEEDS in .env or pass feedUrls parameter.');
    return { success: false, count: 0, message: 'No RSS feeds configured' };
  }

  console.log(`📡 Syncing from ${feeds.length} RSS feed(s): ${feeds.slice(0, 3).join(', ')}${feeds.length > 3 ? '...' : ''}`);

  try {
    const { items, feedsInfo } = await parseMultipleFeeds(feeds);

    if (items.length === 0) {
      console.log('⚠️  No items fetched from RSS feeds');
      return { success: false, count: 0 };
    }

    console.log(`📥 Fetched ${items.length} items from ${feedsInfo.length} feed(s)`);

    // 只取每个 feed 的前 N 条（避免一次性导入过多）
    const limitedItems = items.slice(0, limitPerFeed * feeds.length);

    // 转换成统一的 Content 模型 + 翻译英文标题
    const transformedItems = await Promise.all(
      limitedItems.map(async (item) => {
        const { content, sourceInfo } = transformRSSItem(
          item,
          item.feedUrl,
          item.feedTitle
        );

        // 如果是英文内容，翻译标题（与 sync-hackernews.js 保持一致）
        if (content.original_lang === 'en' && content.en_title) {
          content.zh_title = await translateText(content.en_title);
        } else {
          content.zh_title = content.en_title; // 中文内容直接使用
        }

        return { content, sourceInfo };
      })
    );

    // 批量入库
    const savedCount = upsertContents(transformedItems);

    console.log('✅ RSS sync completed');
    return {
      success: true,
      count: savedCount,
      feeds: feedsInfo.length,
      details: feedsInfo.map(f => `${f.title}: ${items.filter(i => i.feedUrl === f.feedUrl).length} items`)
    };
  } catch (error) {
    console.error('❌ RSS sync failed:', error.message);
    return { success: false, error: error.message, count: 0 };
  }
}

// 命令行直接运行：node src/services/sync-rss.js
// 或传入临时 RSS URL：node src/services/sync-rss.js https://example.com/feed.xml
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const cmdLineFeeds = process.argv.slice(2).filter(arg => arg.startsWith('http'));

  syncRSSData(cmdLineFeeds.length > 0 ? cmdLineFeeds : null).then(result => {
    console.log('Sync result:', result);
    if (result.details) {
      console.log('Details:', result.details.join(', '));
    }
    process.exit(result.success ? 0 : 1);
  });
}
