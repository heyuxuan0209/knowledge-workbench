import { createHash, createHmac } from 'crypto';
import { getIngestCache, getIngestSource, setIngestSource } from '../db/ingest-cache.js';
import { getVideoDelivery, saveVideoDelivery } from '../db/video-delivery.js';
import { createDocFromMarkdown, updateDocFromMarkdown } from './feishu-docs.js';
import { buildLongVideoChunks, detectLanguage, translateText } from './translation.js';
import { ingest } from './content-ingestion.js';

const VIDEO_TYPES = new Set(['youtube', 'video']);
// 长视频全文中译是按需交付；12k/段把 3.5h 字幕控制在约 18 次 Flash 调用，
// 而不是通用翻译的 3k/段约 72 次。每段仍低于 DeepSeek 上下文与输出上限。
const DELIVERY_TRANSLATION_CHUNK = 12000;
const DELIVERY_TRANSLATION_CONCURRENCY = 3;

const sha256 = (value) => createHash('sha256').update(String(value || '')).digest('hex');

function formatClock(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const seconds = Math.round(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function mapConcurrent(items, limit, worker) {
  const result = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      result[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return result;
}

export function isVideoDigest(data = {}) {
  return VIDEO_TYPES.has(data.type)
    || /YouTube|B站视频/i.test(data.metadata?.platform || '');
}

function safeUrl(raw, label) {
  let url;
  try { url = new URL(String(raw || '')); } catch { throw new Error(`${label}不是有效 URL`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label}只支持 http/https`);
  return url.toString();
}

function toLarkMd(markdown, title = '') {
  const out = [];
  let quote = [];
  const norm = (s) => s.replace(/[\s：:·　]/g, '');
  let dropH1 = Boolean(title);
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(quote.length === 1 && quote[0].includes('|') ? quote[0] : `「${quote.join('\n')}」`);
    quote = [];
  };
  for (const raw of String(markdown || '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) { if (q[1].trim()) quote.push(q[1].trim()); else flushQuote(); continue; }
    flushQuote();
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      const text = h[2].trim();
      if (dropH1 && h[1] === '#') {
        dropH1 = false;
        if (norm(text).startsWith(norm(title)) || norm(title).startsWith(norm(text))) continue;
      }
      out.push(`**${text}**`);
      continue;
    }
    const li = line.match(/^\s*[-*+]\s+(.*)$/);
    if (li) { out.push(`• ${li[1]}`); continue; }
    const section = line.match(/^\s*(【[^】]{1,16}】)\s*$/);
    if (section) { out.push(`**${section[1]}**`); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push(''); continue; }
    out.push(line);
  }
  flushQuote();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}\n\n…（卡片已截断，完整内容见飞书文档）`;
}

export function buildVideoCard({ title, interpretation, sourceUrl, docUrl, outline = [], warning = null,
  hasFullTranslation = true }) {
  const source = safeUrl(sourceUrl, '原视频链接');
  const doc = safeUrl(docUrl, '完整解读链接');
  const elements = [{
    tag: 'div',
    text: { tag: 'lark_md', content: clip(toLarkMd(interpretation, title), 8000) },
  }];
  if (outline.length) {
    const shown = outline.slice(0, 12);
    const more = outline.length - shown.length;
    elements.push(
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content:
        `**讲述脉络**（共 ${outline.length} 节）\n${shown.map(item => `• ${item}`).join('\n')}`
        + (more > 0 ? `\n• …另 ${more} 节` : '') } },
    );
  }
  elements.push(
    { tag: 'hr' },
    { tag: 'div', text: { tag: 'lark_md', content:
      `[📄 打开完整解读（精读 + ${hasFullTranslation ? '全文中译' : '原文转写'}）](${doc})　　[🔗 看原视频](${source})` } },
  );
  if (warning) {
    elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: warning }] });
  }
  elements.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: 'KW · 视频转写可能有少量误差，引用前请回原视频核对' }],
  });
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: title.slice(0, 100) }, template: 'blue' },
      elements,
    },
  };
}

function outlineFromBody(body) {
  return [...String(body || '').matchAll(/^##\s+(.+)$/gm)].map(match => match[1].trim());
}

export function buildVideoDocument({ title, metadata = {}, sourceUrl, interpretation, deepRead, transcriptText,
  transcriptLabel, coverageNote, warning = null }) {
  const meta = [metadata.author, metadata.platform, metadata.publishedAt].filter(Boolean).join(' · ');
  return [
    `# ${title}`,
    meta ? `> ${meta}` : null,
    `> 原视频：${sourceUrl}`,
    coverageNote ? `> ${coverageNote}` : null,
    warning ? `> ⚠️ ${warning}` : null,
    '',
    '## 卡片解读',
    interpretation,
    '',
    '## 全片精读',
    deepRead,
    '',
    `## ${transcriptLabel}`,
    transcriptText,
  ].filter(value => value !== null && value !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function translateSource(source, data, deps) {
  const lang = data.originalLang || detectLanguage(source.body);
  if (lang === 'zh') return { text: source.body, status: 'source-zh', label: '转写原稿' };
  const chunks = buildLongVideoChunks({
    body: source.body,
    transcript: source.transcript,
    metadata: data.metadata || {},
  }, DELIVERY_TRANSLATION_CHUNK);
  const translated = await mapConcurrent(chunks, DELIVERY_TRANSLATION_CONCURRENCY, async (chunk, index) => {
    const start = formatClock(chunk.startSeconds);
    const end = formatClock(chunk.endSeconds);
    const heading = start && end ? `### ${start}–${end}` : `### 第 ${index + 1}/${chunks.length} 段`;
    const text = await deps.translateText(chunk.text, {
      contexts: [{ kind: 'video-delivery', id: data.metadata?.sourceUrl || null, target: `transcript_${index + 1}` }],
      maxChunkLength: DELIVERY_TRANSLATION_CHUNK,
      maxTokens: 6000,
    });
    return `${heading}\n\n${text}`;
  });
  return { text: translated.join('\n\n'), status: 'translated', label: '逐段全文中译' };
}

async function pushWebhook(card, deps) {
  const webhook = process.env.FEISHU_VIDEO_WEBHOOK || '';
  if (!webhook) throw new Error('生产环境未配 FEISHU_VIDEO_WEBHOOK，不会降级改发笔记助手');
  const body = structuredClone(card);
  const secret = process.env.FEISHU_VIDEO_WEBHOOK_SECRET || '';
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    body.timestamp = String(timestamp);
    body.sign = createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');
  }
  const response = await deps.fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (result.code === 0 || result.StatusCode === 0 || result.StatusMessage === 'success') return true;
  throw new Error(`飞书“视频解读”卡片发送失败(${result.code ?? result.StatusCode ?? response.status})：${result.msg || result.StatusMessage || '未知错误'}`);
}

export async function deliverVideoDigest({ url, title, interpretation }, overrides = {}) {
  const sourceUrl = safeUrl(url, '原视频链接');
  const deps = {
    getIngestCache, getIngestSource, setIngestSource, getVideoDelivery, saveVideoDelivery,
    createDocFromMarkdown, updateDocFromMarkdown, translateText, ingest, fetch,
    ...overrides,
  };
  let data = deps.getIngestCache(sourceUrl);
  if (!data) throw new Error('没有找到这条视频的解读缓存，请先完成解读再发送');
  if (!isVideoDigest(data)) throw new Error('当前内容不是视频，拒绝发送到“视频解读”');
  const digest = String(interpretation || data.cachedInterpretation || '').trim();
  if (!digest) throw new Error('解读内容为空，请等解读完成后再发送');

  let source = deps.getIngestSource(sourceUrl);
  if (!source?.body) {
    const recovered = await deps.ingest(sourceUrl);
    if (recovered.fetchStatus !== 'success' || !recovered.body) {
      throw new Error(`旧缓存缺完整字幕，重新抓取也失败：${recovered.fetchError || '未知原因'}`);
    }
    if (!isVideoDigest(recovered)) throw new Error('重新抓取的内容不是视频');
    source = { body: recovered.body, transcript: recovered.transcript || [] };
    deps.setIngestSource(sourceUrl, source);
    data = { ...data, sourceTruncated: recovered.sourceTruncated ?? data.sourceTruncated };
  }

  const sourceHash = sha256(source.body);
  let delivery = deps.getVideoDelivery(sourceUrl);
  let translated;
  let warning = null;
  if (delivery?.source_hash === sourceHash && delivery.translated_body) {
    translated = {
      text: delivery.translated_body,
      status: delivery.translation_status || 'translated',
      label: delivery.translation_status === 'source-zh' ? '转写原稿' : '逐段全文中译',
    };
  } else {
    try {
      translated = await translateSource(source, data, deps);
      delivery = deps.saveVideoDelivery(sourceUrl, {
        sourceHash,
        translatedBody: translated.text,
        translationStatus: translated.status,
      });
    } catch (error) {
      warning = `全文中译生成失败（${error.message}），文档已保留全片精读和原文转写。`;
      translated = { text: source.body, status: 'translation-failed', label: '原文转写（中译未完成）' };
      delivery = deps.saveVideoDelivery(sourceUrl, {
        sourceHash,
        translatedBody: '',
        translationStatus: translated.status,
      });
    }
  }

  const resolvedTitle = String(title || data.zhTitle || data.title || '视频解读').trim();
  const coverageNote = data.note || (data.coverage?.mode === 'partial-transcript-map-reduce'
    ? '本次只取得视频前段转写，不代表全片'
    : data.coverage?.sectionCount
      ? `已按时间顺序覆盖全片，共 ${data.coverage.sectionCount} 段`
      : null);
  const markdown = buildVideoDocument({
    title: resolvedTitle,
    metadata: data.metadata,
    sourceUrl,
    interpretation: digest,
    deepRead: data.zhBody || digest,
    transcriptText: translated.text,
    transcriptLabel: translated.label,
    coverageNote,
    warning,
  });
  const documentHash = sha256(markdown);

  let docUrl = delivery?.doc_url || null;
  let docToken = delivery?.doc_token || null;
  const hadDocument = Boolean(docToken && docUrl);
  let reusedDocument = hadDocument;
  if (docToken && docUrl) {
    if (delivery.document_hash !== documentHash) {
      await deps.updateDocFromMarkdown({ documentId: docToken, markdown });
      delivery = deps.saveVideoDelivery(sourceUrl, { documentHash });
      reusedDocument = false;
    }
  } else {
    const doc = await deps.createDocFromMarkdown({
      title: resolvedTitle.slice(0, 60),
      markdown,
      destination: 'drive',
    });
    docUrl = doc.url;
    docToken = doc.token;
    delivery = deps.saveVideoDelivery(sourceUrl, { docUrl, docToken, documentHash });
  }

  const outline = outlineFromBody(data.zhBody);
  const card = buildVideoCard({
    title: resolvedTitle,
    interpretation: digest,
    sourceUrl,
    docUrl,
    outline,
    warning,
    hasFullTranslation: translated.status !== 'translation-failed',
  });
  await pushWebhook(card, deps);
  return {
    target: 'video',
    docUrl,
    cardSent: true,
    translationStatus: translated.status,
    reusedDocument,
  };
}
