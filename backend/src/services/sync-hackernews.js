import { fetchAllTopStories, transformHNItem } from './hackernews.js';
import { translateText } from './translation.js';
import { upsertContents } from '../db/contents.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

// 与 sync-aihot.js 的差异：AI HOT 本身带中文标题，HN 完全没有，同步时必须现场翻译标题，
// 否则 zh_title 留空会导致 Feed 卡片渲染出问题（renderCard 直接用 zh_title 显示）。
// 只翻译标题不翻译全文——全文摘要/原文分析是选中时才做的事（content-analysis.js /
// ephemeral-chat.js 的 resolveContentBody），同步阶段翻译全文没有意义还浪费成本。
export async function syncHackerNewsData(limit = 30) {
  console.log('🔄 Starting Hacker News data sync...');

  try {
    const stories = await fetchAllTopStories(limit);

    if (stories.length === 0) {
      console.log('⚠️  No stories fetched from Hacker News');
      return { success: false, count: 0 };
    }

    const transformedItems = await Promise.all(
      stories.map(async (story) => {
        const { content, sourceInfo } = transformHNItem(story);
        content.zh_title = await translateText(content.en_title);
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
