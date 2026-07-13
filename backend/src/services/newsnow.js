import axios from 'axios';
import { randomUUID } from 'crypto';
import crypto from 'crypto';

// NewsNow API 客户端（来源：https://github.com/Busiyian/NewsNow）
// 覆盖 30+ 国内主流平台（知乎、B站、微博、抖音、百度、今日头条等）
// 协议：MIT，免费，无需认证
// 参考：docs/ANALYSIS-TRENDRADAR.md（深度分析 TrendRadar 如何使用 NewsNow）

const NEWSNOW_BASE_URL = 'https://newsnow.busiyi.world/api/v1';

// NewsNow 支持的平台列表（从 https://github.com/Busiyian/NewsNow/blob/main/src/sources/ 提取）
export const SUPPORTED_PLATFORMS = {
  // 综合平台
  zhihu: { id: 'zhihu', name: '知乎热榜', category: 'comprehensive' },
  weibo: { id: 'weibo', name: '微博热搜', category: 'comprehensive' },
  baidu: { id: 'baidu', name: '百度热搜', category: 'comprehensive' },
  toutiao: { id: 'toutiao', name: '今日头条', category: 'comprehensive' },
  douyin: { id: 'douyin', name: '抖音热点', category: 'comprehensive' },

  // 技术平台
  bilibili: { id: 'bilibili', name: 'B站热门', category: 'tech' },
  juejin: { id: 'juejin', name: '掘金', category: 'tech' },
  csdn: { id: 'csdn', name: 'CSDN', category: 'tech' },
  '36kr': { id: '36kr', name: '36氪', category: 'tech' },
  sspai: { id: 'sspai', name: '少数派', category: 'tech' },

  // 资讯平台
  thepaper: { id: 'thepaper', name: '澎湃新闻', category: 'news' },

  // 娱乐平台
  douban: { id: 'douban', name: '豆瓣', category: 'entertainment' },

  // 电商平台
  taobao: { id: 'taobao', name: '淘宝热搜', category: 'ecommerce' },
  jd: { id: 'jd', name: '京东热搜', category: 'ecommerce' }
};

// 从 NewsNow 拉取指定平台的热榜数据
// platformId: 'zhihu' | 'weibo' | 'bilibili' | ...
// limit: 拉取条数（默认 20）
export async function fetchPlatformHotList(platformId, limit = 20) {
  try {
    const response = await axios.get(`${NEWSNOW_BASE_URL}/sources/${platformId}`, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://newsnow.busiyi.world/'
      }
    });

    if (!response.data || !response.data.data) {
      console.warn(`⚠️  NewsNow API returned unexpected format for ${platformId}`);
      return [];
    }

    // NewsNow 返回格式：{ data: [{ title, url, extra: { hotValue } }] }
    const items = response.data.data.slice(0, limit);

    return items.map(item => ({
      title: item.title,
      url: item.url,
      hotValue: item.extra?.hotValue || 0,
      platform: platformId,
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    console.error(`❌ Failed to fetch ${platformId} from NewsNow:`, error.message);
    return [];
  }
}

// 批量拉取多个平台的热榜数据
export async function fetchMultiplePlatforms(platformIds, limitPerPlatform = 20) {
  const results = await Promise.allSettled(
    platformIds.map(id => fetchPlatformHotList(id, limitPerPlatform))
  );

  const items = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      console.error(`❌ Failed to fetch ${platformIds[index]}:`, result.reason);
    }
  });

  return items;
}

// 将 NewsNow 的原始数据转换成统一的 Content 模型（与 aihot.js/hackernews.js 保持一致）
export function transformNewsNowItem(item) {
  const platformInfo = SUPPORTED_PLATFORMS[item.platform];
  const platformName = platformInfo?.name || item.platform;

  const content = {
    id: generateStableId(item.url),
    content_type: 'article',
    url: item.url,
    published_at: item.timestamp,
    original_lang: 'zh', // NewsNow 的国内平台内容默认中文
    has_translation: false,
    zh_title: item.title,
    zh_summary: null, // NewsNow 不提供摘要，需要后续抓取或生成
    en_title: null,
    input_method: 'feed_auto',
    source_app: `newsnow_${item.platform}`,
    fetch_status: 'pending', // 标题已有，但正文待抓取
    external_score: item.hotValue,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // NewsNow 不提供作者信息，sourceInfo 设为 null（对应 ADR-007 的"媒体源"场景）
  // 未来如果从正文页面能解析出作者，可在 content-body-resolver.js 里补充
  const sourceInfo = null;

  return { content, sourceInfo };
}

// 根据 URL 生成稳定的 content ID（使用 URL hash 确保同一 URL 生成相同 ID，避免重复入库）
function generateStableId(url) {
  const hash = crypto.createHash('sha256').update(url).digest('hex');
  // 转换成 UUID 格式（保持与现有 ID 格式一致）
  return `nn-${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
