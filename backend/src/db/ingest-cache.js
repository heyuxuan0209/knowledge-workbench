import { getDatabase } from './init.js';

// 即时分析转写/翻译缓存（ADR-070）：同一条链接第二次解读，直接复用第一次的转写+翻译，
// 不再重下、重转（省 Groq 额度、省等待）。与「即时分析不入库」决策不冲突——这是**性能缓存**、
// 不是资讯库成员（不进 contents，不带 source/embedding/主题归属，纯 URL→结果的 KV）。
// 懒建表：首次使用即建，不依赖迁移脚本被谁执行。

let ready = false;
function ensureTable(db) {
  if (ready) return;
  db.exec(`CREATE TABLE IF NOT EXISTS ingest_cache (
    url_key TEXT PRIMARY KEY,     -- 归一化后的 URL（去跟踪参数/锚点）
    url TEXT,                     -- 原始 URL（留痕）
    payload TEXT NOT NULL,        -- 摄入+翻译结果的 JSON（body/zhBody/zhTitle/metadata/transcript…）
    engine TEXT,                  -- 转写引擎（groq/local/captions），诊断用
    hits INTEGER DEFAULT 0,       -- 命中次数（看缓存值不值）
    created_at TEXT DEFAULT (datetime('now')),
    used_at TEXT DEFAULT (datetime('now'))
  )`);
  ready = true;
}

// URL 归一化：让 ?s=20 这类跟踪参数、锚点、http/https、末尾斜杠不影响命中。
// x/twitter：推文身份在路径的 /status/ID，查询串一律丢；twitter.com 与 x.com 视为同一条。
// youtube：身份是 v 参数，只保留它（youtu.be/ID 也归一到 watch?v=ID）。
// 其它：去锚点 + 去常见跟踪参数，剩余参数排序，保证同一资源同一 key。
const TRACKING = new Set(['s', 't', 'si', 'ref', 'ref_src', 'ref_url', 'feature', 'spm', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']);
export function normalizeUrlKey(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return String(raw).trim(); }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();

  if (/(^|\.)(x|twitter)\.com$/.test(host)) {
    const id = u.pathname.match(/\/status(?:es)?\/(\d+)/)?.[1];
    if (id) return `x:status:${id}`;
    return `https://x.com${u.pathname.replace(/\/$/, '')}`;
  }
  if (/(^|\.)youtube\.com$/.test(host)) {
    const v = u.searchParams.get('v');
    if (v) return `yt:${v}`;
  }
  if (host === 'youtu.be') {
    const v = u.pathname.slice(1);
    if (v) return `yt:${v}`;
  }
  // 通用：host + 路径 + 过滤后的查询串（排序）
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING.has(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  const qs = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '';
  return `${host}${u.pathname.replace(/\/$/, '')}${qs}`;
}

// 命中返回解析后的 payload（并累加 hits/used_at），未命中返回 null。
export function getIngestCache(url) {
  const db = getDatabase();
  ensureTable(db);
  const key = normalizeUrlKey(url);
  const row = db.prepare('SELECT payload FROM ingest_cache WHERE url_key = ?').get(key);
  if (row) {
    db.prepare("UPDATE ingest_cache SET hits = hits + 1, used_at = datetime('now') WHERE url_key = ?").run(key);
  }
  db.close();
  if (!row) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

// 写缓存（upsert）。engine 从 payload.transcriptEngine 或调用方传入，仅诊断。
export function setIngestCache(url, payload, engine = null) {
  const db = getDatabase();
  ensureTable(db);
  const key = normalizeUrlKey(url);
  db.prepare(`INSERT INTO ingest_cache (url_key, url, payload, engine, used_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(url_key) DO UPDATE SET payload = excluded.payload, engine = excluded.engine, used_at = datetime('now')`)
    .run(key, String(url), JSON.stringify(payload), engine);
  db.close();
}

// 主动失效（重解读用）：删一条。返回是否删到。
export function clearIngestCache(url) {
  const db = getDatabase();
  ensureTable(db);
  const r = db.prepare('DELETE FROM ingest_cache WHERE url_key = ?').run(normalizeUrlKey(url));
  db.close();
  return r.changes > 0;
}
