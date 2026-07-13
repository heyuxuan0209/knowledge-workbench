import axios from 'axios';

// 官方 Hacker News API（Firebase 实时数据库），免费、无需认证。
// 排查记录：docs/TECH-SURVEY-FEED-SOURCES.md 里写的域名 hacker-news.firebaseapp.com 是错的
// （返回 404，那是 Firebase Hosting 域名），真实域名是 hacker-news.firebaseio.com
// （Firebase 实时数据库域名），已用 curl 实测校验过。
const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0';

export async function fetchTopStoryIds(limit = 30) {
  try {
    const response = await axios.get(`${HN_API_BASE}/topstories.json`, { timeout: 10000 });
    return response.data.slice(0, limit);
  } catch (error) {
    console.error('Failed to fetch HN top story ids:', error.message);
    return [];
  }
}

export async function fetchItem(id) {
  try {
    const response = await axios.get(`${HN_API_BASE}/item/${id}.json`, { timeout: 10000 });
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch HN item ${id}:`, error.message);
    return null;
  }
}

export async function fetchAllTopStories(limit = 30) {
  const ids = await fetchTopStoryIds(limit);
  const items = await Promise.all(ids.map(id => fetchItem(id)));
  // Ask HN 被删除或 fetchItem 失败时返回 null，且部分 item 是 job/poll 类型不算文章，过滤掉
  const stories = items.filter(item => item && item.type === 'story');

  console.log(`✅ Fetched ${stories.length}/${ids.length} stories from Hacker News`);
  return stories;
}

// 产出 { content, sourceInfo }，与 aihot.js 的 transformAIHotItem 保持一致的输出格式，
// 供 db/contents.js 的 upsertContents() 统一写入——验证 upsertContents 是「源无关」设计
// （不是只为 AI HOT 量身定制），这正是接入第二个源的意义所在。
export function transformHNItem(item) {
  const now = new Date().toISOString();

  // Ask HN / Show HN 等讨论帖没有外链 url，正文写在 text 字段（HTML），此时归为 text 类型，
  // 不伪造一个 url——contents.url 允许为空（schema-v3.sql 已支持纯文本粘贴场景）。
  const hasUrl = Boolean(item.url);

  const content = {
    id: `hn-${item.id}`, // 加前缀避免和 AI HOT 的 id 撞车（两边 id 生成规则完全独立）
    content_type: hasUrl ? 'article' : 'text',
    url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
    published_at: new Date(item.time * 1000).toISOString(),

    original_lang: 'en', // HN 内容几乎全是英文标题，统一按英文处理，翻译流水线会自动检测
    has_translation: 0,

    zh_title: null, // 尚未翻译，翻译在下一步的同步流程里做（对应 translation.js）
    zh_summary: null,
    en_title: item.title,

    input_method: 'feed',
    source_app: 'hackernews',
    fetch_status: 'success',
    external_score: item.score || 0,

    created_at: now,
    updated_at: now
  };

  // HN 用户名本身就是平台内唯一身份标识（不需要像 AI HOT 那样用正则从字符串里解析）
  const sourceInfo = item.by
    ? { displayName: item.by, platform: 'HackerNews', handle: item.by }
    : null;

  return { content, sourceInfo };
}
