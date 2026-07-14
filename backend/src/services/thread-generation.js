import { getDatabase } from '../db/init.js';
import { resolveContentBody } from './content-body-resolver.js';
import { chat } from './llm.js';

// 单篇内容 → X thread 快速生成（M2 轻量创作出口，ADR-011）。
// 完整创作台（大纲/长文/口播脚本 + Draft 落库）是 M4，这里只做"读完一篇就能发"的最短路径：
// 基于原文（复用 resolveContentBody 的抓取/降级策略）生成钩子+分条+结尾，直接返回不落库。

const THREAD_PROMPT = `你是一位在 X（Twitter）上有影响力的 AI 领域博主，中文写作。
基于以下材料写一条 thread（4-7 条推文）。

要求：
- 第 1 条是钩子：制造好奇缺口或反直觉观点，不超过 60 字，禁止"今天聊聊""分享一篇"这类开场
- 中间每条讲一个独立的点，口语化、短句、有信息密度；适当用数字/对比增强说服力
- 最后一条收尾：一句总结观点 + 自然的互动引导（提问或立场邀请），不要"关注我"这种硬广
- 观点要有立场，不做纯翻译转述；如果材料里有争议点，放大它
- 每条推文不超过 260 字
- 输出 JSON（不要 markdown 代码块）：{"tweets": ["...", "..."]}`;

export async function generateThread(contentId) {
  const db = getDatabase();
  const content = db.prepare(`
    SELECT c.*, s.display_name AS source_display_name
    FROM contents c LEFT JOIN sources s ON c.source_id = s.id
    WHERE c.id = ?
  `).get(contentId);
  db.close();

  if (!content) throw new Error('Content not found');

  // 基于原文（决策5）：resolveContentBody 内部处理实时抓取/降级摘要并标注
  const { body, isFullText, note } = await resolveContentBody(content);

  const material = [
    `标题：${content.zh_title || content.en_title}`,
    content.source_display_name ? `作者：${content.source_display_name}` : null,
    `链接：${content.url || '（无）'}`,
    note ? `（注意：${note}，观点提炼需保守）` : null,
    '',
    body,
  ].filter(v => v !== null).join('\n');

  const result = await chat([
    { role: 'user', content: `${THREAD_PROMPT}\n\n# 材料\n${material.slice(0, 12000)}` },
  ]);

  if (!result.success) throw new Error(`LLM 调用失败: ${result.error}`);

  let parsed;
  try {
    const cleaned = result.content.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM 返回的不是合法 JSON: ${result.content.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed.tweets) || parsed.tweets.length === 0) {
    throw new Error('LLM 未返回 tweets 数组');
  }

  return {
    tweets: parsed.tweets,
    basedOnOriginal: isFullText,
    source: { contentId, title: content.zh_title || content.en_title, url: content.url },
    tokens: result.tokens,
    cost: result.cost,
  };
}
