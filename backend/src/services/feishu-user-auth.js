import { getDatabase } from '../db/init.js';
import { feishuBase } from './feishu-auth.js';

// 飞书用户授权（ADR-039 · 取料读个人文档）：OAuth 授权码流程换 user_access_token。
// 为什么要它：tenant_access_token（应用身份）只读得到共享给应用的文档；个人版飞书又不让把应用加协作者。
// user_access_token 以【用户本人】身份调 API → 能读你飞书里能看到的一切（含个人文档），无需逐篇共享。
// 令牌存 app_meta（本地 DB、gitignore）；access ~2h、refresh ~30d，自动续期。私信机器人仍用应用身份，不受影响。

const KEY = 'feishu_user_token';

function load() {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(KEY);
  db.close();
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}
function save(tok) {
  const db = getDatabase();
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .run(KEY, JSON.stringify(tok || {}));
  db.close();
}

export function feishuUserConnected() {
  const t = load();
  return !!(t && t.refresh_token && Date.now() < (t.refresh_expires_at || 0));
}
export function disconnect() { save({}); }

export function redirectUri() {
  return process.env.FEISHU_OAUTH_REDIRECT || `http://localhost:${process.env.PORT || 3000}/api/feishu/oauth/callback`;
}

// 授权页 URL（浏览器跳过去登录授权）。scope 含云文档读权限 + offline_access（拿 refresh_token）。
// 授权页在 accounts.feishu.cn（不在 open.feishu.cn/open-apis 下，那个会 404），且必须带 response_type=code。
export function authorizeUrl(state = 'kw') {
  const scope = process.env.FEISHU_OAUTH_SCOPE
    || 'docx:document:readonly drive:drive:readonly wiki:wiki:readonly offline_access';
  const accountsBase = process.env.FEISHU_ACCOUNTS_BASE
    || (feishuBase().includes('larksuite') ? 'https://accounts.larksuite.com' : 'https://accounts.feishu.cn');
  const u = new URL(accountsBase + '/open-apis/authen/v1/authorize');
  u.searchParams.set('client_id', process.env.FEISHU_APP_ID);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('scope', scope);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  return u.toString();
}

async function tokenRequest(body) {
  const res = await fetch(feishuBase() + '/open-apis/authen/v2/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (j.code != null && j.code !== 0) {
    throw new Error(`飞书 OAuth 失败(${j.code}): ${j.msg || j.error_description || j.error || ''}`);
  }
  return j.data || j; // v2 有的返回顶层、有的裹 data，两头兼容
}
function store(d) {
  const now = Date.now();
  save({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: now + (d.expires_in || 7200) * 1000,
    refresh_expires_at: now + (d.refresh_token_expires_in || 30 * 86400) * 1000,
  });
}

// 回调拿到 code → 换首个 token
export async function exchangeCode(code) {
  const d = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: process.env.FEISHU_APP_ID,
    client_secret: process.env.FEISHU_APP_SECRET,
    code,
    redirect_uri: redirectUri(),
  });
  if (!d.access_token) throw new Error('飞书没返回 access_token');
  store(d);
  return true;
}

// 取料时调：返回可用的 user_access_token；过期则自动 refresh；未连接/续期失败返回 null（上层退回应用令牌）。
export async function getUserAccessTokenIfConnected() {
  const t = load();
  if (!t?.access_token) return null;
  if (Date.now() < (t.expires_at || 0) - 60_000) return t.access_token;
  if (!t.refresh_token || Date.now() >= (t.refresh_expires_at || 0)) return null;
  try {
    const d = await tokenRequest({
      grant_type: 'refresh_token',
      client_id: process.env.FEISHU_APP_ID,
      client_secret: process.env.FEISHU_APP_SECRET,
      refresh_token: t.refresh_token,
    });
    if (!d.access_token) return null;
    store(d);
    return d.access_token;
  } catch (e) { console.error('[feishu-oauth] 刷新用户令牌失败:', e.message); return null; }
}
