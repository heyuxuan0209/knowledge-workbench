import { getDatabase } from '../db/init.js';
import { resolveContentBody } from './content-body-resolver.js';
import { chat } from './llm.js';
import { loadPrompt, render } from './creation-prompts.js';

// 单篇内容 → X thread 快速生成（M2 轻量创作出口，ADR-011）。
// 完整创作台（大纲/长文/口播脚本 + Draft 落库）是 M4，这里只做"读完一篇就能发"的最短路径：
// 基于原文（复用 resolveContentBody 的抓取/降级策略）生成钩子+分条+结尾，直接返回不落库。
// prompt 措辞在 reference/prompts/creation/thread-single.md（P1 文件化）。

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
    { role: 'user', content: render(loadPrompt('thread-single.md'), { material: material.slice(0, 12000) }) },
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
