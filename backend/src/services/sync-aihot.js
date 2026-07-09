import { fetchAllTodayItems, transformAIHotItem } from './aihot.js';
import { saveItems } from '../db/db.js';

export async function syncAIHotData() {
  console.log('🔄 Starting AI HOT data sync...');
  
  try {
    const rawItems = await fetchAllTodayItems();
    
    if (rawItems.length === 0) {
      console.log('⚠️  No items fetched from AI HOT');
      return { success: false, count: 0 };
    }

    const transformedItems = rawItems.map(transformAIHotItem);
    
    const savedCount = saveItems(transformedItems);
    
    console.log('✅ AI HOT sync completed');
    return { success: true, count: savedCount };
  } catch (error) {
    console.error('❌ AI HOT sync failed:', error.message);
    return { success: false, error: error.message, count: 0 };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncAIHotData().then(result => {
    console.log('Sync result:', result);
    process.exit(result.success ? 0 : 1);
  });
}
