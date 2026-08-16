// 飞书交接：把导出文件传进云盘文件夹 + 往群里发通知。独立于 server.js 运行（launchd 直调）。
// 凭证从 backend/.env 读：
//   上传 = 主应用 FEISHU_APP_ID / FEISHU_APP_SECRET（工单指定，drive/v1/files/upload_all）
//   通知 = 默认 Codex App（~/.codex-im/.env）；数据权限与用户可见身份严格分离。
import fs from 'fs';
import { basename } from 'path';
import { config } from './config.mjs';

const FEISHU_BASE = (process.env.FEISHU_BASE || 'https://open.feishu.cn').replace(/\/$/, '');

// 通用：某组 app 凭证换 tenant_access_token（内存缓存到过期前 60s）
const tokCache = new Map();
async function tenantToken(appId, appSecret, cacheKey) {
  const now = Date.now();
  const c = tokCache.get(cacheKey);
  if (c && now < c.exp - 60_000) return c.token;
  const res = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const j = await res.json();
  if (j.code !== 0 || !j.tenant_access_token) {
    throw new Error(`飞书鉴权失败(${cacheKey} ${j.code}): ${j.msg || '未知错误'}`);
  }
  tokCache.set(cacheKey, { token: j.tenant_access_token, exp: now + (j.expire || 7200) * 1000 });
  return j.tenant_access_token;
}

function mainAppToken() {
  const id = process.env.FEISHU_APP_ID, secret = process.env.FEISHU_APP_SECRET;
  if (!id || !secret) throw new Error('缺 FEISHU_APP_ID / FEISHU_APP_SECRET（backend/.env）');
  return tenantToken(id, secret, 'main');
}

function notifyToken() {
  if (config.notifyBot === 'codex') {
    const id = process.env.KW_NOTIFY_FEISHU_APP_ID, secret = process.env.KW_NOTIFY_FEISHU_APP_SECRET;
    if (!id || !secret) throw new Error('缺 Codex 飞书桥凭据（~/.codex-im/.env），拒绝用旧机器人身份发通知');
    return tenantToken(id, secret, 'codex');
  }
  if (config.notifyBot === 'main') return mainAppToken();
  if (config.notifyBot !== 'note') throw new Error(`未知 PLATFORM_EXPORT_NOTIFY_BOT：${config.notifyBot}`);
  const id = process.env.FEISHU_BOT_APP_ID, secret = process.env.FEISHU_BOT_APP_SECRET;
  if (!id || !secret) throw new Error('缺 FEISHU_BOT_APP_ID / FEISHU_BOT_APP_SECRET（backend/.env）');
  return tenantToken(id, secret, 'note');
}

// 上传一个本地文件到云盘文件夹（drive/v1/files/upload_all，≤20MB 单请求足够，导出表都很小）。
// 返回 file_token。folder_token 缺省用 config.folderToken。
export async function uploadFile(localPath, folderToken = config.folderToken) {
  if (!folderToken) throw new Error('缺 PLATFORM_EXPORT_FOLDER_TOKEN（backend/.env）——飞书云盘交接文件夹 token，无内置默认');
  const token = await mainAppToken();
  const buf = fs.readFileSync(localPath);
  const name = basename(localPath);
  const form = new FormData();
  form.set('file_name', name);
  form.set('parent_type', 'explorer');
  form.set('parent_node', folderToken);
  form.set('size', String(buf.length));
  // Node 内置 Blob/FormData；文件名放这里保证服务端拿到正确扩展名
  form.set('file', new Blob([buf]), name);
  const res = await fetch(`${FEISHU_BASE}/open-apis/drive/v1/files/upload_all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }, // 不要手写 Content-Type，让 fetch 带 multipart boundary
    body: form,
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`上传失败(${name} ${j.code}): ${j.msg || '未知错误'}`);
  return j.data?.file_token || null;
}

// 往群里发一条文本消息
export async function notify(text, chatId = config.chatId) {
  if (!chatId) throw new Error('缺 PLATFORM_EXPORT_CHAT_ID（backend/.env）——通知群 chat_id，无内置默认');
  const token = await notifyToken();
  const res = await fetch(`${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) }),
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`发送通知失败(${j.code}): ${j.msg || '未知错误'}`);
}

// 通知封装：即便发送本身失败，也不要再抛（避免"报错的报错"淹没真正的失败原因），只打日志。
// 返回 true = 确实送达。调用方要据此判断「这次结果她到底知不知道」——
// 通知没送达时静默吞掉，就等于导出坏了也没人知道（2026-08-10/11 断更两天就是这么发生的）。
export async function notifySafe(text, chatId) {
  try { await notify(text, chatId); return true; }
  catch (e) { console.error(`[notify] 发送失败，通知内容未送达：${e.message}\n原文：${text}`); return false; }
}
