import { ingestUrl } from './content-ingestion.js';
import { translateText, detectLanguage } from './translation.js';

// 从「一条已入库的 content 记录」解析出它的正文，供任何需要"读原文"的模块复用
// （即兴分析对话 ephemeral-chat.js、摘要/观点提取 content-analysis.js 均依赖这里）。
// 抽成独立模块的原因：这条"原文 vs 摘要"的处理策略是一份产品决策（见下方注释），
// 不应该被拆开在多个模块里各自实现一遍，否则未来改策略要改多处、容易遗漏。
//
// 原文 vs 摘要（2026-07-12 确立，docs/WIREFRAMES.md 核心设计原则 §7）：AI HOT 同步进来的
// contents 表只存了平台给的短摘要（article 类型实测平均 241 字），不是原文。
// - X (tweet)：摘要基本等价于原文全文（推文本身就短），且平台层面不做抓取（ADR-007 硬约束），
//   直接用摘要，不去抓 X 链接
// - article/paper/repo 且有 url：实时抓取原文（复用 content-ingestion.js 的 ingestUrl），
//   抓取成功才用原文，失败或超时则降级回摘要，且必须显式告知"无法获取原文"——不掩盖事实
const FETCHABLE_TYPES = ['article', 'paper', 'repo'];
const FETCH_TIMEOUT_MS = 15000;

async function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`超时（${ms / 1000}秒）`)), ms))
  ]);
}

// 返回 { body, isFullText, note }
// isFullText: true 表示这是真实原文，false 表示降级用了摘要（note 说明原因，成功时为 null）
export async function resolveContentBody(content) {
  if (content.content_type === 'tweet') {
    return {
      body: content.zh_summary || content.zh_body || '',
      isFullText: true,
      note: null // 推文本身就短，摘要≈全文，不算降级
    };
  }

  if (!FETCHABLE_TYPES.includes(content.content_type) || !content.url) {
    return {
      body: content.zh_body || content.zh_summary || '',
      isFullText: Boolean(content.zh_body),
      note: content.zh_body ? null : '无法获取原文（缺少可抓取的链接），以下基于平台摘要'
    };
  }

  try {
    const ingested = await withTimeout(ingestUrl(content.url), FETCH_TIMEOUT_MS);

    if (ingested.fetchStatus !== 'success') {
      return {
        body: content.zh_summary || '',
        isFullText: false,
        note: `无法获取原文（${ingested.fetchError}），以下基于平台摘要，请自行查看原文核实：${content.url}`
      };
    }

    const lang = detectLanguage(ingested.body);
    const zhBody = lang === 'zh' ? ingested.body : await translateText(ingested.body);

    return { body: zhBody, isFullText: true, note: null };
  } catch (error) {
    return {
      body: content.zh_summary || '',
      isFullText: false,
      note: `无法获取原文（${error.message}），以下基于平台摘要，请自行查看原文核实：${content.url}`
    };
  }
}
