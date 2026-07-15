import axios from 'axios';
import { YoutubeTranscript, YoutubeTranscriptDisabledError, YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptTooManyRequestError, YoutubeTranscriptVideoUnavailableError,
  YoutubeTranscriptNotAvailableLanguageError } from 'youtube-transcript';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

// YouTube 字幕提取需要的代理支持（可选）
// 如果配置了 YOUTUBE_PROXY_URL，youtube-transcript 会使用代理访问
// 不配置代理的话，国内环境可能无法访问 YouTube

// Mode 1 即兴分析的入口：把用户丢进来的任意输入（YouTube 链接/网页链接/纯文本）
// 归一成统一格式，供后续翻译/对话/摘要流水线使用。
// 范围（对应 docs/HANDOFF-TO-NEW-ARCHITECTURE.md §6、docs/DECISION-NOTEBOOKLM-APPROACH.md）：
// - 有字幕的 YouTube：提取字幕
// - 无字幕的 YouTube：Phase 1 不做 Whisper 后备，直接返回失败状态，前端据此提示用户
// - 静态 HTML 网页：readability 提取正文
// - 动态渲染网页（SPA）：readability 拿不到内容时同样返回失败状态，不引入 Puppeteer
// - 纯文本：直接透传
//
// 代理说明：youtube.com 在国内网络环境下需要代理才能连通，且 Node.js 内置 fetch（undici）
// 不会自动读取 HTTP_PROXY/HTTPS_PROXY 环境变量（这是本地开发环境实测踩过的坑：curl 走
// 代理正常返回 200，同一个环境变量对 Node fetch 完全不生效）。这里用 undici 的 ProxyAgent
// 显式注入给 youtube-transcript 库（该库支持 config.fetch 自定义），只影响这一个请求，
// 不用 setGlobalDispatcher 污染整个进程（避免连 AI HOT / 本地 SQLite 等不需要代理的请求）。
// 通过 YOUTUBE_PROXY_URL 环境变量配置，未设置时按无代理直连（生产环境部署在海外服务器时
// 不需要代理，不应强制要求）。youtube-transcript@1.3.1 支持 config.fetch 自定义。

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'm.youtube.com'];

function detectInputType(input) {
  const trimmed = input.trim();

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return 'text';
  }

  const isYoutube = YOUTUBE_HOSTS.some(host => url.hostname.includes(host));
  return isYoutube ? 'youtube' : 'url';
}

function extractYoutubeVideoId(input) {
  const url = new URL(input.trim());
  if (url.hostname.includes('youtu.be')) {
    return url.pathname.slice(1);
  }
  return url.searchParams.get('v');
}

async function ingestYoutube(input) {
  const videoId = extractYoutubeVideoId(input);
  if (!videoId) {
    return {
      title: null,
      body: null,
      type: 'youtube',
      fetchStatus: 'failed',
      fetchError: '无法从链接中解析出视频 ID'
    };
  }

  // 国内环境走本地代理访问 YouTube（undici 不读 HTTP_PROXY 环境变量约定，必须显式注入）
  let proxyFetch;
  const proxyUrl = process.env.YOUTUBE_PROXY_URL;
  if (proxyUrl) {
    const { ProxyAgent } = await import('undici');
    const dispatcher = new ProxyAgent(proxyUrl);
    proxyFetch = (url, opts = {}) => fetch(url, { ...opts, dispatcher });
  }

  try {
    // 尝试提取字幕（默认中文，如无则自动回退到视频默认语言）
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, proxyFetch ? { fetch: proxyFetch } : undefined);
    const body = transcript.map(t => t.text).join(' ');

    return {
      title: null, // youtube-transcript 不返回视频标题，由调用方决定是否用 zh_title 占位
      body,
      type: 'youtube',
      transcript, // 保留带时间戳的原始片段，供 zh_chapters 分段使用（翻译流水线阶段处理）
      fetchStatus: 'success',
      fetchError: null
    };
  } catch (error) {
    return {
      title: null,
      body: null,
      type: 'youtube',
      fetchStatus: 'failed',
      fetchError: classifyYoutubeError(error)
    };
  }
}

// youtube-transcript 底层调用的是 YouTube 未公开的内部接口（逆向工程），会随 YouTube
// 改版随时失效，且已知会针对性拒绝云服务商 IP 段（AWS/GCP/Azure 等）的请求。
// 这里区分「视频确实没字幕」「网络/风控层面失败」两类原因，避免把网络问题误报成
// 「没字幕」——这两种失败对用户来说需要完全不同的应对方式。
function classifyYoutubeError(error) {
  if (error instanceof YoutubeTranscriptDisabledError) {
    return '该视频已禁用字幕功能，暂不支持自动转录，请尝试直接粘贴文字稿';
  }
  if (error instanceof YoutubeTranscriptNotAvailableError) {
    return '该视频没有可用字幕，暂不支持自动转录，请尝试直接粘贴文字稿';
  }
  if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
    return `该视频没有匹配语言的字幕（${error.message}），暂不支持自动转录`;
  }
  if (error instanceof YoutubeTranscriptVideoUnavailableError) {
    return '视频不存在或已被删除/设为私享';
  }
  if (error instanceof YoutubeTranscriptTooManyRequestError) {
    return 'YouTube 判定当前请求过于频繁并要求验证码，暂时无法获取字幕，请稍后重试';
  }
  // 未归类的失败（网络不通、DNS 失败、YouTube 内部接口变更等），如实报告底层错误，
  // 不要猜测原因——上面几类是库自己能识别的，猜不到的就不要编一个"可能是没字幕"。
  return `获取字幕时发生未分类错误：${error.message}。这可能是网络无法访问 YouTube，也可能是该库依赖的 YouTube 内部接口发生变化，请尝试直接粘贴文字稿`;
}

// Jina Reader 兜底（RESEARCH-PIPELINE-EXTENSIONS.md §二 / ADR-013）：readability 抓不到
// （SPA/反爬/公众号单篇）时重试 r.jina.ai。只读、合规、免 key；免费档限 20 RPM，
// 单用户产品够用。返回体是带元数据头的纯文本：
//   Title: xxx / URL Source: xxx / Markdown Content:\n<正文>
async function fetchViaJina(url) {
  const response = await axios.get(`https://r.jina.ai/${url}`, {
    timeout: 15000, // 与 content-body-resolver 的 FETCH_TIMEOUT_MS 对齐，Jina 渲染慢于直抓
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });

  const raw = String(response.data || '');

  // Jina 会把上游错误（403/404 等）包装成 200 返回，靠元数据头里的 Warning 行识别
  const upstreamError = raw.match(/^Warning:\s*Target URL returned error (\d+.*)$/m)?.[1];
  if (upstreamError) {
    throw new Error(`目标站点对 Jina Reader 返回 ${upstreamError.trim()}`);
  }

  // 注意 [ \t] 不能写 \s：\s 会匹配换行，标题为空时会吞掉换行误抓下一行元数据
  const title = raw.match(/^Title:[ \t]*(.+)$/m)?.[1]?.trim() || null;
  const marker = raw.indexOf('Markdown Content:');
  const body = (marker >= 0 ? raw.slice(marker + 'Markdown Content:'.length) : raw).trim();

  // 门槛 300 字：验证页/占位页（如微信"Parameter error"页 ~100 字样板文案）会伪装成
  // 成功返回，真实文章正文极少短于此；宁可如实失败也不把垃圾喂给翻译/解读
  if (body.length < 300) {
    throw new Error('Jina Reader 也未提取到有效正文（疑似验证页/占位页）');
  }
  return { title, body };
}

export async function ingestUrl(input) {
  const url = input.trim();
  let directError; // 直抓失败原因，Jina 也失败时合并报告，不掩盖第一手信息

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      maxRedirects: 5
    });

    const dom = new JSDOM(response.data, { url });
    const article = new Readability(dom.window.document).parse();

    if (article?.textContent && article.textContent.trim().length >= 50) {
      return {
        title: article.title || null,
        body: article.textContent.trim(),
        type: 'article',
        via: 'readability',
        fetchStatus: 'success',
        fetchError: null
      };
    }
    directError = '无法从该页面提取到有效正文（可能是动态渲染页面）';
  } catch (error) {
    directError = `抓取失败：${error.message}`;
  }

  // 直抓失败 → Jina Reader 兜底
  try {
    const jina = await fetchViaJina(url);
    return {
      title: jina.title,
      body: jina.body,
      type: 'article',
      via: 'jina',
      fetchStatus: 'success',
      fetchError: null
    };
  } catch (jinaError) {
    return {
      title: null,
      body: null,
      type: 'article',
      fetchStatus: 'failed',
      fetchError: `${directError}；Jina Reader 兜底同样失败（${jinaError.message}），请尝试直接粘贴文本`
    };
  }
}

function ingestText(input) {
  const body = input.trim();
  return {
    title: null,
    body,
    type: 'text',
    fetchStatus: 'success',
    fetchError: null
  };
}

// 统一入口。返回 { title, body, type, fetchStatus, fetchError, inputMethod }
export async function ingest(input) {
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return {
      title: null,
      body: null,
      type: 'text',
      fetchStatus: 'failed',
      fetchError: '输入为空',
      inputMethod: 'text_paste'
    };
  }

  const inputType = detectInputType(input);

  let result;
  switch (inputType) {
    case 'youtube':
      result = await ingestYoutube(input);
      return { ...result, inputMethod: 'url_auto' };

    case 'url':
      result = await ingestUrl(input);
      return { ...result, inputMethod: 'url_auto' };

    case 'text':
    default:
      result = ingestText(input);
      return { ...result, inputMethod: 'text_paste' };
  }
}
