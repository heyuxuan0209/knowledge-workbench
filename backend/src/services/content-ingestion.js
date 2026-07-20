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

// 导出给 content-body-resolver 复用：平台路由表只此一份（2026-07-16 教训：
// resolver 曾自带一套 URL 判断，与这里漂移——收口认识小宇宙、resolver 不认识，
// 导致 Feed 精读/读全文对播客全军覆没）。新增平台只改这里。
export function detectInputType(input) {
  const trimmed = input.trim();

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return 'text';
  }

  // AI HOT 收录页（aihot.virxact.com/items/<id>）是客户端渲染 SPA，裸 HTML 只有空壳（约 900 字节），
  // Readability 抓不到、Jina 渲染又超时。但这条我们**同步时早已入库**——识别出来直接从本地库取，
  // 不再去抓那个 SPA（也避免底层是推文/X 链接时的二次抓取失败）。
  if (url.hostname.includes('aihot.virxact.com') && /\/items\/[a-z0-9]+/i.test(url.pathname)) return 'aihot';
  // X/推特 直链：需登录态才能抓取（本产品未接入，ADR-014 后置）。识别出来 → 若库里已有(AI HOT 收录过)
  // 直接从库解读，否则秒回清晰提示，不再白等 25s Jina。
  if (/(^|\.)(x|twitter)\.com$/.test(url.hostname)) return 'x';
  // 微信公众号文章：正文**在裸 HTML 里**（#js_content，本例 2713 字），但通用 Readability 只抽到 7 字
  // ——它读不懂公众号的 markup。识别出来直接抽 #js_content。（区别于 ADR-007 的"关注公众号源不抓取"：
  // 那是自动追更的策略；这里是用户主动粘一篇要读，抓得到就该抓。）
  if (url.hostname.includes('mp.weixin.qq.com') && url.pathname.startsWith('/s')) return 'wechat';
  if (url.hostname.includes('xiaoyuzhoufm.com') && url.pathname.includes('/episode/')) return 'xiaoyuzhou';
  if (/bilibili\.com|b23\.tv/.test(url.hostname)) return 'bilibili'; // B站视频→转写（复用已有 ASR 下载管道）
  const isYoutube = YOUTUBE_HOSTS.some(host => url.hostname.includes(host));
  return isYoutube ? 'youtube' : 'url';
}

// B站视频（UI 改造：此前 B站链接当普通网页抓，拿不到视频内容）：
// 复用 asr.transcribeVideo（bili-cli 免登录下载音频 + 本地转写）。默认 15 分钟上限（视频口播够用）。
// AI HOT 收录页 → 从本地库解读（不抓 SPA）。复用 resolveContentBody（"AI 精读"同款管道）：
// 推文取摘要（推文≈全文）、文章抓全文、视频转写——同化引擎/解读都走它，一致。
// 动态 import 避免与 content-body-resolver 的循环依赖。
async function ingestAihot(input) {
  const id = input.trim().match(/aihot\.virxact\.com\/items\/([a-z0-9]+)/i)?.[1];
  const { getContentById } = await import('../db/contents.js');
  const c = id ? getContentById(id) : null;
  if (!c) {
    return {
      title: null, body: null, type: 'article', fetchStatus: 'failed',
      fetchError: '这是 AI HOT 的收录页（动态渲染，抓不到正文）。该条不在你的本地库——请到「资讯」页找到它点「AI 精读」，或直接粘贴原文文字。',
    };
  }
  try {
    const { resolveContentBody } = await import('./content-body-resolver.js');
    const resolved = await resolveContentBody(c);
    const body = (resolved.body || '').trim();
    if (body.length < 20) {
      return {
        title: c.zh_title || c.en_title || null, body: null, type: c.content_type || 'article',
        fetchStatus: 'failed',
        fetchError: `这条 AI HOT 条目（${c.content_type === 'tweet' ? '推文' : '内容'}）暂无可解读的正文/摘要，请打开原文：${c.url || '（无原文链接）'}`,
      };
    }
    return {
      title: c.zh_title || c.en_title || null,
      body,
      type: c.content_type || 'article',
      via: 'aihot-db',
      metadata: {
        originalTitle: c.en_title || null,
        author: c.source_display_name || null,
        platform: 'AI HOT',
        publishedAt: (c.published_at || '').slice(0, 10) || null,
        sourceUrl: c.url || null, // 溯源回链到真实来源（推文/文章原文）
      },
      note: resolved.note || (c.content_type === 'tweet' ? '来源是一条推文，摘要≈全文' : null),
      fetchStatus: 'success', fetchError: null,
    };
  } catch (err) {
    return {
      title: c.zh_title || c.en_title || null, body: null, type: c.content_type || 'article',
      fetchStatus: 'failed', fetchError: `从本地库解读失败：${err.message}`,
    };
  }
}

// X/推特 直链：先查"是不是我已经有了"（AI HOT 常已收录该推文）——命中就走本地解读（同 aihot）；
// 没命中 → 立即给清晰提示（X 需登录抓取，粘推文文字最快），不再空等 25s。
async function ingestX(input) {
  const statusId = input.trim().match(/status(?:es)?\/(\d+)/)?.[1];
  const { getContentByUrlLike } = await import('../db/contents.js');
  const c = statusId ? getContentByUrlLike(statusId) : null;
  if (c) {
    try {
      const { resolveContentBody } = await import('./content-body-resolver.js');
      const body = ((await resolveContentBody(c)).body || '').trim();
      if (body.length >= 20) {
        return {
          title: c.zh_title || c.en_title || null, body, type: c.content_type || 'tweet', via: 'x-db',
          metadata: {
            originalTitle: c.en_title || null, author: c.source_display_name || null,
            platform: 'X', publishedAt: (c.published_at || '').slice(0, 10) || null, sourceUrl: c.url || input.trim(),
          },
          note: '来源是一条推文，摘要≈全文', fetchStatus: 'success', fetchError: null,
        };
      }
    } catch { /* 落到下面的提示 */ }
  }
  return {
    title: null, body: null, type: 'tweet', fetchStatus: 'failed',
    fetchError: 'X / 推特链接需要登录态才能抓取（本产品未接入）。最快：直接把推文文字粘进来；'
      + '若它在你的资讯里（AI HOT 已收录），去「资讯」页找到它点「AI 精读」。',
  };
}

// 微信公众号文章：正文在裸 HTML 的 #js_content 里，直接抽（通用 Readability 抽不出）。
// 触发反爬时公众号会返回验证/占位页（#js_content 为空）→ 给清晰提示。
async function ingestWechat(input) {
  const url = input.trim();
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      maxRedirects: 5,
    });
    const doc = new JSDOM(String(response.data || ''), { url }).window.document;
    const container = doc.querySelector('#js_content') || doc.querySelector('.rich_media_content');
    // 保段落：优先按块级子节点取文本，否则退回整体 textContent
    let body = '';
    if (container) {
      const blocks = [...container.querySelectorAll('p, section, h1, h2, h3, blockquote, li')]
        .filter(b => !b.querySelector('p, section')); // 只取叶子块，避嵌套重复
      body = (blocks.length
        ? blocks.map(b => b.textContent.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n\n')
        : container.textContent).replace(/\n{3,}/g, '\n\n').trim();
    }
    const title = (doc.querySelector('#activity-name')?.textContent
      || doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
      || doc.querySelector('.rich_media_title')?.textContent || '').trim() || null;
    const author = (doc.querySelector('#js_name')?.textContent
      || doc.querySelector('meta[name="author"]')?.getAttribute('content') || '').trim() || null;

    if (body.length >= 100) {
      return {
        title, body, type: 'article', via: 'wechat',
        metadata: { originalTitle: title, author, platform: '微信公众号', publishedAt: null, sourceUrl: url },
        fetchStatus: 'success', fetchError: null,
      };
    }
    // #js_content 空/短 = 触发了访问验证或文章已删
    return {
      title, body: null, type: 'article', fetchStatus: 'failed',
      fetchError: '公众号返回了访问验证/占位页（触发反爬或文章已删）。请在微信里打开这篇文章，复制正文粘进来。',
    };
  } catch (error) {
    return {
      title: null, body: null, type: 'article', fetchStatus: 'failed',
      fetchError: `公众号文章抓取失败：${error.message}。可在微信里打开复制正文粘进来。`,
    };
  }
}

async function ingestBilibili(input) {
  const url = input.trim();
  try {
    const { transcribeVideo } = await import('./asr.js');
    const asr = await transcribeVideo(url);
    let body = asr.text;
    if (!asr.diarized) {
      try { const { formatTranscript } = await import('./translation.js'); body = await formatTranscript(body); }
      catch { /* 保留原文 */ }
    }
    return {
      title: null, body, type: 'video', fetchStatus: 'success', fetchError: null,
      transcript: asr.segments || null,
      metadata: { originalTitle: null, author: null, platform: 'B站视频', publishedAt: null },
      note: asr.truncated ? '视频较长，已转写前 15 分钟' : null,
    };
  } catch (err) {
    return { title: null, body: null, type: 'video', fetchStatus: 'failed', fetchError: `B站视频转写失败：${err.message}` };
  }
}

// 小宇宙单集（M5，RESEARCH-PIPELINE-EXTENSIONS §M5"小宇宙音频直链"）：
// 单集页是 SSR，__NEXT_DATA__ 里有完整元数据 + m4a 直链。
// 正文 = 前 15 分钟音频本地转写（ADR-015 管道）+ 节目 shownotes（骨架），
// 转写失败降级为纯 shownotes（如实标注）。播客多为中文 → 翻译层自动跳过。
async function ingestXiaoyuzhou(input) {
  const url = input.trim();
  const fail = (msg) => ({ title: null, body: null, type: 'podcast', fetchStatus: 'failed', fetchError: msg });

  let ep;
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    const m = String(response.data).match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
    if (!m) return fail('小宇宙页面结构变化，未找到数据块（__NEXT_DATA__）');
    ep = JSON.parse(m[1])?.props?.pageProps?.episode;
    if (!ep?.title) return fail('小宇宙数据块里没有单集信息（可能是会员专享或已下架）');
  } catch (error) {
    return fail(`小宇宙页面抓取失败：${error.message}`);
  }

  const audioUrl = ep.enclosure?.url || ep.media?.source?.url || null;
  const shownotes = (ep.shownotes || ep.description || '')
    .replace(/<[^>]+>/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const metadata = {
    originalTitle: ep.title,
    author: [ep.podcast?.title, ep.podcast?.author].filter(Boolean).join(' · ') || null,
    platform: '小宇宙播客',
    publishedAt: ep.pubDate?.slice(0, 10) || null,
  };
  const durationMin = ep.duration ? Math.round(ep.duration / 60) : null;

  let transcriptPart = null;
  if (audioUrl) {
    try {
      const { transcribeAudioUrl } = await import('./asr.js');
      // 播客访谈居多 → 请求说话人分离（配了 HF_TOKEN 才生效，否则自动回落普通转写）
      const asr = await transcribeAudioUrl(audioUrl, { diarize: true });
      // 非分离的中文转写补排版（加标点分段）；分离文本已有说话人分行结构
      let asrText = asr.text;
      if (!asr.diarized && /[一-龥]/.test(asrText.slice(0, 200))) {
        const { formatTranscript } = await import('./translation.js');
        asrText = await formatTranscript(asrText);
      }
      const speakerNote = asr.diarized ? `，${asr.speakers} 位说话人已区分` : '';
      transcriptPart = `【音频转写${asr.truncated ? `（节目共 ${durationMin ?? '?'} 分钟，以下为前 15 分钟${speakerNote}，可能存在少量听写误差）` : `（${speakerNote.replace(/^，/, '') || '可能存在少量听写误差'}）`}】\n${asrText}`;
    } catch (err) {
      console.log(`[ingest] 小宇宙音频转写失败（${err.message}），降级为 shownotes`);
    }
  }

  const parts = [transcriptPart, shownotes ? `【节目 shownotes】\n${shownotes}` : null].filter(Boolean);
  if (!parts.length) return fail('该单集既无法转写音频也没有 shownotes');
  // 诚实声明（决策5）：没拿到转写时必须显式告知——否则解读层会基于 shownotes
  // 脑补出"完整内容"的假象（2026-07-16 用户实际踩到）
  if (!transcriptPart) {
    parts.unshift('【重要声明】本次未能获取音频转写，以下仅为节目 shownotes（大纲/简介），不代表节目完整内容。解读时请明确基于 shownotes 的局限性，不要推测正文细节。');
  }

  return {
    title: ep.title,
    body: parts.join('\n\n---\n\n'),
    type: 'podcast',
    metadata,
    fetchStatus: 'success',
    fetchError: null,
  };
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
    // 字幕与官方元数据并行取。元数据（标题/频道/日期）是即时分析输入管道的
    // 必备件（HANDOFF-2026-07-15）：只喂纯字幕时模型会从语音猜人名/自称无链接。
    // yt-dlp 元数据失败不阻塞字幕主流程（metadata 为 null 时材料块如实标"未知"）
    const [transcript, detail] = await Promise.all([
      YoutubeTranscript.fetchTranscript(videoId, proxyFetch ? { fetch: proxyFetch } : undefined),
      import('./active-query-channels.js').then(m => m.fetchYoutubeDetail(videoId)).catch(() => null),
    ]);
    const body = transcript.map(t => t.text).join(' ');

    return {
      title: detail?.title || null,
      body,
      type: 'youtube',
      transcript, // 保留带时间戳的原始片段，供 zh_chapters 分段使用（翻译流水线阶段处理）
      metadata: detail ? {
        originalTitle: detail.title,
        author: detail.channel,
        publishedAt: detail.publishedAt?.slice(0, 10) || null,
        platform: 'YouTube',
      } : { platform: 'YouTube' },
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
    timeout: 25000, // Jina 渲染慢于直抓；上层 resolver 的 40s 超时覆盖"直抓失败+兜底"全链
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      // 源头剔除导航/cookie 同意组件（Cookiebot 等的整段文案会被当正文抓走）
      'X-Remove-Selector': 'header, footer, nav, aside, [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i]',
    },
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
  const body = (marker >= 0 ? raw.slice(marker + 'Markdown Content:'.length) : raw)
    // Jina 的 Markdown 会带图片标记/链接/cookie 横幅等噪音，全文阅读与翻译都不需要：
    // 图片整体删除；行内链接降为纯文本（URL 对阅读是噪音、对翻译是浪费 token）；
    // 短链接列表行（导航/cookie 同意条）整行删除
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // [[#占位符#]](url)（IAB/cookie 组件）整体删除——注意双层括号会让普通链接正则失配
    .replace(/\[\[[^\]]*\]\]\([^)]*\)/g, '')
    .replace(/^\s*\*?\s*\[[^\]]{0,12}\]\([^)]*\)\s*$/gm, '')
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[#[^\]]*#\]/g, '') // [#GPC_BANNER_ICON#] 类组件占位符
    .replace(/\n{3,}/g, '\n\n')
    .trim();

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
        metadata: {
          originalTitle: article.title || null,
          author: article.byline || null,
          platform: new URL(url).hostname.replace(/^www\./, ''),
          publishedAt: article.publishedTime?.slice(0, 10) || null,
        },
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
      metadata: {
        originalTitle: jina.title || null,
        author: null,
        platform: new URL(url).hostname.replace(/^www\./, ''),
        publishedAt: null,
      },
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
    case 'aihot':
      result = await ingestAihot(input);
      return { ...result, inputMethod: 'url_auto' };

    case 'x':
      result = await ingestX(input);
      return { ...result, inputMethod: 'url_auto' };

    case 'wechat':
      result = await ingestWechat(input);
      return { ...result, inputMethod: 'url_auto' };

    case 'xiaoyuzhou':
      result = await ingestXiaoyuzhou(input);
      return { ...result, inputMethod: 'url_auto' };

    case 'youtube':
      result = await ingestYoutube(input);
      return { ...result, inputMethod: 'url_auto' };

    case 'bilibili':
      result = await ingestBilibili(input);
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
