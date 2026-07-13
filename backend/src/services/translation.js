import { chat } from './llm.js';

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

export function detectLanguage(text) {
  if (!text || text.trim().length === 0) return 'unknown';

  const chineseChars = (text.match(/[一-龥]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  if (totalChars === 0) return 'unknown';

  const chineseRatio = chineseChars / totalChars;
  return chineseRatio > 0.3 ? 'zh' : 'en';
}

// 按句子/换行边界切分长文本，避免把一句话硬切断影响翻译质量
function splitIntoChunks(text, maxLength) {
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

async function translateChunk(text) {
  const glossaryHint = Object.entries(GLOSSARY)
    .map(([en, zh]) => `${en} -> ${zh}`)
    .join('\n');

  const prompt = `将以下内容翻译成简体中文。翻译要求：
1. 保持专业术语的准确性，参考术语对照表（表中术语按对照表处理，不要按常规词义翻译）
2. 保持原文的语气和风格
3. 只返回翻译结果，不要添加任何解释、前缀或后缀

术语对照表：
${glossaryHint}

原文：
${text}

译文：`;

  const result = await chat([{ role: 'user', content: prompt }], 'deepseek');
  if (!result.success) {
    throw new Error(`翻译失败: ${result.error}`);
  }
  return result.content.trim();
}

export async function translateText(text) {
  if (!text || text.trim().length === 0) return '';

  const chunks = splitIntoChunks(text, MAX_CHUNK_LENGTH);
  const translated = [];
  for (const chunk of chunks) {
    translated.push(await translateChunk(chunk));
  }
  return translated.join('');
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

  const result = await chat([{ role: 'user', content: prompt }], 'deepseek');
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

  const [zhTitle, zhBody] = await Promise.all([
    ingested.title ? translateText(ingested.title) : Promise.resolve(null),
    translateText(ingested.body)
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
