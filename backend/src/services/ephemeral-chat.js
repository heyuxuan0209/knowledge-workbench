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
    : '（暂无已收进素材）';

  return `## 材料：主题页《${topic.name}》
这是用户长期维护的知识主题，包含 AI 综述与已收进素材。用户是带着问题来探讨的：请引用材料里的证据回答、指出观点间的矛盾、必要时提出反例；材料之外的推测要明确标注。
【当前认知】
${body.current || topic.description || '（空）'}
【各方观点】
${views}
【共识 / 非共识】
${body.consensus || '（暂无）'}
【已收进素材】
${notesBlock}`;
}

// 素材库语义检索命中的素材卡作为材料（VISION-V4 阶段1a「把右侧AI当搜索引擎问全库」）。
// 与主题探讨的素材块同构：来源可溯，正文截断到 800 字够 LLM 引用。noteIds 由端侧语义检索给出。
function formatNotesAsMaterial(noteIds) {
  if (!noteIds?.length) return null;
  const db = getDatabase();
  const ph = noteIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, title, source_title, source_url, excerpt FROM notes WHERE id IN (${ph})
  `).all(...noteIds);
  db.close();
  if (!rows.length) return null;
  // 保持传入顺序（= 语义相关度降序）
  const byId = new Map(rows.map(r => [r.id, r]));
  const ordered = noteIds.map(id => byId.get(id)).filter(Boolean);
  const block = ordered.map((n, i) =>
    `[素材${i + 1}]${n.title ? ` 《${n.title}》` : ''}（来源：${n.source_title || '未知'}${n.source_url ? ` ${n.source_url}` : ''}）\n${(n.excerpt || '').slice(0, 800)}`
  ).join('\n\n');
  return `## 材料：从你的素材库中语义检索到的相关素材
用户把 AI 助手当作"问整个素材库"的搜索引擎。请只依据下面这些素材回答用户的问题：引用具体素材（标注[素材N]）、指出素材间的关联与矛盾；素材里没有的就明说"素材库里没有相关内容"，不要编造，也不要用你自己的通用知识替代素材内容。
${block}`;
}

// 跨主题问答（VISION-V4 阶段1a，主题库 AI 助手）：把用户全部主题的综述作为材料，
// 让 AI 横跨所有主题综合、串联、找关联/矛盾/盲点。主题少（十几个）直接全喂，够用且最准；
// 多了（>30）再改语义预筛 top-k。只喂综述不喂原始素材（太长），每主题当前认知截到 700 字。
function formatAllTopicsAsMaterial() {
  const db = getDatabase();
  const topics = db.prepare('SELECT id, name, description, body FROM topics ORDER BY updated_at DESC').all();
  db.close();
  if (!topics.length) return { material: null, topicNames: [] };

  const blocks = topics.map((t, i) => {
    let body; try { body = JSON.parse(t.body || '{}'); } catch { body = {}; }
    const views = (body.views || []).length
      ? '\n【各方观点】\n' + body.views.map(v => `  - ${v.who}：${v.what}${v.conflict ? '（⚡与他方冲突）' : ''}`).join('\n')
      : '';
    const consensus = body.consensus ? `\n【共识/非共识】${body.consensus}` : '';
    return `### 主题${i + 1}《${t.name}》\n【当前认知】${(body.current || t.description || '（空）').slice(0, 700)}${views}${consensus}`;
  });

  const material = `## 材料：用户长期沉淀的全部知识主题（他消化后的观点与理解）
用户想跨主题地问、串联思考。请只依据下面这些主题综述回答：引用具体主题（标注《主题名》）、指出主题之间的关联与矛盾、必要时点出他还没想清楚的盲点；综述里没有的就明说，不要用你的通用知识替代他的观点。

${blocks.join('\n\n')}`;
  return { material, topicNames: topics.map(t => t.name) };
}

// 构建注入材料前缀后的完整消息数组。异步：多篇 content 的原文抓取用 Promise.all 并行，
// 避免串行等待导致响应变慢（每篇最多 15 秒超时，见 FETCH_TIMEOUT_MS）。
// 沿用 server.js 里 /api/llm/chat 已有的既定模式：材料前缀注入到「当前这一轮」的最新用户
// 消息（不是固定的第一条），历史消息原样保留、不重复注入。每轮都重新拼接材料是有意为之
// 的简单方案（对应 Phase 1 的无状态设计），成本随对话轮次线性增长，Phase 2 若要优化可改为
// 服务端持久化对话+材料只注入一次。
// contentIds: string[]，adHocContents: 已翻译的 ingest+translate 结果数组，userMessages: 对话历史，
// topicId: 主题页探讨模式（可与前两者并存，主题材料排在最前）
export async function buildMessagesWithContext(contentIds, adHocContents, userMessages, topicId = null, noteIds = [], knowledgeBase = false) {
  const topicMaterial = topicId ? formatTopicAsMaterial(topicId) : null;
  const notesMaterial = formatNotesAsMaterial(noteIds);
  const kb = knowledgeBase ? formatAllTopicsAsMaterial() : { material: null, topicNames: [] };

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
    ...(kb.material ? [kb.material] : []),
    ...(notesMaterial ? [notesMaterial] : []),
    ...contentMaterials,
    ...adHocMaterials,
  ];

  if (materials.length === 0 || userMessages.length === 0) {
    // 没有材料（理论上不应发生，前端应保证至少有一项）或没有对话历史，直接透传，不强行拼接
    return { messages: userMessages, degraded, topicNames: kb.topicNames };
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
    topicNames: kb.topicNames,
  };
}
