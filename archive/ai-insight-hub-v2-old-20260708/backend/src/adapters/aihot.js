import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_URL = 'https://aihot.virxact.com/api/public/items';

/**
 * 获取 AI HOT 数据
 * @param {Object} options - 请求选项
 * @returns {Promise<Array>} 标准化的内容列表
 */
export async function fetchAIHotItems(options = {}) {
  const { mode = 'selected', take = 100 } = options;

  try {
    const url = `${API_URL}?mode=${mode}&take=${take}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    if (!response.ok) {
      throw new Error(`AI HOT API error: ${response.status}`);
    }

    const data = await response.json();

    // 标准化数据格式
    return data.map(item => ({
      id: item.id,
      source: 'aihot',
      title: item.title,
      url: item.url,
      summary: item.summary || '',
      category: item.category || 'unknown',
      pub_date: item.publishedAt || item.createdAt,
      score: item.score || 50,
      raw_data: JSON.stringify(item)
    }));
  } catch (error) {
    console.error('Failed to fetch AI HOT items:', error.message);

    // 回退到测试数据
    console.log('Falling back to test data...');
    try {
      const testDataPath = join(__dirname, '../../data/test-data.json');
      const testData = JSON.parse(readFileSync(testDataPath, 'utf-8'));

      // 处理测试数据格式
      const items = testData.items || testData;

      if (!Array.isArray(items)) {
        throw new Error('Test data is not an array');
      }

      return items.map(item => ({
        id: item.raw?.id || item.id || Math.random().toString(36),
        source: 'aihot',
        title: item.title,
        url: item.url,
        summary: item.raw?.summary || item.summary || '',
        category: item.category || 'unknown',
        pub_date: item.pub_date || item.raw?.publishedAt,
        score: item.score || 50,
        raw_data: JSON.stringify(item.raw || item)
      }));
    } catch (fallbackError) {
      console.error('Failed to load test data:', fallbackError.message);
      throw new Error('Unable to fetch data from API or test data');
    }
  }
}
