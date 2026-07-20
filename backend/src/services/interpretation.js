import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getDatabase } from '../db/init.js';
import { getContentById } from '../db/contents.js';
import { resolveContentBody } from './content-body-resolver.js';
import { chat } from './llm.js';
import { stripPreamble } from '../util/strip-preamble.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Feed 内容的结构化精读稿（2026-07-16 用户反馈：读全文 = 精读稿而非逐字译文，
// 且要与即时分析粘贴链接看到的形式完全一致）。
// 复用同一份 instant-analysis 模板 + 同一套元数据块约定，产物缓存进
// contents.interpretation（设计文档 §四 预留字段），首次生成后秒开。

export function loadInstantAnalysisPrompt() {
  const raw = readFileSync(join(__dirname, '../../../reference/prompts/instant-analysis.md'), 'utf-8');
  return raw.replace(/<运行时注入：([^>]+)>/g, '$1');
}

// GitHub 仓库用产品视角速览模板（2026-07-16 反馈 #4：README 翻译对产品人无用，
// 要回答"对我产品的启发/值不值得写"）。同款文件外置约定，改文件即改行为
export function loadRepoQuickscanPrompt() {
  const raw = readFileSync(join(__dirname, '../../../reference/prompts/repo-quickscan.md'), 'utf-8');
  return raw.replace(/<运行时注入：([^>]+)>/g, '$1');
}

export async function getOrGenerateInterpretation(contentId, { force = false, full = false } = {}) {
  const content = getContentById(contentId);
  if (!content) throw new Error('Content not found');
  if (!force && content.interpretation) {
    return { text: content.interpretation, cached: true, note: content.interpretation_note || null, truncated: !!content.interpretation_truncated };
  }

  // 全文获取（字幕优先 / ASR 兜底 + 翻译 + zh_body 缓存）；full=true 时绕过缓存转全程
  const { body, isFullText, note, truncated } = await resolveContentBody(content, { full });
  if (!body || body.length < 100) {
    throw new Error(`未获取到足够正文（${note || '内容过短'}），无法生成精读稿`);
  }

  // 与 ephemeral-chat 同款元数据块约定：模型必须知道标题/作者/链接/日期，
  // 缺失如实标"未知"；降级材料必须声明，防止精读稿脑补
  const material = [
    '【元数据】',
    `- 原题：${content.en_title || content.zh_title || '未知'}`,
    `- 作者/演讲者：${content.source_display_name || '未知（正文中的人名可能是自动字幕的误听，请谨慎对待）'}`,
    `- 平台/场合：${content.source_platform || content.source_app || '未知'}`,
    `- 链接：${content.url || '无'}`,
    `- 日期：${content.published_at?.slice(0, 10) || '未知'}`,
    note ? `⚠️ ${note}` : null,
    '【正文/字幕】',
    body,
  ].filter(Boolean).join('\n');

  const isRepo = content.content_type === 'repo' || content.source_app === 'github_trending';
  const prompt = `${material}\n\n---\n\n${isRepo ? loadRepoQuickscanPrompt() : loadInstantAnalysisPrompt()}`;
  const result = await chat([{ role: 'user', content: prompt }]);
  if (!result.success) throw new Error(`LLM 调用失败: ${result.error}`);

  const text = stripPreamble(result.content);
  const db = getDatabase();
  db.prepare("UPDATE contents SET interpretation = ?, interpretation_note = ?, interpretation_truncated = ?, updated_at = datetime('now') WHERE id = ?")
    .run(text, note || null, truncated ? 1 : 0, contentId);
  db.close();

  console.log(`✅ Interpretation generated for ${contentId} (${text.length} chars, ¥${result.cost?.toFixed(4)}${isFullText ? '' : '，基于降级材料'}${truncated ? '，⚠️ 仅前段' : ''})`);
  return { text, cached: false, note, truncated: !!truncated };
}
