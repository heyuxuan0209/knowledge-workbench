// 信源信任分层（trust tier · P1 层2，借卡兹克 AIHOT 分级思路，ADR-040）。
// 与 track_mode（抓取深度）正交：这里分的是"可信/权威"，喂给
//   - 层3 事件簇选主条：官方源 > 官方账号 > KOL/媒体
//   - 层4 今日必看理由：T1 官方一手 → 组合出"来自官方一手"这类人话理由
//
// 三档：
//   T1   官方一手：厂商/实验室官网博客、官方 RSS（Anthropic/OpenAI/Google DeepMind…）
//   T1.5 官方及员工：官方产品/公司的社交账号（含明显的官方账号）
//   T2   KOL·媒体·资讯站·个人（默认，保守）——宁可少给高信任，避免误把 KOL 当官方顶上必看
//
// 这是启发式种子（域名/名号/账号白名单），不追求完美：命中不了的一律落 T2（安全侧）；
// 后续可在信源页给用户手动改档，或随白名单补充。**不做自动学习**（卡兹克红线）。

// 官方一手域名（出现在 handle 的 feed URL / 原文域名里即判 T1）
const OFFICIAL_DOMAINS = [
  'openai.com', 'anthropic.com', 'blog.google', 'research.google', 'deepmind.google',
  'deepmind.com', 'ai.meta.com', 'ai.googleblog.com', 'huggingface.co', 'mistral.ai',
  'stability.ai', 'cohere.com', 'x.ai', 'blogs.nvidia.com', 'apple.com/newsroom',
  'databricks.com/blog', 'together.ai', 'scale.com/blog', 'runwayml.com',
  'deepseek.com', 'qwenlm.github.io', 'microsoft.com/en-us/research',
];

// 官方机构名号（仅对 Blog 类源，用 display_name / feed 文件名兜住"被代理的官方 RSS"，
// 如 raw.githubusercontent.com/…/feed_anthropic_news.xml、display_name「OpenAI News」）
const OFFICIAL_ORG_NAMES = [
  'anthropic', 'openai', 'deepmind', 'google ai', 'google research', 'google deepmind',
  'mistral', 'hugging face', 'huggingface', 'meta ai', 'cohere', 'stability ai',
];

// 官方/产品社交账号白名单（X handle，小写）——判 T1.5。个人 KOL 不在内、落 T2。
const OFFICIAL_ACCOUNTS = new Set([
  'openai', 'openaidevs', 'anthropicai', 'claudeai', 'claudedevs', 'googledeepmind',
  'googleai', 'geminiapp', 'notebooklm', 'aiatmeta', 'metaai', 'krea_ai', 'runwayml',
  'midjourney', 'stabilityai', 'huggingface', 'mistralai', 'cohere', 'xai', 'grok',
  'perplexity_ai', 'nvidiaai', 'databricks', 'groqinc', 'together_ai', 'scale_ai',
  'deepseek_ai', 'alibaba_qwen', 'qwen', 'kling_ai',
]);

const norm = (s) => String(s || '').trim().toLowerCase().replace(/^@/, '');

// { sourceType, platform, handle, displayName } → 'T1' | 'T1.5' | 'T2'
export function classifyTrustTier({ sourceType = '', platform = '', handle = '', displayName = '' } = {}) {
  const h = norm(handle);
  const hay = `${h} ${norm(displayName)}`;

  // T1：官网/官方一手（域名命中，或 Blog 类且名号命中官方机构）
  if (OFFICIAL_DOMAINS.some(d => h.includes(d))) return 'T1';
  if (String(sourceType).toLowerCase() === 'blog' && OFFICIAL_ORG_NAMES.some(n => hay.includes(n))) return 'T1';

  // T1.5：官方/产品社交账号（handle 命中白名单，不限平台但主要是 X）
  if (OFFICIAL_ACCOUNTS.has(h)) return 'T1.5';

  // 默认 T2：KOL / 媒体 / 资讯站 / 个人
  return 'T2';
}

export const TRUST_TIERS = ['T1', 'T1.5', 'T2'];
// 事件簇选主条用的权威序（越小越权威）
export const TRUST_RANK = { T1: 0, 'T1.5': 1, T2: 2 };
