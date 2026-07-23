import { feishuFetch } from './feishu-auth.js';

// 飞书各资源的读取封装（ADR-037）。每个函数对应一条官方开放平台接口，注释标了 path，
// 真机联通若某接口漂移，改这一行即可（sync/pick 都调这里，不散落 URL）。
//
// 覆盖四类来源（用户勾选 docx+minutes+im+wiki）：
//   docx 云文档 · minutes 妙记 · im 群聊消息 · wiki 知识库
// 已知限制：妙记无官方"列表"接口，只能按单条 token 取（走"从飞书选/粘链接"），被动 sync 不遍历妙记。
//
// 列表来源可选用 .env 收窄，避免遍历整个云空间：
//   FEISHU_DOC_FOLDER_TOKEN  只扫这个文件夹下的文档（缺省=根目录）
//   FEISHU_WIKI_SPACE_ID     只扫这个知识库空间（缺省=应用可见的全部空间）
//   FEISHU_IM_CHAT_IDS       逗号分隔，只拉这些群（缺省=机器人所在的全部群）

const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

// ---------- 云文档 docx ----------

// 根目录 token（drive 列文件需要 folder_token；空 token 部分租户会报错，故显式取根）
async function rootFolderToken() {
  const d = await feishuFetch('/open-apis/drive/explorer/v2/root_folder/meta', { preferUser: true });
  return d?.token || null;
}

// 列出文件夹下的文档（只留 docx，其它类型忽略）。
export async function listDocs({ pageSize = 20 } = {}) {
  const folder = process.env.FEISHU_DOC_FOLDER_TOKEN || (await rootFolderToken());
  const d = await feishuFetch('/open-apis/drive/v1/files', {
    query: { folder_token: folder, page_size: num(pageSize, 20) }, preferUser: true,
  });
  const files = d?.files || [];
  return files
    .filter(f => f.type === 'docx' || f.type === 'doc')
    .map(f => ({
      objType: 'docx',
      feishuId: f.token,
      title: f.name || '(无标题文档)',
      url: f.url || null,
      sourceName: '云文档',
      feishuTime: f.modified_time || f.created_time || null,
      extra: {},
    }));
}

// 抓文档正文纯文本。raw_content 直接返回文本（需应用被加为该文档协作者，否则 403/权限错误）。
export async function getDocxText(documentId) {
  const d = await feishuFetch(`/open-apis/docx/v1/documents/${documentId}/raw_content`, { preferUser: true });
  return d?.content || '';
}

export async function getDocxTitle(documentId) {
  const d = await feishuFetch(`/open-apis/docx/v1/documents/${documentId}`, { preferUser: true });
  return d?.document?.title || null;
}

// ---------- 妙记 minutes ----------
// 无列表接口。按单条 minute_token 取信息 + 文字记录。token 通常从妙记 URL 里解析。

export async function getMinuteInfo(minuteToken) {
  const d = await feishuFetch(`/open-apis/minutes/v1/minutes/${minuteToken}`, { preferUser: true });
  return d?.minute || d || null;
}

export async function getMinuteText(minuteToken) {
  // 文字记录接口：GET /open-apis/minutes/v1/minutes/{token}/transcript（需 minutes:minutes:readonly）
  try {
    const d = await feishuFetch(`/open-apis/minutes/v1/minutes/${minuteToken}/transcript`, { preferUser: true });
    // 不同租户返回结构略异：优先 data.transcript（纯文本）；否则拼 sentence 列表
    if (typeof d?.transcript === 'string') return d.transcript;
    if (Array.isArray(d?.sentences)) return d.sentences.map(s => s.content || s.text || '').join('\n');
    return typeof d === 'string' ? d : '';
  } catch (e) {
    // 转写接口未开通/无权限时，退回信息里的摘要（若有），不硬失败
    const info = await getMinuteInfo(minuteToken).catch(() => null);
    if (info?.summary) return info.summary;
    throw e;
  }
}

// ---------- 群聊消息 im ----------

// 机器人所在的群列表
export async function listChats({ pageSize = 20 } = {}) {
  const d = await feishuFetch('/open-apis/im/v1/chats', { query: { page_size: num(pageSize, 20) } });
  return (d?.items || []).map(c => ({ chatId: c.chat_id, name: c.name || '(未命名群)' }));
}

// 取一个群最近的消息（倒序）。只保留文本类，提取纯文本。
export async function listMessages(chatId, { pageSize = 20 } = {}) {
  const d = await feishuFetch('/open-apis/im/v1/messages', {
    query: {
      container_id_type: 'chat',
      container_id: chatId,
      sort_type: 'ByCreateTimeDesc',
      page_size: num(pageSize, 20),
    },
  });
  const items = d?.items || [];
  const out = [];
  for (const m of items) {
    const text = extractMessageText(m);
    if (!text) continue; // 非文本（图片/文件/表情等）跳过
    out.push({
      objType: 'message',
      feishuId: m.message_id,
      title: text.slice(0, 40),
      snippet: text,
      author: m.sender?.id || m.sender?.sender_id?.open_id || null,
      feishuTime: m.create_time || null,
      extra: { chatId },
    });
  }
  return out;
}

// 从飞书消息体里抽纯文本。text 类：body.content 是 JSON {"text":"..."}；post（富文本）拼各段 text。
function extractMessageText(m) {
  const type = m.msg_type;
  let content = m.body?.content;
  if (!content) return '';
  let parsed;
  try { parsed = JSON.parse(content); } catch { return type === 'text' ? content : ''; }
  if (type === 'text') return (parsed.text || '').trim();
  if (type === 'post') {
    // post: { zh_cn|en_us: { title, content: [[ {tag:'text', text}, ... ], ...] } }
    const langBlock = parsed.zh_cn || parsed.en_us || Object.values(parsed)[0] || {};
    const lines = (langBlock.content || []).map(row =>
      (row || []).map(seg => seg.text || '').join('')).filter(Boolean);
    const title = langBlock.title ? langBlock.title + '\n' : '';
    return (title + lines.join('\n')).trim();
  }
  return '';
}

// ---------- 知识库 wiki ----------

export async function listWikiSpaces({ pageSize = 20 } = {}) {
  const d = await feishuFetch('/open-apis/wiki/v2/spaces', { query: { page_size: num(pageSize, 20) }, preferUser: true });
  return (d?.items || []).map(s => ({ spaceId: s.space_id, name: s.name || '(未命名知识库)' }));
}

// 列一个空间的节点（每个 wiki 节点挂着一个真实对象 obj_token，通常是 docx）。
export async function listWikiNodes(spaceId, { pageSize = 30 } = {}) {
  const d = await feishuFetch(`/open-apis/wiki/v2/spaces/${spaceId}/nodes`, {
    query: { page_size: num(pageSize, 30) }, preferUser: true,
  });
  return (d?.items || [])
    .filter(n => n.obj_type === 'docx' || n.obj_type === 'doc')
    .map(n => ({
      objType: 'wiki',
      feishuId: n.node_token,
      title: n.title || '(无标题)',
      sourceName: '知识库',
      extra: { objToken: n.obj_token, objType: n.obj_type, spaceId },
    }));
}

// wiki 节点正文 = 解析其挂载的 docx obj_token 后抓 raw_content
export async function getWikiNodeText(extra) {
  if (!extra?.objToken) return '';
  return getDocxText(extra.objToken);
}

// 飞书原生全文搜索（ADR-039 取料·搜索）：POST /suite/docs-api/search/object。
// 覆盖你整个飞书里应用可见的文档、实时、零维护（飞书自己维护索引）；字面/关键词匹配、非语义。
// 只返回 docx（可读正文）——bitable/sheet/mindnote 不是可读散文，取料读不了，过滤掉。
export async function searchDocs(query, { count = 10 } = {}) {
  if (!query || !query.trim()) return [];
  const d = await feishuFetch('/open-apis/suite/docs-api/search/object', {
    method: 'POST',
    body: { search_key: query.trim(), count, offset: 0 }, preferUser: true,
  });
  const ents = d?.docs_entities || [];
  return ents
    .filter(e => e.docs_type === 'docx' || e.docs_type === 'doc')
    .map(e => ({
      objType: 'docx',
      feishuId: e.docs_token,
      title: e.title || '(无标题文档)',
      url: null,               // 搜索不返回 URL；「拉来读」按 token 直抓正文，不需要 URL
      sourceName: '搜索',
      extra: {},
    }));
}

// 取 wiki 节点信息（含它挂的 obj_token）——粘 wiki 链接时用 node_token 解析出真实 docx
export async function getWikiNode(nodeToken) {
  const d = await feishuFetch('/open-apis/wiki/v2/spaces/get_node', { query: { token: nodeToken }, preferUser: true });
  return d?.node || null;
}

// ---------- 粘飞书链接：解析 URL → 抓正文（即时分析·取料用）----------
// 支持 /docx/<id>（云文档）、/wiki/<node_token>（知识库）、/minutes/<token>（妙记）。
export async function fetchFeishuLink(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('不是合法链接'); }
  const m = u.pathname.match(/\/(docx|wiki|minutes|docs)\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('这不是能识别的飞书文档/妙记/知识库链接');
  const [, kind, id] = m;
  if (kind === 'docx' || kind === 'docs') {
    const body = await getDocxText(id);
    const title = await getDocxTitle(id).catch(() => null);
    return { title, body };
  }
  if (kind === 'minutes') {
    const body = await getMinuteText(id);
    const info = await getMinuteInfo(id).catch(() => null);
    return { title: info?.title || null, body };
  }
  if (kind === 'wiki') {
    const node = await getWikiNode(id);
    if (!node?.obj_token) throw new Error('这个知识库节点没有可读正文');
    const body = await getDocxText(node.obj_token);
    return { title: node.title || null, body };
  }
  throw new Error(`暂不支持这种飞书链接：${kind}`);
}

// ---------- 统一取正文（triage / analyze 共用）----------
export async function getObjectText(objType, feishuId, extra = {}) {
  switch (objType) {
    case 'docx': return getDocxText(feishuId);
    case 'minute': return getMinuteText(feishuId);
    case 'wiki': return getWikiNodeText(extra);
    case 'message': return extra.text || ''; // 消息正文 sync 时已存进 snippet，由上层带入
    default: throw new Error(`未知飞书对象类型: ${objType}`);
  }
}
