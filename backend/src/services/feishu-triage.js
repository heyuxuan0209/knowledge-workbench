import { getInboxItem, markTriaged } from '../db/feishu-inbox.js';
import { getObjectText } from './feishu-client.js';
import { createNote } from '../db/notes.js';
import { createIdea } from '../db/ideas.js';

// 飞书收件箱分诊（ADR-037）：把一条"待整理"落地成素材 / 灵感 / 忽略。
//   material → 抓正文 createNote（noteType 用 'chat' 兜 CHECK 约束；source 溯源到飞书链接）
//   idea     → 抓正文 createIdea（source_kind='feishu'，body=正文），即"统一 POST 到 /api/ideas/ingest"那条接缝
//   ignore   → 只标 ignored，留痕不删
// 正文分诊时才抓（sync 不预抓，避免大量拉正文 + 协作者权限错误提前爆）。消息正文 sync 已存 snippet。

// notes.note_type 的 CHECK 只允许 chat/excerpt/insight，飞书素材用 'chat'（与"从对话/摘录存下的料"语义一致）。
const NOTE_TYPE = 'chat';

async function resolveBody(item) {
  if (item.obj_type === 'message') return item.snippet || '';
  return getObjectText(item.obj_type, item.feishu_id, item.extra || {});
}

// action: 'material' | 'idea' | 'ignore'
export async function triageInboxItem(id, action) {
  const item = getInboxItem(id);
  if (!item) return { ok: false, error: '收件箱里没有这条' };
  if (item.status !== 'pending') return { ok: false, error: '这条已处理过' };

  if (action === 'ignore') {
    markTriaged(id, { status: 'ignored' });
    return { ok: true, action: 'ignore' };
  }

  let body = '';
  try {
    body = await resolveBody(item);
  } catch (e) {
    // 抓正文失败（多为：应用未被加为该文档协作者 / 机器人不在群 / 妙记转写未开）→ 给可执行指引，不落地
    return {
      ok: false,
      needsPermission: true,
      error: `抓不到正文：${e.message}。多半是权限没给到——文档需把应用加为协作者、群消息需把机器人拉进群、妙记需开通转写权限。`,
    };
  }

  const title = (item.title || (body || '飞书内容').slice(0, 40)).trim();

  if (action === 'material') {
    if (!body?.trim()) return { ok: false, error: '正文为空，采纳为素材没有料' };
    const note = createNote({
      excerpt: body,
      noteType: NOTE_TYPE,
      title,
      sourceTitle: `飞书 · ${item.source_name || item.obj_type}`,
      sourceUrl: item.url || null,
    });
    markTriaged(id, { status: 'accepted', resultKind: 'note', resultId: note.id });
    return { ok: true, action: 'material', resultId: note.id };
  }

  if (action === 'idea') {
    const idea = createIdea({
      title,
      body: body?.trim() ? body : null,
      sourceKind: 'feishu',
      sourceRef: item.url || (item.extra?.chatId ? JSON.stringify({ chatId: item.extra.chatId, messageId: item.feishu_id }) : null),
    });
    markTriaged(id, { status: 'accepted', resultKind: 'idea', resultId: idea.id });
    return { ok: true, action: 'idea', resultId: idea.id };
  }

  return { ok: false, error: `未知分诊动作: ${action}` };
}
