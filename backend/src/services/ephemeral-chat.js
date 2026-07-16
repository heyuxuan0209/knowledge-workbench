import { getContentById } from '../db/contents.js';
import { getDatabase } from '../db/init.js';
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

// 元数据块（HANDOFF-2026-07-15 即时分析管道修复）：喂给模型的材料必须带
// 标题/作者/平台/链接/日期，不能只有字幕/正文纯文本——只喂纯字幕时模型会从
// 语音猜人名（曾把 Thariq Shihipar 误作 "Tarik Shaupar"）、声称"没有可验证链接"。
// 字段缺失时如实写"未知"，让模型知道"没有"而不是自行脑补。
function metadataBlock({ originalTitle, author, platform, url, publishedAt }) {
  return [
    '【元数据】',
    `- 原题：${originalTitle || '未知'}`,
    `- 作者/演讲者：${author || '未知（正文中的人名可能是自动字幕的误听，请谨慎对待）'}`,
    `- 平台/场合：${platform || '未知'}`,
    `- 链接：${url || '无'}`,
    `- 日期：${publishedAt || '未知'}`,
  ].join('\n');
}

async function formatContentAsMaterial(content, index) {
  const title = content.zh_title || content.en_title || '（无标题）';

  const { body, note, isFullText } = await resolveContentBody(content);
  const noteLine = note ? `\n⚠️ ${note}` : '';
  const bodyText = body || '（无正文内容）';

  const meta = metadataBlock({
    originalTitle: content.en_title || content.zh_title,
    author: content.source_display_name
      ? `${content.source_display_name}${content.source_handle ? `（${content.source_handle}）` : ''}`
      : null,
    platform: content.source_platform || content.source_app,
    url: content.url,
    publishedAt: content.published_at?.slice(0, 10),
  });

  return {
    text: `## 材料${index + 1}：${title}\n${meta}${noteLine}\n【正文/字幕】\n${bodyText}`,
    degraded: isFullText ? null : { title, reason: note || '未获取到原文' },
  };
}

function formatAdHocAsMaterial(adHoc, index) {
  const title = adHoc.zhTitle || adHoc.enTitle || '（用户提供的内容）';
  const body = adHoc.zhBody || adHoc.body || '';
  const m = adHoc.metadata || {};
  const meta = metadataBlock({
    originalTitle: m.originalTitle || adHoc.enTitle,
    author: m.author,
    platform: m.platform,
    url: adHoc.url,
    publishedAt: m.publishedAt,
  });
  return `## 材料${index + 1}：${title}\n${meta}\n【正文/字幕】\n${body}`;
}

// 主题页探讨（P0，V3 §三.4「沉淀=探讨」的入口）：以主题页综述 + 已并入素材为材料，
// 供主题详情页右栏对话使用。此前该 UI 已铺但逻辑未接（2026-07-16 前端调查确认的 bug）。
// 素材上限 12 条与 draft-generation gatherTopicMaterials 对齐；数据只读，不触发同化。
function formatTopicAsMaterial(topicId) {
  const db = getDatabase();
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId);
  if (!topic) { db.close(); return null; }

  let body;
  try { body = JSON.parse(topic.body || '{}'); } catch { body = {}; }
  const notes = db.prepare(`
    SELECT n.excerpt, n.source_title
    FROM note_topics nt JOIN notes n ON nt.note_id = n.id
    WHERE nt.topic_id = ? AND nt.status = 'assimilated'
    ORDER BY nt.assimilated_at DESC LIMIT 12
  `).all(topicId);
  db.close();

  const views = (body.views || []).length
    ? body.views.map(v => `- ${v.who}：${v.what}${v.conflict ? '（⚡与他方冲突）' : ''}`).join('\n')
    : '（暂无）';
  const notesBlock = notes.length
    ? notes.map((n, i) => `[素材${i + 1}]（来源：${n.source_title || '未知'}）\n${(n.excerpt || '').slice(0, 600)}`).join('\n\n')
    : '（暂无已并入素材）';

  return `## 材料：主题页《${topic.name}》
这是用户长期维护的知识主题，包含 AI 综述与已并入素材。用户是带着问题来探讨的：请引用材料里的证据回答、指出观点间的矛盾、必要时提出反例；材料之外的推测要明确标注。
【当前认知】
${body.current || topic.description || '（空）'}
【各方观点】
${views}
【共识 / 非共识】
${body.consensus || '（暂无）'}
【已并入素材】
${notesBlock}`;
}

// 构建注入材料前缀后的完整消息数组。异步：多篇 content 的原文抓取用 Promise.all 并行，
// 避免串行等待导致响应变慢（每篇最多 15 秒超时，见 FETCH_TIMEOUT_MS）。
// 沿用 server.js 里 /api/llm/chat 已有的既定模式：材料前缀注入到「当前这一轮」的最新用户
// 消息（不是固定的第一条），历史消息原样保留、不重复注入。每轮都重新拼接材料是有意为之
// 的简单方案（对应 Phase 1 的无状态设计），成本随对话轮次线性增长，Phase 2 若要优化可改为
// 服务端持久化对话+材料只注入一次。
// contentIds: string[]，adHocContents: 已翻译的 ingest+translate 结果数组，userMessages: 对话历史，
// topicId: 主题页探讨模式（可与前两者并存，主题材料排在最前）
export async function buildMessagesWithContext(contentIds, adHocContents, userMessages, topicId = null) {
  const topicMaterial = topicId ? formatTopicAsMaterial(topicId) : null;

  const resolvedContents = (contentIds || [])
    .map(id => getContentById(id))
    .filter(Boolean);

  // 先并行拉取所有需要抓取原文的内容，再按固定顺序编号，避免并发导致材料编号错乱
  const contentResults = await Promise.all(
    resolvedContents.map((content, i) => formatContentAsMaterial(content, i))
  );
  const contentMaterials = contentResults.map(r => r.text);
  // 降级清单（哪些材料只拿到摘要）——SSE 开流前作为 meta 事件发给前端显示黄条
  const degraded = contentResults.map(r => r.degraded).filter(Boolean);

  const adHocMaterials = (adHocContents || [])
    .map((adHoc, i) => formatAdHocAsMaterial(adHoc, contentMaterials.length + i));

  const materials = [
    ...(topicMaterial ? [topicMaterial] : []),
    ...contentMaterials,
    ...adHocMaterials,
  ];

  if (materials.length === 0 || userMessages.length === 0) {
    // 没有材料（理论上不应发生，前端应保证至少有一项）或没有对话历史，直接透传，不强行拼接
    return { messages: userMessages, degraded };
  }

  const materialsBlock = `# 参考材料\n\n${materials.join('\n\n---\n\n')}\n\n---\n\n请基于以上材料回答我的问题。如果某条材料标注了"无法获取原文"，请在回答时告知用户这一点，不要假装已经读过原文。如果材料中没有相关信息，请明确说明，不要编造。\n\n`;

  const history = userMessages.slice(0, -1);
  const currentMessage = userMessages[userMessages.length - 1];

  return {
    messages: [
      ...history,
      { role: 'user', content: materialsBlock + `问题：${currentMessage.content}` }
    ],
    degraded,
  };
}
