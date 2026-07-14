import { fetchAllTodayItems, transformAIHotItem } from './aihot.js';
import { upsertContents } from '../db/contents.js';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolve } from 'path';

export async function syncAIHotData() {
  console.log('🔄 Starting AI HOT data sync...');

  try {
    const rawItems = await fetchAllTodayItems();

    if (rawItems.length === 0) {
      console.log('⚠️  No items fetched from AI HOT');
      return { success: false, count: 0 };
    }

    // 只收精选（2026-07-14 用户决策）：AI HOT 已做质量筛选，非精选不入库
    const selectedItems = rawItems.filter(item => item.selected === true);
    console.log(`📥 ${selectedItems.length}/${rawItems.length} selected items`);

    const transformedItems = selectedItems.map(transformAIHotItem);

    const savedCount = upsertContents(transformedItems);

    console.log('✅ AI HOT sync completed');
    return { success: true, count: savedCount };
  } catch (error) {
    console.error('❌ AI HOT sync failed:', error.message);
    return { success: false, error: error.message, count: 0 };
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  syncAIHotData().then(result => {
    console.log('Sync result:', result);
    process.exit(result.success ? 0 : 1);
  });
}
