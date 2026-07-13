import axios from 'axios';
import * as cheerio from 'cheerio';

// 从用户输入（链接或文本）智能识别信息源类型和配置
export async function resolveSourceFromInput(input) {
  const trimmed = input.trim();

  // 1. GitHub 仓库链接
  const githubMatch = trimmed.match(/github\.com\/([\w-]+)\/([\w.-]+)/);
  if (githubMatch) {
    const [, owner, repo] = githubMatch;
    return {
      type: 'GitHub',
      handle: `${owner}/${repo}`,
      display_name: repo,
      platform_metadata: {
        owner,
        repo,
        track_releases: true,
        track_commits: false
      }
    };
  }

  // 2. 微信公众号文章链接（提取 __biz 参数作为公众号唯一标识）
  if (trimmed.includes('mp.weixin.qq.com')) {
    const bizMatch = trimmed.match(/__biz=([^&]+)/);
    if (bizMatch) {
      return {
        type: 'WeChat',
        handle: bizMatch[1],
        display_name: '微信公众号（需进一步获取名称）',
        platform_metadata: {
          biz: bizMatch[1],
          article_url: trimmed
        }
      };
    }
    return { error: '无法从微信文章链接提取公众号信息' };
  }

  // 3. Reddit 链接（subreddit 或帖子链接）
  const redditMatch = trimmed.match(/reddit\.com\/r\/([\w-]+)/);
  if (redditMatch) {
    return {
      type: 'Reddit',
      handle: redditMatch[1],
      display_name: `r/${redditMatch[1]}`,
      platform_metadata: {
        subreddit: redditMatch[1],
        sort: 'hot',
        limit: 10
      }
    };
  }

  // 4. 通用 URL（尝试自动发现 RSS feed）
  if (trimmed.match(/^https?:\/\//)) {
    try {
      const rssUrl = await discoverRSSFeed(trimmed);
      if (rssUrl) {
        // 尝试解析 RSS 获取站点名称
        const siteName = await getRSSTitle(rssUrl);
        return {
          type: 'RSS',
          handle: rssUrl,
          display_name: siteName || new URL(trimmed).hostname,
          platform_metadata: {
            feed_url: rssUrl,
            site_url: trimmed
          }
        };
      }

      // 没有 RSS，作为单篇文章处理
      return {
        type: 'RSS',
        handle: trimmed,
        display_name: new URL(trimmed).hostname,
        platform_metadata: {
          feed_url: trimmed,
          site_url: trimmed,
          is_single_article: true
        }
      };
    } catch (error) {
      return { error: `无法访问链接: ${error.message}` };
    }
  }

  // 5. 纯文本（暂不支持 AI 推理，提示用户提供具体链接）
  return { error: '请提供具体链接（博客 URL、GitHub 仓库、公众号文章等）' };
}

// 从网站 HTML 中自动发现 RSS feed URL
async function discoverRSSFeed(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 KnowledgeWorkbench/1.0' }
    });

    const $ = cheerio.load(response.data);

    // 查找 <link rel="alternate" type="application/rss+xml">
    const rssLink = $('link[type="application/rss+xml"]').attr('href')
      || $('link[type="application/atom+xml"]').attr('href');

    if (!rssLink) return null;

    // 处理相对路径
    if (rssLink.startsWith('http')) return rssLink;
    if (rssLink.startsWith('//')) return `https:${rssLink}`;
    const baseUrl = new URL(url);
    return new URL(rssLink, baseUrl.origin).href;
  } catch (error) {
    console.error('RSS 发现失败:', error.message);
    return null;
  }
}

// 获取 RSS feed 的标题
async function getRSSTitle(feedUrl) {
  try {
    const response = await axios.get(feedUrl, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 KnowledgeWorkbench/1.0' }
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    return $('channel > title').first().text() || $('feed > title').first().text() || null;
  } catch (error) {
    console.error('获取 RSS 标题失败:', error.message);
    return null;
  }
}
