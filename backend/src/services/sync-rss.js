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

// 从两处读取已配置的 RSS 源并合并去重：
// 1. source_platforms 表里 track_mode='active-rss' 的登记源（M1 优质源登记处，ADR-007）
//    handle 存的是 feed URL（Blog 平台）或 feed 地址本身（RSS 平台）
// 2. 环境变量 RSS_FEEDS（逗号分隔，保留兼容老配置）
async function getConfiguredRSSFeeds() {
  const feeds = new Set();
  // feedUrl → 登记源身份（platform/handle/displayName）：该 feed 的每条内容都归属此源。
  // 2026-07-25 修：此前 RSS 条目靠 item.creator 解析归属，多数 feed 没 creator → 全部 0 linked；
  // 且默认 platform='RSS' 与登记的 Blog/Newsletter 不匹配 → 就算有 creator 也 link 不上。
  const sourceMap = new Map();

  try {
    const { getDatabase } = await import('../db/init.js');
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT sp.handle AS feed_url, sp.platform, sp.platform_metadata, s.display_name
      FROM source_platforms sp
      JOIN sources s ON sp.source_id = s.id
      WHERE sp.track_mode = 'active-rss' AND s.status = 'active'
    `).all();
    db.close();
    for (const row of rows) {
      const meta = JSON.parse(row.platform_metadata || '{}');
      const url = meta.feedUrl || row.feed_url;
      if (url?.startsWith('http')) {
        feeds.add(url);
        // handle 用登记时的 row.feed_url（findOrCreateSource 按 platform+handle 精确匹配才 link 得上）
        sourceMap.set(url, { platform: row.platform, handle: row.feed_url, displayName: row.display_name });
      }
    }
  } catch (error) {
    console.error('Failed to read RSS feeds from database:', error.message);
  }

  for (const url of process.env.RSS_FEEDS?.split(',').map(s => s.trim()).filter(Boolean) || []) {
    feeds.add(url);
  }
  return { feeds: [...feeds], sourceMap };
}

export async function syncRSSData(feedUrls = null, limitPerFeed = 20) {
  console.log('🔄 Starting RSS data sync...');

  // 如果没有传入 feedUrls，从数据库读取已配置的 RSS 源（带每 feed 的归属源）
  const { feeds, sourceMap } = feedUrls
    ? { feeds: feedUrls, sourceMap: new Map() }
    : await getConfiguredRSSFeeds();

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

    // 每个 feed 取前 N 条（2026-07-25 修：原来是 items.slice(0, N*feeds) 扁平封顶——
    // 官方大 feed 在前会吃光配额、后面新登记的个人博客 feed 一条都进不来 → 归属永远 0）
    const perFeedCount = {};
    const limitedItems = items.filter(item => {
      const k = item.feedUrl || '';
      perFeedCount[k] = (perFeedCount[k] || 0) + 1;
      return perFeedCount[k] <= limitPerFeed;
    });

    // 相关性过滤（2026-07-14 数据质量轮）：AI/软件工程/科技产品与创业才入库
    const { filterRelevant } = await import('./ai-relevance.js');
    const pretransformed = limitedItems.map(item => {
      // 无 link 的条目跳过（部分 Atom feed 的 link 结构不同 → generateStableId 曾 crash 整批）
      if (!item.link) return null;
      try {
        const t = transformRSSItem(item, item.feedUrl, item.feedTitle);
        // 登记源的 feed → 全部条目归属该源（覆盖默认 creator 解析，platform/handle 对齐登记，才 link 得上）
        const src = sourceMap.get(item.feedUrl);
        return src ? { content: t.content, sourceInfo: { displayName: src.displayName, platform: src.platform, handle: src.handle } } : t;
      } catch { return null; }
    }).filter(Boolean);
    const kept = await filterRelevant(pretransformed.map(({ content }) => ({ id: content.id, title: content.en_title })));
    const relevantItems = pretransformed.filter(({ content }) => kept.has(content.id));
    console.log(`🧹 relevance filter: ${relevantItems.length}/${pretransformed.length} kept`);

    // 翻译标题 + 摘要——限并发（2026-07-26 修：原来 Promise.all 把几百条一次性并发翻译，
    // 打爆代理/API → "Connection error" → 整批回退英文 → feed 全英文标题。改成每次最多 CONC 条）。
    const translateOne = async ({ content, sourceInfo }) => {
      try {
        if (content.original_lang === 'en') {
          content.zh_title = content.en_title ? await translateText(content.en_title) : null;
          content.zh_summary = content.en_summary ? await translateText(content.en_summary.slice(0, 300)) : null;
        } else {
          content.zh_title = content.en_title;
          content.zh_summary = content.en_summary;
        }
      } catch (e) {
        // 翻译失败不丢内容：回退英文原文，内容照样入库/归属源；下轮同步/兜底再补译
        content.zh_title = content.zh_title || content.en_title;
        content.zh_summary = content.zh_summary || content.en_summary;
      }
      return { content, sourceInfo };
    };
    const CONC = 6;
    const transformedItems = new Array(relevantItems.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(CONC, relevantItems.length) }, async () => {
      while (cursor < relevantItems.length) { const i = cursor++; transformedItems[i] = await translateOne(relevantItems[i]); }
    }));

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
