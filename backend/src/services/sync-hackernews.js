import dotenv from 'dotenv';
dotenv.config();

import { fetchAllTopStories, transformHNItem } from './hackernews.js';
import { translateText } from './translation.js';
import { filterRelevant, batchSummarize, fetchFirstParagraph } from './ai-relevance.js';
import { upsertContents } from '../db/contents.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

// 同步流程（2026-07-14 数据质量轮）：
// 1. 相关性过滤（AI/软件工程/科技产品与创业才入库，一次 LLM 批量判断）
// 2. 对保留条目抓原文首段 → 批量生成一句话中文摘要（Feed 不允许光杆标题）
// 3. 翻译标题入库
export async function syncHackerNewsData(limit = 30) {
  console.log('🔄 Starting Hacker News data sync...');

  try {
    const stories = await fetchAllTopStories(limit);

    if (stories.length === 0) {
      console.log('⚠️  No stories fetched from Hacker News');
      return { success: false, count: 0 };
    }

    // 1. 相关性过滤
    const kept = await filterRelevant(stories.map(s => ({ id: s.id, title: s.title })));
    const relevant = stories.filter(s => kept.has(s.id));
    console.log(`🧹 relevance filter: ${relevant.length}/${stories.length} kept`);
    if (relevant.length === 0) return { success: true, count: 0 };

    // 2. 抓原文首段（并行，失败不阻塞）→ 批量摘要
    const excerpts = await Promise.all(
      relevant.map(s => s.url ? fetchFirstParagraph(s.url) : Promise.resolve(s.text?.replace(/<[^>]+>/g, '').slice(0, 800) || null))
    );
    const summaries = await batchSummarize(
      relevant.map((s, i) => ({ id: s.id, title: s.title, excerpt: excerpts[i] }))
    );

    // 3. 翻译标题 + 组装
    const transformedItems = await Promise.all(
      relevant.map(async (story) => {
        const { content, sourceInfo } = transformHNItem(story);
        content.zh_title = await translateText(content.en_title);
        content.zh_summary = summaries.get(story.id) || null;
        return { content, sourceInfo };
      })
    );

    const savedCount = upsertContents(transformedItems);

    console.log('✅ Hacker News sync completed');
    return { success: true, count: savedCount };
  } catch (error) {
    console.error('❌ Hacker News sync failed:', error.message);
    return { success: false, error: error.message, count: 0 };
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  syncHackerNewsData().then(result => {
    console.log('Sync result:', result);
    process.exit(result.success ? 0 : 1);
  });
}
