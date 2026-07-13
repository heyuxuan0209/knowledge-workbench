import { fetchMultiplePlatforms, transformNewsNowItem, SUPPORTED_PLATFORMS } from './newsnow.js';
import { translateText } from './translation.js';
import { upsertContents } from '../db/contents.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

// NewsNow 数据同步服务（对标 sync-aihot.js / sync-hackernews.js）
//
// 与 AI HOT/HackerNews 的差异：
// - NewsNow 是聚合多个平台的热榜，需要指定要同步哪些平台
// - 默认同步技术相关平台（知乎、B站、掘金、36氪、少数派）
// - 可通过环境变量 NEWSNOW_PLATFORMS 配置（逗号分隔，如 "zhihu,bilibili,juejin"）
// - NewsNow 只提供标题和链接，不提供正文，zh_summary 留空，fetch_status 设为 'pending'
//   （正文抓取由 content-body-resolver.js 按需处理，即兴分析/内容分析选中时才抓）
// - 标题已经是中文，不需要翻译（与 HackerNews 不同）

const DEFAULT_PLATFORMS = ['zhihu', 'bilibili', 'juejin', '36kr', 'sspai'];
const ITEMS_PER_PLATFORM = 15; // 每个平台取 15 条，避免信息过载

export async function syncNewsNowData(platforms = null, limitPerPlatform = ITEMS_PER_PLATFORM) {
  console.log('🔄 Starting NewsNow data sync...');

  // 从环境变量或参数读取要同步的平台列表
  const targetPlatforms = platforms
    || (process.env.NEWSNOW_PLATFORMS?.split(',').map(s => s.trim()).filter(Boolean))
    || DEFAULT_PLATFORMS;

  console.log(`📡 Syncing from platforms: ${targetPlatforms.join(', ')}`);

  try {
    const items = await fetchMultiplePlatforms(targetPlatforms, limitPerPlatform);

    if (items.length === 0) {
      console.log('⚠️  No items fetched from NewsNow');
      return { success: false, count: 0 };
    }

    console.log(`📥 Fetched ${items.length} items from ${targetPlatforms.length} platforms`);

    // 转换成统一的 Content 模型
    const transformedItems = items.map(transformNewsNowItem);

    // 批量入库（复用 contents.js 的 upsert 逻辑，自动去重）
    const savedCount = upsertContents(transformedItems);

    console.log('✅ NewsNow sync completed');
    return {
      success: true,
      count: savedCount,
      platforms: targetPlatforms.length,
      details: targetPlatforms.map(p => `${p}: ${items.filter(i => i.platform === p).length}`)
    };
  } catch (error) {
    console.error('❌ NewsNow sync failed:', error.message);
    return { success: false, error: error.message, count: 0 };
  }
}

// 命令行直接运行：node src/services/sync-newsnow.js
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  syncNewsNowData().then(result => {
    console.log('Sync result:', result);
    console.log('Details:', result.details?.join(', '));
    process.exit(result.success ? 0 : 1);
  });
}
