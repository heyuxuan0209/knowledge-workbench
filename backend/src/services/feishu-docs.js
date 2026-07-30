import { feishuBase, feishuFetch, getTenantAccessToken } from './feishu-auth.js';

// 评审场搬家 Phase 1（ADR-062）：起草产出 → 飞书文档。
// 走「上传 md → import_tasks 转 docx」而不是逐块拼 blocks——markdown 的标题/列表/引用由飞书转换器处理，
// 一次调用得到完整排版文档。创建方是主应用（cli_aa905，即 VPS Claude 机器人同一应用），
// 所以机器人对新文档天然有编辑权（Phase 2 群里 @机器人改稿 的前置），只需把 owner 转给用户。
// 用户 open_id 从 FEISHU_OWNER_OPEN_ID 读（open_id 是应用维度的，此值仅对主应用有效）。

const ownerOpenId = () => process.env.FEISHU_OWNER_OPEN_ID || '';

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

// markdown（或 html）→ 飞书 docx。返回 { url, token }。
// transferOwner=true 时把 owner 转给 FEISHU_OWNER_OPEN_ID（用户），主应用退为可编辑协作者。
export async function createDocFromMarkdown({ title, markdown, fileExtension = 'md', transferOwner = true }) {
  if (!title?.trim() || !markdown?.trim()) throw new Error('title 和 markdown 必填');
  // fail fast：owner 转不了就别建——建完才报错会留下一个用户看不见的应用名下孤儿文档（2026-07-30 实测）
  if (transferOwner && !ownerOpenId()) throw new Error('缺 FEISHU_OWNER_OPEN_ID（backend/.env），无法把文档 owner 转给用户');
  const fileToken = await uploadForImport(`${title}.${fileExtension}`, markdown, fileExtension);
  const task = await feishuFetch('/open-apis/drive/v1/import_tasks', {
    method: 'POST',
    body: {
      file_extension: fileExtension,
      file_token: fileToken,
      type: 'docx',
      file_name: title,
      point: { mount_type: 1, mount_key: '' }, // 挂主应用空间根目录；owner 转走后在用户「归我所有」可见
    },
  });
  const result = await waitImport(task.ticket);

  if (transferOwner) {
    if (!ownerOpenId()) throw new Error('缺 FEISHU_OWNER_OPEN_ID（backend/.env），无法把文档 owner 转给用户');
    await feishuFetch(`/open-apis/drive/v1/permissions/${result.token}/members/transfer_owner`, {
      method: 'POST',
      query: { type: 'docx' },
      body: { member_type: 'openid', member_id: ownerOpenId() },
    });
  }
  return { url: result.url, token: result.token };
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
