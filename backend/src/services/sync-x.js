import { execFile } from 'child_process';
import { promisify } from 'util';
import { getDatabase } from '../db/init.js';
import { randomUUID } from 'crypto';
import { upsertContents } from '../db/contents.js';
import { classifyTrustTier } from './trust-tier.js';

const pexec = promisify(execFile);

// sync-x 直连通道（第4件 · docs/x-following-precheck.md · ADR-014/017 路由）：
// 名单 = 库里 platform='X' track_mode='active-query' 的作者源（盘点 B 组建的 + C 组官方 + 用户自助添加），
// 上限 ≤35、每日 1-2 次、纯只读、温和节奏。执行器：twitter-cli 优先（需用户配 cookies 装 agent-reach twitter 通道）；
// 未配期间优雅跳过（不阻塞其它同步），配好后自动生效。与 aihot 重复靠事件簇 + URL 去重（upsert 稳定 id + 聚簇兜底）。

const ROSTER_CAP = 35;
const X_CLI = process.env.X_CLI || 'tw';        // agent-reach twitter 通道 CLI（可 env 覆盖）
const PER_ACCOUNT = 5;

// C 组头部官方账号（§C 定稿，官方 T1.5；不自动置 followed——进 feed 组1 靠 trust）。
// 实现时以官方认证 handle 为准；这里按定稿写入，可随信源页自助添加扩充。
const OFFICIAL_C = [
  { handle: 'OpenAI', name: 'OpenAI' }, { handle: 'sama', name: 'Sam Altman' }, { handle: 'gdb', name: 'Greg Brockman' },
  { handle: 'OpenAIDevs', name: 'OpenAI Developers' }, { handle: 'ChatGPTapp', name: 'ChatGPT' },
  { handle: 'GoogleDeepMind', name: 'Google DeepMind' }, { handle: 'claudeai', name: 'Claude' },
  { handle: 'ClaudeDevs', name: 'Claude Devs' }, { handle: 'GeminiApp', name: 'Gemini' },
];

const nowIso = () => new Date().toISOString();

// 确保 C 组官方账号在库（幂等）——建作者源、X/active-query、trust 由分类器判（多为 T1.5）
export function seedOfficialXAccounts() {
  const db = getDatabase();
  const findPlat = db.prepare("SELECT source_id, track_mode FROM source_platforms WHERE platform='X' AND handle=? COLLATE NOCASE");
  const insSrc = db.prepare("INSERT INTO sources (id, source_type, display_name, registered_by_user, status, trust_tier) VALUES (?,?,?,0,'active',?)");
  const insPlat = db.prepare("INSERT INTO source_platforms (source_id, platform, handle, track_mode) VALUES (?, 'X', ?, 'active-query')");
  const upgrade = db.prepare("UPDATE source_platforms SET track_mode='active-query' WHERE source_id=? AND platform='X' AND handle=? COLLATE NOCASE");
  let added = 0, upgraded = 0;
  for (const c of OFFICIAL_C) {
    const ex = findPlat.get(c.handle);
    if (ex) { // 已有（多为 aihot 带来的 passive 源）→ 升级进采集名单
      if (ex.track_mode !== 'active-query') { upgrade.run(ex.source_id, c.handle); upgraded++; }
      continue;
    }
    const tier = classifyTrustTier({ sourceType: 'Person', platform: 'X', handle: c.handle, displayName: c.name });
    const id = randomUUID(); insSrc.run(id, 'Person', c.name, tier); insPlat.run(id, c.handle); added++;
  }
  db.close();
  return { added, upgraded };
}

// 采集名单（≤35）：X active-query 作者源
export function getXRoster() {
  const db = getDatabase();
  const rows = db.prepare(`SELECT s.id, s.display_name name, sp.handle FROM sources s JOIN source_platforms sp ON sp.source_id=s.id
    WHERE sp.platform='X' AND sp.track_mode='active-query' AND s.status='active' ORDER BY s.registered_by_user DESC, s.created_at ASC`).all();
  db.close();
  return rows;
}

// 自助添加 X 账号（第4件硬需求）：建作者级信源 → 入采集名单。超上限返回 overLimit 让前端提示取舍。
export function addXAccount({ handle, name } = {}) {
  const h = String(handle || '').trim().replace(/^@/, '').replace(/^https?:\/\/(x|twitter)\.com\//i, '').split(/[/?]/)[0];
  if (!h) throw new Error('handle 必填');
  const db = getDatabase();
  const exist = db.prepare("SELECT source_id, track_mode FROM source_platforms WHERE platform='X' AND handle=? COLLATE NOCASE").get(h);
  if (exist) {
    // 已有该 X 源但不在采集名单（多为 aihot 带来的 passive 源）→ 升级为 active-query 入名单
    if (exist.track_mode !== 'active-query') db.prepare("UPDATE source_platforms SET track_mode='active-query' WHERE source_id=? AND platform='X' AND handle=? COLLATE NOCASE").run(exist.source_id, h);
    db.close();
    return { existed: true, addedToRoster: exist.track_mode !== 'active-query', handle: h };
  }
  const rosterN = db.prepare("SELECT COUNT(*) c FROM source_platforms WHERE platform='X' AND track_mode='active-query'").get().c;
  if (rosterN >= ROSTER_CAP) { db.close(); return { overLimit: true, cap: ROSTER_CAP, current: rosterN, handle: h }; }
  const dn = (name || h).trim();
  const tier = classifyTrustTier({ sourceType: 'Person', platform: 'X', handle: h, displayName: dn });
  const id = randomUUID();
  db.prepare("INSERT INTO sources (id, source_type, display_name, registered_by_user, status, trust_tier) VALUES (?,?,?,1,'active',?)").run(id, 'Person', dn, tier);
  db.prepare("INSERT INTO source_platforms (source_id, platform, handle, track_mode) VALUES (?, 'X', ?, 'active-query')").run(id, h);
  db.close();
  return { added: true, handle: h, trust_tier: tier };
}

// 单账号拉最新推文（twitter-cli 优先，未配则优雅报错由上层跳过）。期望 JSON：{data:[{id,text,url,created_at,likes}]}
async function queryX(handle, limit = PER_ACCOUNT) {
  const { stdout } = await pexec(X_CLI, ['user-tweets', handle, '-n', String(limit), '--json'], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  const out = JSON.parse(stdout);
  const arr = out.data || out.tweets || [];
  return arr.map(t => ({
    content: {
      id: `x-${t.id || t.tweet_id}`, content_type: 'tweet',
      url: t.url || `https://x.com/${handle}/status/${t.id}`,
      published_at: t.created_at || null, original_lang: 'unknown', has_translation: 0,
      zh_title: null, en_title: (t.text || '').slice(0, 140), en_summary: (t.text || '').slice(0, 500) || null,
      input_method: 'feed', source_app: 'x', fetch_status: 'success',
      external_score: t.likes ?? t.favorite_count ?? null, created_at: nowIso(), updated_at: nowIso(),
    },
    sourceInfo: { platform: 'X', handle, displayName: handle },
  }));
}

// 全量跑 sync-x（温和节奏、按源隔离）。未配 CLI/cookies 时逐源优雅失败、整体不阻塞。
export async function syncX({ limit = PER_ACCOUNT } = {}) {
  seedOfficialXAccounts();
  const roster = getXRoster().slice(0, ROSTER_CAP);
  if (!roster.length) return { accounts: 0, inserted: 0, skipped: [] };
  const items = []; const skipped = [];
  for (const src of roster) {
    try { items.push(...await queryX(src.handle, limit)); }
    catch (err) { skipped.push({ handle: src.handle, reason: (err.stderr || err.message || '').toString().slice(0, 120) }); }
    await new Promise(r => setTimeout(r, 1500)); // 温和节奏
  }
  const inserted = items.length ? upsertContents(items) : 0;
  if (skipped.length === roster.length) console.log(`[sync-x] 全部 ${roster.length} 源跳过（多半未配 X 采集通道 cookies）`);
  else console.log(`[sync-x] ${roster.length} 源 · 入库 ${inserted} 条 · 跳过 ${skipped.length}`);
  return { accounts: roster.length, inserted, skipped };
}
