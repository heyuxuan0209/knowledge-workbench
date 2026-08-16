import { feishuFetch } from '../../src/services/feishu-auth.js';

const FEISHU_BASE = (process.env.FEISHU_BASE || 'https://open.feishu.cn').replace(/\/$/, '');
let cachedToken = null;
let tokenExpiresAt = 0;

async function codexToken() {
  const appId = process.env.KW_NOTIFY_FEISHU_APP_ID;
  const appSecret = process.env.KW_NOTIFY_FEISHU_APP_SECRET;
  if (!appId || !appSecret) return null;
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const response = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const result = await response.json();
  if (result.code !== 0 || !result.tenant_access_token) {
    throw new Error(`Codex 飞书身份鉴权失败(${result.code}): ${result.msg || '未知错误'}`);
  }
  cachedToken = result.tenant_access_token;
  tokenExpiresAt = Date.now() + (result.expire || 7200) * 1000;
  return cachedToken;
}

/**
 * 用 Codex App 对用户发消息；数据读写仍由项目主 App 完成。
 * requireCodex=true 时禁止静默退回旧身份，供生产定时任务使用。
 */
export async function sendFeishuText(chatId, text, { requireCodex = false } = {}) {
  const token = await codexToken();
  if (!token) {
    if (requireCodex) {
      throw new Error('缺 KW_NOTIFY_FEISHU_APP_ID / KW_NOTIFY_FEISHU_APP_SECRET，拒绝用旧机器人身份发通知');
    }
    return feishuFetch('/open-apis/im/v1/messages', {
      method: 'POST',
      query: { receive_id_type: 'chat_id' },
      body: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) },
    });
  }

  const response = await fetch(`${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) }),
  });
  const result = await response.json();
  if (result.code !== 0) {
    throw new Error(`Codex 飞书身份发消息失败(${result.code}): ${result.msg || '未知错误'}`);
  }
  return result.data;
}
