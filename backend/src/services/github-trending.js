// GitHub Trending 接入（M2，ADR-012；信源池模式：不创建 Source 身份，内容直接进 Feed）。
// GitHub 无官方 Trending API，解析 https://github.com/trending 页面 HTML。
// 只收 AI 相关仓库（关键词过滤），external_score = 当日新增 star。

const TRENDING_URL = 'https://github.com/trending';

const AI_KEYWORDS = [
  'ai', 'llm', 'gpt', 'agent', 'ml', 'rag', 'claude', 'gemini', 'openai', 'anthropic',
  'deepseek', 'transformer', 'diffusion', 'neural', 'machine-learning', 'deep-learning',
  'langchain', 'inference', 'embedding', 'chatbot', 'copilot', 'model', 'llama',
  'fine-tun', 'prompt', 'multimodal', 'voice', 'speech', 'vision', 'mcp',
];

function isAIRelated(name, description, language) {
  const text = `${name} ${description || ''} ${language || ''}`.toLowerCase();
  // 词边界匹配，避免 'mail' 命中 'ai' 这类误判
  return AI_KEYWORDS.some(kw =>
    new RegExp(`(^|[^a-z])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)
  );
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

// 解析 trending 页面：每个 <article class="Box-row"> 一个仓库
export function parseTrendingHtml(html) {
  const repos = [];
  const articles = html.split(/<article class="Box-row[^"]*"/).slice(1);

  for (const block of articles) {
    // 仓库链接必须从 <h2> 标题里取——block 开头可能先出现 sponsors/xxx 等无关链接
    const fullName = block.match(/<h2[^>]*>[\s\S]*?href="\/([^"\/]+\/[^"?\/]+)"/)?.[1];
    if (!fullName || fullName.startsWith('sponsors/')) continue;

    const desc = decodeEntities(
      block.match(/<p class="col-9[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/p>/)?.[1]?.replace(/<[^>]+>/g, '').trim()
    );
    const language = block.match(/itemprop="programmingLanguage">\s*([^<]+)\s*</)?.[1]?.trim() || null;
    // "1,234 stars today"
    const starsToday = parseInt(
      (block.match(/([\d,]+)\s+stars?\s+today/)?.[1] || '0').replace(/,/g, ''), 10
    );
    const starsTotal = parseInt(
      (block.match(/href="\/[^"]+\/stargazers"[^>]*>\s*(?:<[^>]+>\s*)*([\d,]+)/)?.[1] || '0').replace(/,/g, ''), 10
    );

    repos.push({ fullName, description: desc || null, language, starsToday, starsTotal });
  }
  return repos;
}

// 直连失败时自动走本地代理重试（坑2 同款：undici 不读 HTTP_PROXY 环境变量约定，
// 需显式传 ProxyAgent；GITHUB_PROXY_URL 未配置时复用 YOUTUBE_PROXY_URL）
async function fetchWithProxyFallback(url, opts) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
  } catch (err) {
    const proxyUrl = process.env.GITHUB_PROXY_URL || process.env.YOUTUBE_PROXY_URL;
    if (!proxyUrl) throw err;
    console.log(`  direct fetch failed (${err.message}), retrying via proxy...`);
    const { ProxyAgent } = await import('undici');
    return await fetch(url, {
      ...opts,
      signal: AbortSignal.timeout(20000),
      dispatcher: new ProxyAgent(proxyUrl),
    });
  }
}

export async function fetchTrendingRepos({ since = 'daily', aiOnly = true } = {}) {
  const res = await fetchWithProxyFallback(`${TRENDING_URL}?since=${since}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`GitHub trending fetch failed: HTTP ${res.status}`);

  const repos = parseTrendingHtml(await res.text());
  return aiOnly ? repos.filter(r => isAIRelated(r.fullName, r.description, r.language)) : repos;
}

// 转成统一 Content 模型（id 稳定，重复同步 upsert 更新 star 数）
export function transformTrendingRepo(repo) {
  const now = new Date().toISOString();
  const content = {
    id: `github-trending-${repo.fullName.replace('/', '-').toLowerCase()}`,
    content_type: 'repo',
    url: `https://github.com/${repo.fullName}`,
    published_at: now, // trending 是"此刻热门"，无原始发布时间

    original_lang: 'en',
    has_translation: 0,

    zh_title: null, // sync 脚本翻译后填充
    zh_summary: null,
    en_title: `${repo.fullName}${repo.description ? ' — ' + repo.description : ''}`,

    input_method: 'feed',
    source_app: 'github_trending',
    fetch_status: 'success',
    external_score: repo.starsToday,
    tags: JSON.stringify([repo.language, `⭐今日+${repo.starsToday}`].filter(Boolean)),

    created_at: now,
    updated_at: now,
  };
  return { content, sourceInfo: null }; // 信源池：不创建 Source 身份
}
