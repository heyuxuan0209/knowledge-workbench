import axios from 'axios';
import { parseAuthorFromAIHotSource, detectContentType } from './source-identity.js';

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

// 产出 contents 表字段 + 识别出的 sourceInfo（供 sync-aihot.js 落库时创建/关联 Source）。
// 取代旧版输出 items 表字段的实现（v3 数据模型迁移，见 docs/WIREFRAMES.md、schema-v3.sql）。
export function transformAIHotItem(item) {
  const hasEnTitle = Boolean(item.title_en && item.title_en.length > 0);
  const now = new Date().toISOString();

  const content = {
    id: item.id,
    content_type: detectContentType(item.url),
    url: item.url,
    permalink: item.permalink || item.attribution?.canonical || null, // AI HOT 全文解读页
    published_at: item.publishedAt || now,

    original_lang: hasEnTitle ? 'en' : 'zh',
    has_translation: hasEnTitle ? 1 : 0,

    zh_title: item.title,
    zh_summary: item.summary || '',
    en_title: item.title_en || null,

    input_method: 'feed',
    source_app: 'aihot',
    fetch_status: 'success',
    external_score: item.score || 0,
    // 复用 AI HOT 的标签（ADR-012 复用优先）：category（如 tip/news）+ 精选标记
    tags: JSON.stringify([item.category, item.selected ? '精选' : null].filter(Boolean)),

    created_at: now,
    updated_at: now
  };

  const sourceInfo = parseAuthorFromAIHotSource(item.source);

  return { content, sourceInfo };
}
