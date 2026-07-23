import { feishuConfigured } from './feishu-auth.js';
import * as fs from './feishu-client.js';
import { upsertInboxItem } from '../db/feishu-inbox.js';

// 飞书被动收件箱 sync（ADR-037）：定时/手动拉取各来源最近内容 → 分诊建议去向 → 幂等写入 feishu_inbox。
// 分诊规则（自动给建议，用户在收件箱最终裁决）：
//   文档 docx / 妙记 minute / 知识库 wiki → material（"料"，采纳为素材）
//   群聊消息 message → idea（"想法/要写什么"，提为灵感）
// 每个来源 try/catch 独立降级：某源权限没配好/接口漂移只记 error、不影响其它源（真机联通更稳）。
//
// 来源开关：FEISHU_SOURCES=docx,minutes,im,wiki（缺省全开）。妙记无列表接口，sync 不遍历。

const DISPOSITION = { docx: 'material', minute: 'material', wiki: 'material', message: 'idea' };

function enabledSources() {
  const raw = (process.env.FEISHU_SOURCES || 'docx,im,wiki').split(',').map(s => s.trim()).filter(Boolean);
  return new Set(raw);
}

export async function syncFeishu({ perSource = 20 } = {}) {
  if (!feishuConfigured()) {
    return { ok: false, error: '飞书未配置（backend/.env 缺 FEISHU_APP_ID / FEISHU_APP_SECRET）' };
  }
  const sources = enabledSources();
  const result = { ok: true, added: 0, byType: {}, errors: [] };
  const add = (item) => {
    const created = upsertInboxItem({ ...item, suggested: DISPOSITION[item.objType] || 'idea' });
    if (created) {
      result.added++;
      result.byType[item.objType] = (result.byType[item.objType] || 0) + 1;
    }
  };

  // 云文档
  if (sources.has('docx')) {
    try {
      const docs = await fs.listDocs({ pageSize: perSource });
      for (const d of docs) add(d);
    } catch (e) { result.errors.push({ source: 'docx', message: e.message }); }
  }

  // 知识库
  if (sources.has('wiki')) {
    try {
      const only = process.env.FEISHU_WIKI_SPACE_ID;
      const spaces = only ? [{ spaceId: only }] : await fs.listWikiSpaces({ pageSize: 20 });
      for (const sp of spaces) {
        try {
          const nodes = await fs.listWikiNodes(sp.spaceId, { pageSize: perSource });
          for (const n of nodes) add(n);
        } catch (e) { result.errors.push({ source: `wiki:${sp.spaceId}`, message: e.message }); }
      }
    } catch (e) { result.errors.push({ source: 'wiki', message: e.message }); }
  }

  // 群聊消息
  if (sources.has('im')) {
    try {
      const only = (process.env.FEISHU_IM_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      const chats = only.length ? only.map(id => ({ chatId: id, name: null })) : await fs.listChats({ pageSize: 20 });
      for (const c of chats) {
        try {
          const msgs = await fs.listMessages(c.chatId, { pageSize: perSource });
          for (const m of msgs) add({ ...m, sourceName: c.name || '群聊' });
        } catch (e) { result.errors.push({ source: `im:${c.chatId}`, message: e.message }); }
      }
    } catch (e) { result.errors.push({ source: 'im', message: e.message }); }
  }

  return result;
}

// 「从飞书选」（触点①）用：列出可挑来即时分析的对象（文档 + 知识库节点；妙记靠粘链接单独处理）。
export async function listPickable({ perSource = 15 } = {}) {
  if (!feishuConfigured()) return { ok: false, error: '飞书未配置', items: [] };
  const items = [];
  const errors = [];
  try {
    const docs = await fs.listDocs({ pageSize: perSource });
    items.push(...docs);
  } catch (e) { errors.push({ source: 'docx', message: e.message }); }
  try {
    const only = process.env.FEISHU_WIKI_SPACE_ID;
    const spaces = only ? [{ spaceId: only }] : await fs.listWikiSpaces({ pageSize: 10 });
    for (const sp of spaces) {
      try { items.push(...await fs.listWikiNodes(sp.spaceId, { pageSize: perSource })); }
      catch (e) { errors.push({ source: `wiki:${sp.spaceId}`, message: e.message }); }
    }
  } catch (e) { errors.push({ source: 'wiki', message: e.message }); }
  return { ok: true, items, errors };
}
