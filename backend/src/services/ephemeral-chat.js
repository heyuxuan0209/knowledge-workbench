import { getContentById } from '../db/contents.js';
import { resolveContentBody } from './content-body-resolver.js';

// Mode 1 即兴分析的对话上下文构建（架构文档 §2）。无状态设计：不落库对话历史，
// 每次请求由前端把完整历史带上来（messages 数组），这里只负责给「第一条」用户消息
// 拼接材料前缀。
//
// 已知坑（HANDOFF-TO-NEW-ARCHITECTURE.md §4）：Deepseek 多轮对话里，用 system role 传
// 材料会被模型在某些情况下忽略，已验证的可靠做法是把材料拼进第一条 user message 的前缀。
// 这里延续同样的处理方式，不引入 system role。
//
// 两种材料来源，对应 WIREFRAMES.md 第1节"两种入口"：
// - contentIds: 用户在 Feed 里选中的已入库内容，读原文（resolveContentBody 负责抓取/降级）
// - adHocContent: 用户直接粘贴链接/文本时，前端已经调过 /api/content/ingest 拿到翻译结果，
//   这里直接使用，不重复摄入
//
// 原文抓取策略见 content-body-resolver.js 顶部注释（这是 content-analysis.js 共用的逻辑，
// 抽成独立模块，不在这里重复实现）。

async function formatContentAsMaterial(content, index) {
  const title = content.zh_title || content.en_title || '（无标题）';
  const sourceLine = content.source_display_name
    ? `来源：${content.source_display_name}（${content.source_platform}）`
    : '来源：未识别到具体作者';

  const { body, note } = await resolveContentBody(content);
  const noteLine = note ? `\n⚠️ ${note}` : '';
  const bodyText = body || '（无正文内容）';

  return `## 材料${index + 1}：${title}\n${sourceLine}${noteLine}\n\n${bodyText}`;
}

function formatAdHocAsMaterial(adHoc, index) {
  const title = adHoc.zhTitle || adHoc.enTitle || '（用户提供的内容）';
  const body = adHoc.zhBody || adHoc.body || '';
  return `## 材料${index + 1}：${title}\n${body}`;
}

// 构建注入材料前缀后的完整消息数组。异步：多篇 content 的原文抓取用 Promise.all 并行，
// 避免串行等待导致响应变慢（每篇最多 15 秒超时，见 FETCH_TIMEOUT_MS）。
// 沿用 server.js 里 /api/llm/chat 已有的既定模式：材料前缀注入到「当前这一轮」的最新用户
// 消息（不是固定的第一条），历史消息原样保留、不重复注入。每轮都重新拼接材料是有意为之
// 的简单方案（对应 Phase 1 的无状态设计），成本随对话轮次线性增长，Phase 2 若要优化可改为
// 服务端持久化对话+材料只注入一次。
// contentIds: string[]，adHocContents: 已翻译的 ingest+translate 结果数组，userMessages: 对话历史
export async function buildMessagesWithContext(contentIds, adHocContents, userMessages) {
  const resolvedContents = (contentIds || [])
    .map(id => getContentById(id))
    .filter(Boolean);

  // 先并行拉取所有需要抓取原文的内容，再按固定顺序编号，避免并发导致材料编号错乱
  const contentMaterials = await Promise.all(
    resolvedContents.map((content, i) => formatContentAsMaterial(content, i))
  );

  const adHocMaterials = (adHocContents || [])
    .map((adHoc, i) => formatAdHocAsMaterial(adHoc, contentMaterials.length + i));

  const materials = [...contentMaterials, ...adHocMaterials];

  if (materials.length === 0 || userMessages.length === 0) {
    // 没有材料（理论上不应发生，前端应保证至少有一项）或没有对话历史，直接透传，不强行拼接
    return userMessages;
  }

  const materialsBlock = `# 参考材料\n\n${materials.join('\n\n---\n\n')}\n\n---\n\n请基于以上材料回答我的问题。如果某条材料标注了"无法获取原文"，请在回答时告知用户这一点，不要假装已经读过原文。如果材料中没有相关信息，请明确说明，不要编造。\n\n`;

  const history = userMessages.slice(0, -1);
  const currentMessage = userMessages[userMessages.length - 1];

  return [
    ...history,
    { role: 'user', content: materialsBlock + `问题：${currentMessage.content}` }
  ];
}
