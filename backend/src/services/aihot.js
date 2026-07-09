import axios from 'axios';

const AIHOT_API_URL = process.env.AIHOT_API_URL || 'https://aihot.virxact.com/api/public/items';

export async function fetchAIHotItems(take = 100, skip = 0) {
  try {
    const response = await axios.get(AIHOT_API_URL, {
      params: { take, skip },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    return {
      success: true,
      data: response.data.items || [],
      count: response.data.count || 0,
      hasNext: response.data.hasNext || false
    };
  } catch (error) {
    console.error('Failed to fetch AI HOT items:', error.message);
    return {
      success: false,
      error: error.message,
      data: []
    };
  }
}

export async function fetchAllTodayItems() {
  const allItems = [];
  let skip = 0;
  const take = 100;
  let hasNext = true;

  while (hasNext && skip < 200) {
    const result = await fetchAIHotItems(take, skip);
    
    if (!result.success) {
      break;
    }

    allItems.push(...result.data);
    hasNext = result.hasNext;
    skip += take;
    
    if (!hasNext || result.data.length < take) {
      break;
    }
  }

  console.log(`✅ Fetched ${allItems.length} items from AI HOT`);
  return allItems;
}

export function transformAIHotItem(item) {
  return {
    id: item.id,
    source: item.source || 'unknown',
    title: item.title,
    title_en: item.title_en || '',
    url: item.url,
    summary: item.summary || '',
    category: item.category || 'tip',
    score: item.score || 0,
    pub_date: item.publishedAt || new Date().toISOString(),
    extracted_keywords: null, // 将在同步后批量提取
    user_action: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}
