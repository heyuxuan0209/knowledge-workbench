// 飞书开放平台鉴权（ADR-037）。自建应用凭证 → tenant_access_token（内存缓存，2h 过期自动刷新）。
// 凭证只从 backend/.env 读（FEISHU_APP_ID / FEISHU_APP_SECRET），代码里不硬编造。
// 区域可配：FEISHU_BASE 默认飞书·中国 open.feishu.cn；国际版 Lark 填 https://open.larksuite.com。
// 出网走 server.js 已挂的 undici 全局 dispatcher（EnvHttpProxyAgent），fetch 自动吃代理（见 project-conventions）。

let cached = { token: null, exp: 0 };

export function feishuConfigured() {
  return !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
}

export function feishuBase() {
  return (process.env.FEISHU_BASE || 'https://open.feishu.cn').replace(/\/$/, '');
}

// 拿 tenant_access_token（缓存到过期前 60s）。未配置或鉴权失败给清晰错误，不空等。
export async function getTenantAccessToken() {
  if (!feishuConfigured()) {
    throw new Error('飞书未配置：backend/.env 缺 FEISHU_APP_ID / FEISHU_APP_SECRET');
  }
  const now = Date.now();
  if (cached.token && now < cached.exp - 60_000) return cached.token;

  const res = await fetch(`${feishuBase()}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET,
    }),
  });
  const j = await res.json();
  if (j.code !== 0 || !j.tenant_access_token) {
    throw new Error(`飞书鉴权失败(${j.code}): ${j.msg || '未知错误'}`);
  }
  cached = { token: j.tenant_access_token, exp: now + (j.expire || 7200) * 1000 };
  return cached.token;
}

// 统一的飞书 API 调用：自动带 token、拼 query、解析 { code, msg, data }。
// preferUser=true：优先用【用户授权令牌】（取料读个人文档用），没连接/失败则退回应用令牌（读共享文档）。
// 私信机器人（收发消息）不传 preferUser，始终用应用身份。
// code!==0 抛出带 code/msg 的错误（上层可按 code 区分权限不足 vs 资源不存在，给用户具体指引）。
export async function feishuFetch(path, { method = 'GET', query = null, body = null, preferUser = false } = {}) {
  let token = null;
  if (preferUser) {
    try {
      const { getUserAccessTokenIfConnected } = await import('./feishu-user-auth.js');
      token = await getUserAccessTokenIfConnected();
    } catch { /* 退回应用令牌 */ }
  }
  if (!token) token = await getTenantAccessToken();
  const url = new URL(feishuBase() + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (j.code != null && j.code !== 0) {
    const err = new Error(`飞书 API ${path} 失败(${j.code}): ${j.msg || ''}`);
    err.feishuCode = j.code;
    throw err;
  }
  return j.data ?? j;
}
