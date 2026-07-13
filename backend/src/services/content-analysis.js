import { chat } from './llm.js';
import { resolveContentBody } from './content-body-resolver.js';

// 单篇内容的摘要生成 + 观点提取（架构文档 §4 ai.perspectives 字段的数据来源）。
// Phase 1 范围：只做单篇内容级别的分析，不做跨内容的 Topic 聚合（那是 Phase 3 的
// Topic.perspectives，需要先有 Topic 归类能力才能做，见 SYNTHESIZED-ARCHITECTURE.md §5.2/§6）。
//
// 基于原文而非摘要：复用 content-body-resolver.js 的抓取/降级逻辑（与即兴分析对话
// ephemeral-chat.js 共用同一套策略，见该文件顶部注释），摘要/观点提取同样需要基于真实
// 原文，不能用平台给的短摘要顶替——否则"生成摘要"变成"复述别人的摘要"，没有信息增量。
//
// 引用溯源：Phase 1 用简化版（要求模型在观点陈述里标注 [1][2] 编号对应原文段落大致位置），
// 不做 Embedding 精确匹配到原文片段（那是 Phase 2，见 DECISION-NOTEBOOKLM-APPROACH.md）。

function buildContentBlock(title, body, note) {
  const noteLine = note ? `\n⚠️ ${note}` : '';
  return `标题：${title}${noteLine}\n\n正文：\n${body}`;
}

// 生成 3-5 段摘要。返回 { summary, isFullText, note }
// isFullText/note 原样透传 resolveContentBody 的结果，调用方可借此判断这份摘要是否
// 基于真实原文生成（例如 Feed 卡片展示"推荐理由"时应该标注清楚依据）。
export async function generateSummary(content) {
  const { body, isFullText, note } = await resolveContentBody(content);
  const title = content.zh_title || content.en_title || '（无标题）';

  if (!body) {
    return { summary: null, isFullText: false, note: note || '无可用正文内容' };
  }

  const prompt = `请为以下内容生成一份简洁的中文摘要，要求：
1. 3-5 段，每段一个要点，不要写成一整段
2. 只陈述内容中明确提到的信息，不要添加你自己的推测或背景知识
3. 如果原文包含具体数字、引言、案例，优先保留这些细节而非泛泛而谈
4. 直接输出摘要正文，不要有"以下是摘要"之类的开头

${buildContentBlock(title, body, note)}`;

  const result = await chat([{ role: 'user', content: prompt }], 'deepseek');
  if (!result.success) {
    throw new Error(`摘要生成失败: ${result.error}`);
  }

  return { summary: result.content.trim(), isFullText, note };
}

// 提取内容中的核心观点（架构文档 §4 ai.perspectives: [{ sourceRef, stance, points: [] }]）。
// 返回单个 perspective 对象（sourceRef 用 content.id，因为这是单篇内容级别的提取，
// 不是跨内容聚合）；如果内容本身不含明确立场（如纯新闻通报），points 可能为空数组。
export async function extractPerspectives(content) {
  const { body, isFullText, note } = await resolveContentBody(content);
  const title = content.zh_title || content.en_title || '（无标题）';

  if (!body) {
    return {
      sourceRef: content.id,
      stance: null,
      points: [],
      isFullText: false,
      note: note || '无可用正文内容'
    };
  }

  const prompt = `分析以下内容，提取其中表达的核心观点和立场。要求：
1. stance：用一个短语概括整体立场/态度（如"支持""质疑""中立陈述事实""警示风险"），如果内容只是客观陈述没有明显立场，填"中立陈述事实"
2. points：列出 2-5 条具体论点，每条包含 statement（观点陈述）和 evidence（原文中支撑这个观点的具体依据，引用原文的具体说法或数字，不要泛泛而谈）
3. 只提取内容中明确表达的观点，不要推测作者没说的话
4. 如果内容中没有任何值得提取的观点（纯粹是事实通报），points 返回空数组

${buildContentBlock(title, body, note)}

只返回 JSON，不要有任何其他文字或代码块标记：
{"stance": "...", "points": [{"statement": "...", "evidence": "..."}]}`;

  const result = await chat([{ role: 'user', content: prompt }], 'deepseek');
  if (!result.success) {
    throw new Error(`观点提取失败: ${result.error}`);
  }

  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('返回内容不含有效 JSON');
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      sourceRef: content.id,
      stance: parsed.stance || null,
      points: Array.isArray(parsed.points) ? parsed.points : [],
      isFullText,
      note
    };
  } catch (error) {
    // LLM 偶尔返回格式不规范的 JSON，不静默吞掉——摘要可以降级为空，但观点提取失败
    // 应该让调用方知道，因为这直接影响 Feed 卡片"推荐理由"的可用性
    throw new Error(`观点提取结果解析失败: ${error.message}`);
  }
}
