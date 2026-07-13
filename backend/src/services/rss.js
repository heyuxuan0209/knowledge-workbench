import axios from 'axios';
import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import { detectContentType } from './source-identity.js';

const USER_AGENT = 'Mozilla/5.0 KnowledgeWorkbench/1.0';

// RSS 2.0 (<channel><item>) 和 Atom (<feed><entry>) 字段名完全不同，统一解析成同一个中间结构，
// 下游 transformRSSItem() 不需要关心源 feed 是哪种格式。
function stripHtml(html) {
  if (!html) return '';
  return cheerio.load(html).text().trim();
}

export async function fetchFeedItems(feedUrl, limit = 20) {
  const response = await axios.get(feedUrl, {
    timeout: 10000,
    headers: { 'User-Agent': USER_AGENT }
  });

  const $ = cheerio.load(response.data, { xmlMode: true });
  const isAtom = $('feed').length > 0;
  const nodes = isAtom ? $('feed > entry') : $('channel > item');

  const items = [];
  nodes.slice(0, limit).each((_, el) => {
    const node = $(el);

    const link = isAtom
      ? node.find('link[rel="alternate"]').attr('href') || node.find('link').first().attr('href')
      : node.find('link').first().text().trim();

    if (!link) return; // 没有外链的条目无法归一到 Content.url，跳过

    const title = node.find('title').first().text().trim();
    const publishedAt = isAtom
      ? node.find('published').first().text() || node.find('updated').first().text()
      : node.find('pubDate').first().text();

    // content:encoded 是命名空间标签，CSS 选择器里冒号要转义，否则被解析成伪类
    const rawDescription = isAtom
      ? node.find('summary').first().text() || node.find('content').first().text()
      : node.find('content\\:encoded').first().text() || node.find('description').first().text();

    const guid = isAtom
      ? node.find('id').first().text() || link
      : node.find('guid').first().text() || link;

    items.push({
      title,
      link,
      publishedAt,
      description: stripHtml(rawDescription),
      guid
    });
  });

  return items;
}

// 用 guid/link 的 hash 做稳定 id，同一篇文章重复同步时能命中 upsertContents 的 ON CONFLICT
// 而不是每次都插新行（RSS 没有像 AI HOT/HN 那样现成的数值型条目 id）。
function buildContentId(item) {
  const hash = createHash('sha1').update(item.guid || item.link).digest('hex').slice(0, 16);
  return `rss-${hash}`;
}

export function transformRSSItem(item) {
  const now = new Date().toISOString();
  const publishedAt = item.publishedAt ? new Date(item.publishedAt).toISOString() : now;
  const contentType = detectContentType(item.link);

  return {
    id: buildContentId(item),
    content_type: contentType === 'text' ? 'article' : contentType,
    url: item.link,
    published_at: publishedAt,

    // 语言检测和标题/摘要翻译在同步阶段做（见 sync-rss.js），这里只负责归一化原始字段
    original_lang: 'unknown',
    has_translation: 0,

    zh_title: null,
    zh_summary: null,
    en_title: null,

    input_method: 'feed',
    source_app: 'rss',
    fetch_status: 'success',
    external_score: 0,

    created_at: now,
    updated_at: now,

    _rawTitle: item.title,
    _rawDescription: item.description
  };
}
