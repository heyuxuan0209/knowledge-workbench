import { chat } from './llm.js';
import { deriveVideoSourceState, isVideoContent } from './video-content.js';

// 多语言摄入流水线（架构文档 §8）。范围（Phase 1）：
// - 语言检测（简单启发式：中文字符占比）
// - 标题/正文翻译，术语表通过 prompt 注入保证一致性（不用 system role，见下方坑说明）
// - YouTube transcript 的章节分段（仅对不太长的转录做，避免过长内容分段质量差/成本高）
// - 摘要生成和观点提取不在这里做，那是 #9 content-analysis.js 的范围
//
// 成本分级说明：TECH-SURVEY-PHASE1.md 建议标题/摘要用 Deepseek、批量全文翻译用 DeepL 降成本，
// 但当前 .env 未配置 DEEPL_API_KEY，Phase 1 全部走 Deepseek（已接入、可用）。
// translateText() 保留了长文本自动分块的处理，避免超出 context window，这是唯一必须现在做的
// 成本/质量考量；DeepL 分级留到真正需要控制成本时再加，不属于「让翻译能用」的必要条件。
//
// 已知坑（HANDOFF-TO-NEW-ARCHITECTURE.md §4）：Deepseek 多轮对话里，背景材料不要用 system
// role 传，会被模型忽略。这里的翻译 prompt 全部拼进单条 user message，不使用 system role。

const GLOSSARY = {
  'Agent': 'Agent',
  'RAG': 'RAG',
  'LLM': 'LLM',
  'Embedding': '嵌入',
  'Prompt': 'Prompt',
  'Token': 'Token',
  'Fine-tuning': '微调',
  'Transformer': 'Transformer',
  'Multi-Agent': 'Multi-Agent'
};

const MAX_CHUNK_LENGTH = 3000; // 字符数，留出安全余量避免超出 context window
// 实测校正：乔布斯斯坦福演讲字幕（含时间戳）11364 字符、分段耗时 2s、成本 ¥0.0048，
// 分段质量良好（4 个章节准确对应演讲的三个故事结构）。原定 8000 是未经验证的保守估计，
// 会跳过绝大多数十几分钟的正常长度视频。调到 30000（约可覆盖 40-50 分钟的视频转录），
// 仍远低于 Deepseek 64k tokens 的 context window，成本和延迟随长度线性增长、可接受。
const MAX_TRANSCRIPT_LENGTH_FOR_SEGMENTATION = 30000;
export const LONG_VIDEO_THRESHOLD = 20000;
const LONG_VIDEO_CHUNK_LENGTH = 18000;
const LONG_VIDEO_CONCURRENCY = 3;

export function detectLanguage(text) {
  if (!text || text.trim().length === 0) return 'unknown';

  const chineseChars = (text.match(/[一-龥]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  if (totalChars === 0) return 'unknown';

  const chineseRatio = chineseChars / totalChars;
  return chineseRatio > 0.3 ? 'zh' : 'en';
}

// 按句子/换行边界切分长文本，避免把一句话硬切断影响翻译质量
export function splitIntoChunks(text, maxLength) {
  if (text.length <= maxLength) return [text];

  const sentences = text.split(/(?<=[。！？.!?\n])/);
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).length > maxLength && current.length > 0) {
      chunks.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

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

// 长视频不能再沿用“截前 2 万字”的短文策略。这里先按字幕片段边界切块，保留每块
// 的真实起止时间；yt-dlp 字幕没有结构化时间戳时，才按全文位置和视频总时长估算。
export function buildLongVideoChunks(ingested, maxLength = LONG_VIDEO_CHUNK_LENGTH) {
  const transcript = Array.isArray(ingested.transcript)
    ? ingested.transcript.filter(seg => String(seg?.text || '').trim())
    : [];
  if (transcript.length) {
    const chunks = [];
    let current = [];
    let chars = 0;
    const flush = () => {
      if (!current.length) return;
      const first = current[0];
      const last = current[current.length - 1];
      chunks.push({
        text: current.map(seg => seg.text).join(' '),
        startSeconds: Number(first.offset || 0) / 1000,
        endSeconds: (Number(last.offset || 0) + Number(last.duration || 0)) / 1000,
      });
      current = [];
      chars = 0;
    };
    for (const segment of transcript) {
      const text = String(segment.text || '').trim();
      if (current.length && chars + text.length + 1 > maxLength) flush();
      current.push({ ...segment, text });
      chars += text.length + 1;
    }
    flush();
    return chunks;
  }

  const textChunks = splitIntoChunks(ingested.body || '', maxLength);
  const duration = Number(ingested.metadata?.durationSeconds);
  const totalChars = Math.max(1, textChunks.reduce((sum, text) => sum + text.length, 0));
  let consumed = 0;
  return textChunks.map(text => {
    const startRatio = consumed / totalChars;
    consumed += text.length;
    const endRatio = consumed / totalChars;
    return {
      text,
      startSeconds: Number.isFinite(duration) ? duration * startRatio : null,
      endSeconds: Number.isFinite(duration) ? duration * endRatio : null,
    };
  });
}

async function defaultLongVideoSectionSummary(chunk, index, total, context) {
  const range = chunk.startSeconds != null && chunk.endSeconds != null
    ? `${formatClock(chunk.startSeconds)}–${formatClock(chunk.endSeconds)}`
    : `第 ${index + 1}/${total} 段`;
  const prompt = `你正在处理一条长视频的完整字幕。这是按时间顺序切出的 ${range}（共 ${total} 段中的第 ${index + 1} 段）。

请把这一段压缩成中文“内容档案”，供下一阶段据此写完整精读。要求：
1. 覆盖本段所有实质主题和明显的主题转折，不只总结开头
2. 保留关键定义、论证链、案例、步骤、数字、人物/产品名和限制条件
3. 叙事按原顺序；字幕含糊处标“存疑”，不要补充外部知识
4. 不写空泛评价，不重复任务说明；用 4–10 个有信息量的要点
5. 开头保留时间范围：## ${range}

字幕：
${chunk.text}`;
  const options = {
    maxTokens: 1400,
    purpose: 'long-video-section-summary',
    contexts: [{ ...context, target: `section_${index + 1}` }],
  };
  let result = await chat([{ role: 'user', content: prompt }], 'deepseek', 'deepseek-v4-flash', options);
  if (!result.success && !result.uncertain) {
    result = await chat([{ role: 'user', content: prompt }], 'deepseek', 'deepseek-v4-flash', {
      ...options, purpose: 'long-video-section-summary-retry', retryOf: result.receiptId,
    });
  }
  if (!result.success) throw new Error(`长视频第 ${index + 1}/${total} 段压缩失败：${result.error}`);
  return result.content.trim();
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// Map-reduce 的 map 阶段：用若干带时间范围的中文内容档案替代 20k 硬截断。
// reduce 阶段由现有“即时分析”精读 Prompt 完成，这样不会多生成一遍最终稿。
export async function summarizeLongVideo(ingested, { summarizeSection = defaultLongVideoSectionSummary } = {}) {
  const chunks = buildLongVideoChunks(ingested);
  if (!chunks.length) throw new Error('长视频字幕为空，无法生成全片覆盖摘要');
  const context = {
    kind: ingested.type || 'video',
    id: ingested.metadata?.sourceUrl || null,
    label: ingested.title || '长视频',
    url: ingested.metadata?.sourceUrl || null,
  };
  const sections = await mapWithConcurrency(chunks, LONG_VIDEO_CONCURRENCY,
    (chunk, index) => summarizeSection(chunk, index, chunks.length, context));
  const last = chunks[chunks.length - 1];
  const coverageEndSeconds = Number.isFinite(last.endSeconds) ? last.endSeconds : null;
  const coverageLabel = coverageEndSeconds != null ? `00:00–${formatClock(coverageEndSeconds)}` : '完整字幕首尾';
  const partial = deriveVideoSourceState(ingested) !== 'full';
  const coverageStatement = partial
    ? `【覆盖范围声明】原视频没有可用字幕，本次只取得 ${coverageLabel} 的音频转写；以下 ${chunks.length} 段已覆盖这部分材料，但不代表全片。`
    : `【全片覆盖说明】以下内容由完整字幕分成 ${chunks.length} 段逐段压缩，覆盖 ${coverageLabel}，不是只截取前段。最终精读必须综合所有分段。`;
  return {
    zhBody: [
      coverageStatement,
      ...sections,
    ].join('\n\n'),
    coverage: {
      mode: partial ? 'partial-transcript-map-reduce' : 'full-transcript-map-reduce',
      sectionCount: chunks.length,
      sourceChars: (ingested.body || '').length,
      coverageEndSeconds,
    },
  };
}

async function translateChunk(text, { background = false, contexts = [], maxTokens = 1500 } = {}) {
  const glossaryHint = Object.entries(GLOSSARY)
    .map(([en, zh]) => `${en} -> ${zh}`)
    .join('\n');

  const prompt = `将以下内容翻译成简体中文。翻译要求：
1. 保持专业术语的准确性，参考术语对照表（表中术语按对照表处理，不要按常规词义翻译）
2. 保持原文的语气和风格；按中文表达习惯意译，行文自然，不逐词直译（标题尤其如此）
3. 只返回翻译结果，不要添加任何解释、前缀或后缀

术语对照表：
${glossaryHint}

原文：
${text}

译文：`;

  // 单次重试：翻译量大时（一次 RSS 同步几百条）偶发连接抖动，重试一次再抛
  let result = await chat([{ role: 'user', content: prompt }], 'deepseek', 'deepseek-v4-flash', {
    maxTokens, purpose: 'translation', background, contexts,
  });
  if (!result.success && !result.uncertain) {
    await new Promise(r => setTimeout(r, 800));
    result = await chat([{ role: 'user', content: prompt }], 'deepseek', 'deepseek-v4-flash', {
      maxTokens, purpose: 'translation-retry', background, retryOf: result.receiptId, contexts,
    });
  }
  if (!result.success) {
    throw new Error(`翻译失败: ${result.error}`);
  }
  return result.content.trim();
}

export async function translateText(text, {
  background = false,
  contexts = [],
  maxChunkLength = MAX_CHUNK_LENGTH,
  maxTokens = 1500,
} = {}) {
  if (!text || text.trim().length === 0) return '';

  const chunks = splitIntoChunks(text, maxChunkLength);
  const translated = [];
  for (const chunk of chunks) {
    translated.push(await translateChunk(chunk, { background, contexts, maxTokens }));
  }
  return translated.join('');
}

// ASR 转写排版（2026-07-16 用户反馈：B站等转写无标点难读）：加标点、按语义分段，
// 严禁增删改字词（同音字听写错误保留原样，由解读层按上下文理解）。
// 分块处理，失败返回原文不阻塞。
export async function formatTranscript(text, { contexts = [] } = {}) {
  if (!text || text.trim().length === 0) return text;
  const chunks = splitIntoChunks(text, MAX_CHUNK_LENGTH);
  const formatted = [];
  for (const chunk of chunks) {
    try {
      const result = await chat([{
        role: 'user',
        content: `为下面的语音转写文本添加标点符号并按语义分段（空行分隔段落）。硬约束：不得增加、删除或改动任何字词——包括明显的同音字错误也保留原样；只输出排版后的文本。\n\n${chunk}`,
      }], 'deepseek', null, { purpose: 'transcript-formatting', contexts });
      formatted.push(result.success ? result.content.trim() : chunk);
    } catch {
      formatted.push(chunk);
    }
  }
  return formatted.join('\n\n');
}

// 仅用于 YouTube transcript：按时间戳将原始转录分成若干逻辑章节，标题译成中文。
// 过长的 transcript（>8000 字符）直接跳过，返回空数组——Phase 1 不追求处理任意长度视频，
// 分段质量随文本变长而下降，与其做差不如先不做。
export async function segmentTranscript(transcript) {
  if (!transcript || transcript.length === 0) return [];

  const fullText = transcript.map(t => `[${Math.floor(t.offset / 1000)}s] ${t.text}`).join('\n');

  if (fullText.length > MAX_TRANSCRIPT_LENGTH_FOR_SEGMENTATION) {
    return [];
  }

  const prompt = `根据以下视频字幕（带时间戳，单位秒），将其分为 3-6 个逻辑章节，每章标题用简洁的中文概括核心内容。

字幕内容：
${fullText}

只返回 JSON 数组，不要有任何其他文字或代码块标记：
[{"title": "章节标题", "startTime": 0, "endTime": 120}]`;

  const result = await chat([{ role: 'user', content: prompt }], 'deepseek', 'deepseek-v4-flash', { maxTokens: 2000, purpose: 'transcript-segmentation' });
  if (!result.success) return [];

  try {
    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]);
  } catch {
    // LLM 偶尔返回格式不规范的 JSON，分段失败不应阻断整条流水线，静默降级为空章节
    return [];
  }
}

// 统一入口：接收 content-ingestion.js 的输出，产出翻译后的多语言字段。
// 输入 ingested: { title, body, type, transcript?, fetchStatus, fetchError }
// 输出: { originalLang, hasTranslation, zhTitle, zhBody, zhChapters, enTitle, enBody }
export async function translateContent(ingested) {
  if (ingested.fetchStatus !== 'success' || !ingested.body) {
    return {
      originalLang: 'unknown',
      hasTranslation: false,
      zhTitle: null,
      zhBody: null,
      zhChapters: [],
      enTitle: null,
      enBody: null
    };
  }

  const lang = detectLanguage(ingested.body);

  if (isVideoContent(ingested, ingested.metadata?.sourceUrl) && ingested.body.length > LONG_VIDEO_THRESHOLD) {
    const context = {
      kind: ingested.type || 'video', id: ingested.metadata?.sourceUrl || null,
      label: ingested.title || '长视频', url: ingested.metadata?.sourceUrl || null,
    };
    const [{ zhBody, coverage }, zhTitle] = await Promise.all([
      summarizeLongVideo(ingested),
      lang === 'zh' || !ingested.title
        ? Promise.resolve(ingested.title || null)
        : translateText(ingested.title, { contexts: [{ ...context, target: 'zh_title' }] }),
    ]);
    return {
      originalLang: lang,
      hasTranslation: lang !== 'zh',
      zhTitle,
      zhBody,
      zhChapters: [],
      enTitle: lang === 'zh' ? null : (ingested.title || null),
      enBody: null,
      coverage,
    };
  }

  if (lang === 'zh') {
    return {
      originalLang: 'zh',
      hasTranslation: false,
      zhTitle: ingested.title || null,
      zhBody: ingested.body,
      zhChapters: [],
      enTitle: null,
      enBody: null
    };
  }

  const context = {
    kind: ingested.type || 'content',
    id: ingested.metadata?.sourceUrl || null,
    label: ingested.title || '用户导入内容',
    url: ingested.metadata?.sourceUrl || null,
  };
  const [zhTitle, zhBody] = await Promise.all([
    ingested.title ? translateText(ingested.title, { contexts: [{ ...context, target: 'zh_title' }] }) : Promise.resolve(null),
    translateText(ingested.body, { contexts: [{ ...context, target: 'zh_body' }] })
  ]);

  let zhChapters = [];
  if (ingested.type === 'youtube' && ingested.transcript) {
    zhChapters = await segmentTranscript(ingested.transcript);
  }

  return {
    originalLang: lang,
    hasTranslation: true,
    zhTitle,
    zhBody,
    zhChapters,
    enTitle: ingested.title || null,
    enBody: ingested.body
  };
}
