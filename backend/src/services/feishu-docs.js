import { feishuBase, feishuFetch, getTenantAccessToken } from './feishu-auth.js';

// 评审场搬家 Phase 1（ADR-062）：起草产出 → 飞书文档。
// 走「上传 md → import_tasks 转 docx」而不是逐块拼 blocks——markdown 的标题/列表/引用由飞书转换器处理，
// 一次调用得到完整排版文档。创建方是主应用（cli_aa905，即 VPS Claude 机器人同一应用），
// 所以机器人对新文档天然有编辑权（Phase 2 群里 @机器人改稿 的前置），只需把 owner 转给用户。
// 用户 open_id 从 FEISHU_OWNER_OPEN_ID 读（open_id 是应用维度的，此值仅对主应用有效）。

const ownerOpenId = () => process.env.FEISHU_OWNER_OPEN_ID || '';
const wikiSpaceId = () => process.env.FEISHU_WIKI_SPACE_ID || '';
const wikiParentNode = () => process.env.FEISHU_WIKI_PARENT_NODE || '';

// 上传 markdown 字节做导入素材。parent_type 固定 ccm_import_open（导入专用挂载点）。
async function uploadForImport(fileName, content, fileExtension) {
  const token = await getTenantAccessToken();
  const bytes = new TextEncoder().encode(content);
  const form = new FormData();
  form.set('file_name', fileName);
  form.set('parent_type', 'ccm_import_open');
  form.set('size', String(bytes.byteLength));
  form.set('extra', JSON.stringify({ obj_type: 'docx', file_extension: fileExtension }));
  form.set('file', new Blob([bytes]), fileName);
  const res = await fetch(`${feishuBase()}/open-apis/drive/v1/medias/upload_all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }, // multipart 边界由 fetch 自动生成，勿手写 Content-Type
    body: form,
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`导入素材上传失败(${j.code}): ${j.msg || ''}`);
  return j.data.file_token;
}

// 轮询导入任务直到出结果。飞书转换通常 1-3s，超时给 20s。
async function waitImport(ticket) {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const d = await feishuFetch(`/open-apis/drive/v1/import_tasks/${ticket}`);
    const r = d?.result;
    if (r?.job_status === 0) return r; // {token, url, type}
    if (r?.job_status != null && r.job_status !== 1 && r.job_status !== 2) {
      throw new Error(`导入任务失败(job_status=${r.job_status}): ${r.job_error_msg || ''}`);
    }
  }
  throw new Error('导入任务超时（20s）');
}

// 导入产物挪进用户知识库（应用已是知识库成员，2026-07-30 实测可建节点——个人版走「文档应用」授权即可，
// 无需把机器人加为"协作者"）。挪进去后权限随空间走：用户是空间主人、应用可编辑，双赢且无需 owner 转移。
async function moveIntoWiki(objToken, parentWikiToken = wikiParentNode()) {
  const d = await feishuFetch(`/open-apis/wiki/v2/spaces/${wikiSpaceId()}/nodes/move_docs_to_wiki`, {
    method: 'POST',
    body: { parent_wiki_token: parentWikiToken || undefined, obj_type: 'docx', obj_token: objToken },
  });
  if (d?.wiki_token) return d.wiki_token;
  // 大文档转异步任务：轮询到出 wiki_token
  if (d?.task_id) {
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const t = await feishuFetch(`/open-apis/wiki/v2/tasks/${d.task_id}`, { query: { task_type: 'move' } });
      const tok = t?.task?.move_result?.[0]?.node?.node_token;
      if (tok) return tok;
    }
  }
  throw new Error('move_docs_to_wiki 未返回 wiki_token');
}

// markdown（或 html）→ 飞书 docx。返回 { url, token }。
// destination='wiki'（默认）：挪进用户知识库「母稿」节点下，权限随空间（用户=空间主人，应用可编辑）。
// destination='drive'：留云空间并把 owner 转给用户（FEISHU_OWNER_OPEN_ID），主应用退为可编辑协作者。
export async function createDocFromMarkdown({
  title, markdown, fileExtension = 'md', destination = 'wiki', wikiParentToken,
}) {
  if (!title?.trim() || !markdown?.trim()) throw new Error('title 和 markdown 必填');
  // fail fast：落点配置不全就别建——建完才报错会留下一个用户看不见的应用名下孤儿文档（2026-07-30 实测）
  if (destination === 'wiki' && !wikiSpaceId()) throw new Error('缺 FEISHU_WIKI_SPACE_ID（backend/.env）');
  if (destination === 'drive' && !ownerOpenId()) throw new Error('缺 FEISHU_OWNER_OPEN_ID（backend/.env），无法把文档 owner 转给用户');

  const fileToken = await uploadForImport(`${title}.${fileExtension}`, markdown, fileExtension);
  const task = await feishuFetch('/open-apis/drive/v1/import_tasks', {
    method: 'POST',
    body: {
      file_extension: fileExtension,
      file_token: fileToken,
      type: 'docx',
      file_name: title,
      point: { mount_type: 1, mount_key: '' }, // 先挂应用空间，随后按 destination 挪走/转 owner
    },
  });
  const result = await waitImport(task.ticket);

  if (destination === 'wiki') {
    const wikiToken = await moveIntoWiki(result.token, wikiParentToken);
    return { url: `https://my.feishu.cn/wiki/${wikiToken}`, token: result.token, wikiToken };
  }
  await feishuFetch(`/open-apis/drive/v1/permissions/${result.token}/members/transfer_owner`, {
    method: 'POST',
    query: { type: 'docx' },
    body: { member_type: 'openid', member_id: ownerOpenId() },
  });
  return { url: result.url, token: result.token };
}

// ── 母稿原地重写（幂等，ADR-09x）────────────────────────────────────────────
// 背景：import_tasks 只能新建，改一版就在内容工场多一篇同名文档，认不出哪篇是最新。
// 关键前提是飞书自带 markdown→blocks 的官方转换器（blocks/convert），所以不必自己拼块——
// 社区反复踩的"手拼 block 导致文档内容错乱、前后关系不对"这条坑绕过去了。
// 流程：convert → 清空根块下所有子块 → descendant 整棵树写回。文档 token / URL / 知识库节点全程不变。
//
// 两个实测出来的坑（别照文档想当然）：
//  ① convert 返回的 blocks 顺序是乱的，不是文档顺序——必须按 first_level_block_ids 重排，否则段落全串。
//  ② 删块会让挂在块上的飞书评论一起失效。当前工作流是"和 Claude 聊着改稿"、不在文档里评论，
//     所以可接受；哪天改成在文档里评论，这里要先把评论捞出来再重写。

const DESCENDANT_BATCH = 50;   // 飞书单次写入块数上限

// 根块（block_id === document_id）下的直接子块，翻页取全。
async function listRootChildren(documentId) {
  const ids = [];
  let pageToken = null;
  do {
    const d = await feishuFetch(
      `/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
      { query: { page_size: 500, page_token: pageToken, document_revision_id: -1 } },
    );
    for (const b of d?.items || []) ids.push(b.block_id);
    pageToken = d?.has_more ? d.page_token : null;
  } while (pageToken);
  return ids;
}

// 按 first_level_block_ids 顺序，把每个一级块连同其子孙收成一组（保序）。
function collectSubtrees(order, blocks) {
  const byId = new Map(blocks.map(b => [b.block_id, b]));
  return order.map((id) => {
    const group = [];
    const walk = (bid) => {
      const b = byId.get(bid);
      if (!b) return;
      group.push(b);
      for (const child of b.children || []) walk(child);
    };
    walk(id);
    return { rootId: id, nodes: group };
  });
}

/** 把已有 docx 的正文整体换成新 markdown。URL / token / 知识库节点不变。返回 { documentId, blocks }。 */
export async function updateDocFromMarkdown({ documentId, markdown }) {
  if (!documentId) throw new Error('documentId 必填');
  if (!markdown?.trim()) throw new Error('markdown 不能为空');

  const conv = await feishuFetch('/open-apis/docx/v1/documents/blocks/convert', {
    method: 'POST',
    body: { content_type: 'markdown', content: markdown },
  });
  const order = conv?.first_level_block_ids || [];
  const blocks = conv?.blocks || [];
  if (!order.length) throw new Error('markdown 转换后没有内容块');

  // 先清空再写入。顺序不能反——先写会和旧内容叠在一起。
  const existing = await listRootChildren(documentId);
  if (existing.length) {
    await feishuFetch(
      `/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children/batch_delete`,
      {
        method: 'DELETE',
        query: { document_revision_id: -1 },
        body: { start_index: 0, end_index: existing.length },
      },
    );
  }

  // 按一级块分批（保证一棵子树不被切断），累计到 50 块就发一批。
  const groups = collectSubtrees(order, blocks);
  let index = 0;
  let written = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    await feishuFetch(
      `/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/descendant`,
      {
        method: 'POST',
        query: { document_revision_id: -1 },
        body: {
          index,
          children_id: batch.map(g => g.rootId),
          descendants: batch.flatMap(g => g.nodes),
        },
      },
    );
    index += batch.length;
    written += batch.reduce((n, g) => n + g.nodes.length, 0);
    batch = [];
  };
  for (const g of groups) {
    const pending = batch.reduce((n, x) => n + x.nodes.length, 0);
    if (batch.length && pending + g.nodes.length > DESCENDANT_BATCH) await flush();
    batch.push(g);
  }
  await flush();

  return { documentId, blocks: written };
}

// 创作简报头——起草落飞书时拼在正文前，评审者（人/机器人）先读简报再读稿（ADR-062 交接物约定）。
export function draftBrief({ topic = '', thesis = '', sources = '', genre = '', platform = '', voice = '' } = {}) {
  const lines = [
    '> 📋 **创作简报**（评审前先读这里）',
    topic && `> **选题**：${topic}`,
    thesis && `> **核心观点**：${thesis}`,
    sources && `> **素材来源**：${sources}`,
    (genre || platform || voice) && `> **装配**：${[genre, platform, voice].filter(Boolean).join(' × ')}`,
  ].filter(Boolean);
  return lines.join('\n') + '\n\n---\n\n';
}
