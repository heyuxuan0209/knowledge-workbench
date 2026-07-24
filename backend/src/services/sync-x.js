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

// 上限设计变更（ADR-048 · 2026-07-24）：硬上限 35 作废（用户 54/35 被拦）。改为
// 「每日请求预算 + 分级轮换」——名单软上限 80（面板仅提示不拦截）；调度分两级：
// 每日必拉 = C 组官方 + 高优 builder（≈20，按「近30天产出频率 × 用户互动(精读/星标)」自动排），
// 其余进轮换池（每源至少每 2-3 天拉一次）；每日总拉取封顶 ≈40、请求间隔温和。优先级全代码算，无用户手配层。
const SOFT_CAP = 80;         // 名单软上限：仅面板提示，不拦截确认
const DAILY_MUST = 20;       // 每日必拉目标数（含 C 组官方）
const DAILY_TOTAL = 40;      // 每日总拉取封顶（必拉 + 轮换）
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
const officialSet = new Set(OFFICIAL_C.map(c => c.handle.toLowerCase())); // C 组官方 handle（每日必拉，不受打分影响）

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

// 采集名单 + 优先级打分（ADR-048）：score = 近30天产出频率 × 用户互动权重（星标最重、精读次之）。
// 官方 C 组不看分（每日必拉）。last_query_at 供轮换池按最旧优先排队。
export function getXRosterScored() {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT s.id, s.display_name name, sp.handle, sp.last_query_at,
      (SELECT COUNT(*) FROM contents c WHERE c.source_id=s.id AND datetime(COALESCE(c.published_at,c.created_at))>datetime('now','-30 days')) AS freq30,
      (SELECT COUNT(*) FROM contents c WHERE c.source_id=s.id AND c.starred=1) AS stars,
      (SELECT COUNT(*) FROM contents c WHERE c.source_id=s.id AND c.user_read_status='read') AS reads
    FROM sources s JOIN source_platforms sp ON sp.source_id=s.id
    WHERE sp.platform='X' AND sp.track_mode='active-query' AND s.status='active'
  `).all();
  db.close();
  return rows.map(r => {
    const isOfficial = officialSet.has(String(r.handle || '').toLowerCase());
    // 打分：产出频率打底 × (1 + 星标*3 + 精读*1)。互动放大产出，冷门无产出=0 分沉入轮换。
    const score = r.freq30 * (1 + r.stars * 3 + r.reads);
    return { ...r, isOfficial, score };
  });
}
export function getXRoster() { return getXRosterScored(); } // 兼容旧调用

// 当日采集计划（分级）：必拉（官方 + 高优）+ 轮换（其余按最旧优先，填到每日总封顶）。纯读，供面板/调度共用。
export function planXSchedule({ dailyMust = DAILY_MUST, dailyTotal = DAILY_TOTAL } = {}) {
  const roster = getXRosterScored();
  const official = roster.filter(r => r.isOfficial);
  const builders = roster.filter(r => !r.isOfficial).sort((a, b) => b.score - a.score || (a.last_query_at || '').localeCompare(b.last_query_at || ''));
  const must = [...official, ...builders.slice(0, Math.max(0, dailyMust - official.length))];
  const mustSet = new Set(must.map(r => r.handle.toLowerCase()));
  const rotationPool = roster.filter(r => !mustSet.has(r.handle.toLowerCase()))
    .sort((a, b) => (a.last_query_at || '').localeCompare(b.last_query_at || '')); // 最旧（含从未拉过 NULL）优先
  const rotationSlots = Math.max(0, dailyTotal - must.length);
  const rotationToday = rotationPool.slice(0, rotationSlots);
  // 轮换周期：池子多大 ÷ 每天能转几个 → 每源约几天轮到一次
  const cycleDays = rotationSlots > 0 ? Math.max(1, Math.ceil(rotationPool.length / rotationSlots)) : 0;
  return {
    total: roster.length, mustCount: must.length, rotationPoolSize: rotationPool.length,
    rotationPerDay: rotationToday.length, cycleDays, softCap: SOFT_CAP,
    today: [...must, ...rotationToday],
  };
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
  // 软上限（ADR-048）：不再硬拦；到 80 只回一个 softWarn，仍照常添加（分级轮换消化名单）
  const softWarn = rosterN + 1 > SOFT_CAP ? { softCap: SOFT_CAP, current: rosterN + 1 } : null;
  const dn = (name || h).trim();
  const tier = classifyTrustTier({ sourceType: 'Person', platform: 'X', handle: h, displayName: dn });
  const id = randomUUID();
  db.prepare("INSERT INTO sources (id, source_type, display_name, registered_by_user, status, trust_tier) VALUES (?,?,?,1,'active',?)").run(id, 'Person', dn, tier);
  db.prepare("INSERT INTO source_platforms (source_id, platform, handle, track_mode) VALUES (?, 'X', ?, 'active-query')").run(id, h);
  db.close();
  return { added: true, handle: h, trust_tier: tier, softWarn };
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

// 跑 sync-x（ADR-048 分级轮换）：只拉当日计划（必拉 + 轮换，封顶 ≈40），温和节奏、按源隔离。
// 每拉一源即戳 last_query_at（成功/失败都戳——失败也算"轮到过"，避免坏源卡死轮换队头）。
export async function syncX({ limit = PER_ACCOUNT } = {}) {
  seedOfficialXAccounts();
  const plan = planXSchedule();
  const roster = plan.today;
  if (!roster.length) return { accounts: 0, inserted: 0, skipped: [], plan };
  const db = getDatabase();
  const stamp = db.prepare("UPDATE source_platforms SET last_query_at=datetime('now') WHERE source_id=? AND platform='X' AND handle=? COLLATE NOCASE");
  const items = []; const skipped = [];
  for (const src of roster) {
    try { items.push(...await queryX(src.handle, limit)); }
    catch (err) { skipped.push({ handle: src.handle, reason: (err.stderr || err.message || '').toString().slice(0, 120) }); }
    try { stamp.run(src.id, src.handle); } catch { /* 别名/边角源 stamp 失败不阻塞 */ }
    await new Promise(r => setTimeout(r, 1500)); // 温和节奏
  }
  db.close();
  const inserted = items.length ? upsertContents(items) : 0;
  if (skipped.length === roster.length) console.log(`[sync-x] 当日计划 ${roster.length} 源全跳过（多半未配 X 采集通道 cookies）· 必拉 ${plan.mustCount} + 轮换 ${plan.rotationPerDay}（池 ${plan.rotationPoolSize}，每 ${plan.cycleDays} 天一轮）`);
  else console.log(`[sync-x] 当日 ${roster.length} 源（必拉 ${plan.mustCount} + 轮换 ${plan.rotationPerDay}）· 入库 ${inserted} 条 · 跳过 ${skipped.length}`);
  return { accounts: roster.length, inserted, skipped, plan };
}
