import { getDatabase } from '../db/init.js';
import { randomUUID } from 'crypto';
import { classifyTrustTier } from './trust-tier.js';

// 关注盘点 v2（第2件 · docs/x-following-precheck.md 完整重拉 95 个 · §D）：
// 核心原则——X 关注 ≠ 工作台信源。大众媒体/名人默认不采集（非 AI 噪音 + sync-x ≤35 上限），
// 盘点面板就是做这层筛选。三档：
//   A 已匹配库内源（37，预勾）· B1 建议采集（18 AI/科技作者，默认预勾、确认时建 active-query 源）·
//   B2 默认不采集（40 媒体/名人，灰置底、默认不勾，勾了只建 passive 源不进采集）。
// fix_mappings：@claudeai 建「Claude 官方」勿并入 Claude Devs；@OpenAI 主号单独建源勿并入 OpenAI Developers；
//   @bcherny+@BorisChy 同人合并（互为别名）；剔除 v1 子串误配（Wharton→arto、TIME→商汤）——v2 一律精确 handle 匹配。

// A 组：matched_handles → 显示名（37）。claudeai/OpenAI 用 fix 名，库里没有则新建为独立源。
const MATCHED = {
  yaojingang: '姚金刚', AnatoliKopadze: 'Anatoli Kopadze', AnthropicAI: 'Anthropic', adityaag: 'Aditya Agarwal',
  danshipper: 'Dan Shipper', steipete: 'Peter Steinberger', nikunj: 'Nikunj Kothari', mattturck: 'Matt Turck',
  garrytan: 'Garry Tan', ryolu_: 'Ryo Lu', rauchg: 'Guillermo Rauch', amasad: 'Amjad Masad', GoogleLabs: 'Google Labs',
  AmandaAskell: 'Amanda Askell', petergyang: 'Peter Yang', BorisChy: 'Boris Cherny', bcherny: 'Boris Cherny',
  joshwoodward: 'Josh Woodward', maxjjiang: '麦克斯', rohanpaul_ai: 'Rohan Paul', NainsiDwiv50980: 'Nainsi Dwivedi',
  aparnadhinak: 'Aparna Dhinakaran', thenanyu: 'Nan Yu', trq212: 'Thariq', Khazix0918: '数字生命卡兹克',
  GoogleAI: 'Google AI', demishassabis: 'Demis Hassabis', AIatMeta: 'AI at Meta', zarazhangrui: 'Zara Zhang',
  thsottiaux: 'Tibo', levie: 'Aaron Levie', gdb: 'Greg Brockman', GoogleDeepMind: 'Google DeepMind',
  karpathy: 'Andrej Karpathy', sama: 'Sam Altman', OpenAI: 'OpenAI', claudeai: 'Claude 官方',
};
// B1 组：suggest_new → 显示名（18 AI/科技作者，默认预勾、建 active-query 采集源）
const SUGGEST_NEW = {
  oran_ge: 'Orange AI', shao__meng: 'meng shao', FinanceYF5: 'AI Will', eladgil: 'Elad Gil', FinnTsai88: 'Florian.C',
  vista8: '向阳乔木', AndrewYNg: 'Andrew Ng', LumaLabsAI: 'Luma', _akhaliq: 'AK', ylecun: 'Yann LeCun',
  GergelyOrosz: 'Gergely Orosz', RLanceMartin: 'Lance Martin', SVScholar: '硅谷居士', turingou: '郭宇',
  Austen: 'Austen Allred', yishan: 'Yishan', balajis: 'Balaji', PalmerLuckey: 'Palmer Luckey',
};
// B2 组：excluded_default → 显示名（40 媒体/名人，默认不勾、灰置底；勾了只建 passive、不进 sync-x 采集）
const EXCLUDED = {
  TIME: 'TIME', Wharton: 'Wharton', ftfinancenews: 'FT Finance', GoldmanSachs: 'Goldman Sachs', EricTrump: 'Eric Trump',
  tim_cook: 'Tim Cook', Bloomberg: 'Bloomberg', business: 'Bloomberg Business', NASA_Technology: 'NASA Technology',
  NASAMars: 'NASA Mars', NASA: 'NASA', McKinsey_MGI: 'McKinsey MGI', TEDTalks: 'TED', BillClinton: 'Bill Clinton',
  X: 'X 官方', NatGeo: 'National Geographic', HarvardBiz: 'Harvard Business Review', TheEconomist: 'The Economist',
  BBCWorld: 'BBC World', BBCNews: 'BBC News', BBCBreaking: 'BBC Breaking', FoxNews: 'Fox News', Forbes: 'Forbes',
  realDonaldTrump: 'Donald Trump', FT: 'Financial Times', cnni: 'CNN International', cnnbrk: 'CNN Breaking', CNN: 'CNN',
  AP: 'AP News', BillGates: 'Bill Gates', WHO: 'WHO', elonmusk: 'Elon Musk', CNBC: 'CNBC', nytimes: 'New York Times',
  WSJ: 'Wall Street Journal', ABC: 'ABC News', UN: 'United Nations', Tesla: 'Tesla', washingtonpost: 'Washington Post',
  SpaceX: 'SpaceX',
};
// 同人合并：别名 handle → 主 handle（保留主源，别名并入为它的第二个 platform 行）
const ALIAS_MERGE = { bcherny: 'BorisChy' };

// sync-x 上限设计（ADR-048）：硬 35 作废 → 软上限 80（仅提示不拦截）+ 分级轮换（每日必拉 20 / 总封顶 40）
const SOFT_CAP = 80, DAILY_MUST = 20, DAILY_TOTAL = 40;
const norm = (s) => String(s || '').trim().toLowerCase();
const matchedSet = new Set(Object.keys(MATCHED).map(norm));
const matchedNames = new Set(Object.values(MATCHED).map(norm));
const excludedSet = new Set(Object.keys(EXCLUDED).map(norm));

// 收拾灰色「X · 借道推送」（passive X 源，用户盘点后手动请求）：
// ① 是你 X 关注的真作者（matched∪suggest）→ 升成「每日主动查询」并置 followed（替你关注、去灰）；
// ② 有同名 active-query 源的重复借道项 → 归档并把内容并入 active 源（去重）；
// ③ 其余灰色借道（AI HOT 顺带带来、非你关注）→ 归档（从信源页消失、内容保留，可恢复）。
export function cleanupPassiveX() {
  const wanted = new Set([...Object.keys(MATCHED), ...Object.keys(SUGGEST_NEW)].map(norm));
  const db = getDatabase();
  const activeQ = new Set(db.prepare("SELECT sp.handle FROM sources s JOIN source_platforms sp ON sp.source_id=s.id WHERE sp.platform='X' AND sp.track_mode='active-query' AND s.status='active'").all().map(r => norm(r.handle)));
  const rows = db.prepare("SELECT s.id, sp.handle FROM sources s JOIN source_platforms sp ON sp.source_id=s.id WHERE sp.platform='X' AND sp.track_mode='passive' AND s.status='active'").all();
  const findActiveQ = db.prepare("SELECT sp.source_id FROM source_platforms sp JOIN sources s ON s.id=sp.source_id WHERE sp.platform='X' AND sp.handle=? COLLATE NOCASE AND sp.track_mode='active-query' AND s.status='active'");
  let followed = 0, deduped = 0, archived = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const h = norm(r.handle);
      if (activeQ.has(h)) { // ② 重复借道 → 内容并入 active 源、本源归档
        const tgt = findActiveQ.get(r.handle);
        if (tgt && tgt.source_id !== r.id) {
          db.prepare("UPDATE contents SET source_id=? WHERE source_id=?").run(tgt.source_id, r.id);
          db.prepare("UPDATE sources SET status='archived', registered_by_user=0, updated_at=datetime('now') WHERE id=?").run(r.id);
          deduped++; continue;
        }
      }
      if (wanted.has(h)) { // ① 你的真作者 → 升采集 + 关注（去灰）
        db.prepare("UPDATE source_platforms SET track_mode='active-query' WHERE source_id=? AND platform='X'").run(r.id);
        db.prepare("UPDATE sources SET registered_by_user=1, updated_at=datetime('now') WHERE id=?").run(r.id);
        followed++;
      } else { // ③ 其余灰色借道 → 归档
        db.prepare("UPDATE sources SET status='archived', registered_by_user=0, updated_at=datetime('now') WHERE id=?").run(r.id);
        archived++;
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); db.close(); throw e; }
  db.close();
  return { followed, deduped, archived };
}

// 盘点数据（面板直接吃）：库内源分档 + 待新建两档 + N/35 采集计数基线。
export function getFollowAudit() {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT s.id, s.display_name AS name, s.registered_by_user AS followed,
           sp.platform, sp.handle, sp.track_mode,
           (SELECT COUNT(*) FROM contents c WHERE c.source_id=s.id AND datetime(COALESCE(c.published_at,c.created_at))>datetime('now','-30 days')) AS cnt30,
           (SELECT COALESCE(c.zh_title,c.en_title) FROM contents c WHERE c.source_id=s.id ORDER BY datetime(COALESCE(c.published_at,c.created_at)) DESC LIMIT 1) AS latest
    FROM sources s LEFT JOIN source_platforms sp ON sp.source_id=s.id
    WHERE s.status='active'
  `).all();
  db.close();
  const existingHandles = new Set(rows.map(r => norm(r.handle)).filter(Boolean));

  // 库内待裁决项：近 30 天有内容 或 当前已关注。精确 handle 匹配（不再子串误配）。
  const items = rows.filter(r => r.cnt30 > 0 || r.followed).map(r => {
    const h = norm(r.handle);
    const matched = matchedSet.has(h) || matchedNames.has(norm(r.name)); // A 组预勾
    const isMedia = excludedSet.has(h);                                  // 媒体：即便在库也默认不勾、灰置
    const isRoster = r.platform === 'X' && r.track_mode === 'active-query'; // 计入 sync-x N/35
    return {
      id: r.id, name: r.name, platform: r.platform, handle: r.handle, count30d: r.cnt30,
      latest: (r.latest || '').slice(0, 44), followed: !!r.followed,
      precheck: matched && !isMedia, isMedia, isRoster,
    };
  }).sort((a, b) => (b.precheck - a.precheck) || (a.isMedia - b.isMedia) || (b.count30d - a.count30d));

  // A 组匹配但库里没有该精确 handle → 需新建（claudeai/OpenAI 属此列，独立建源不并入 Devs）。
  // 同人合并：一对别名只建一个源——① 别名 key（bcherny）永不单独建；② 若其伙伴 handle 已在库，主号也不重复建。
  const partnerOf = {}; // 双向别名伙伴（bcherny↔BorisChy）
  for (const [a, t] of Object.entries(ALIAS_MERGE)) { (partnerOf[norm(a)] ||= new Set()).add(norm(t)); (partnerOf[norm(t)] ||= new Set()).add(norm(a)); }
  const matchedMissing = Object.keys(MATCHED)
    .filter(h => !existingHandles.has(norm(h)))
    .filter(h => !ALIAS_MERGE[h]) // 别名 key 不单独建（只建主号）
    .filter(h => !(partnerOf[norm(h)] && [...partnerOf[norm(h)]].some(p => existingHandles.has(p)))) // 伙伴已在库→不重复建
    .map(h => ({ handle: h, name: MATCHED[h], kind: 'matched' }));

  // B1 建议采集（默认预勾，建 active-query）；已在库的跳过
  const suggestNew = Object.keys(SUGGEST_NEW)
    .filter(h => !existingHandles.has(norm(h)))
    .map(h => ({ handle: h, name: SUGGEST_NEW[h], kind: 'suggest' }));

  // 合并 A 组缺口 + B1 → 采集档（默认勾、进 sync-x roster）
  const toCreateRoster = [...matchedMissing, ...suggestNew];

  // B2 媒体/名人（默认不勾、灰置底、建 passive 不采集）；已在库的跳过
  const toCreateMedia = Object.keys(EXCLUDED)
    .filter(h => !existingHandles.has(norm(h)))
    .map(h => ({ handle: h, name: EXCLUDED[h], kind: 'media' }));

  // N/35 计数基线：已在库且已选中的 X 采集源（前端按勾选实时算），这里给出上限与合并说明
  const aliasNotes = Object.entries(ALIAS_MERGE)
    .filter(([alias, target]) => existingHandles.has(norm(target)) || matchedSet.has(norm(target)))
    .map(([alias, target]) => ({ alias, target, name: MATCHED[target] || target }));

  return {
    items,
    toCreateRoster,
    toCreateMedia,
    aliasNotes,                 // 面板提示：bcherny 已作为 BorisChy 的别名合并
    precheckCount: items.filter(i => i.precheck).length,
    softCap: SOFT_CAP, dailyMust: DAILY_MUST, dailyTotal: DAILY_TOTAL, // ADR-048 分级轮换：软上限仅提示、每日预算调度
    rosterCreateCount: toCreateRoster.length,
  };
}

// 应用：followed 全量重设为 keepIds；createRoster→active-query 采集源；createMedia→passive 源（都置 followed）。
// 同人合并：别名 handle 作为已有主源的第二个 platform 行写入（不建新源）。
export function applyFollowAudit({ keepIds = [], createRoster = [], createMedia = [] } = {}) {
  const db = getDatabase();
  const keep = new Set(keepIds);
  let created = 0, aliased = 0, merged = 0;
  db.exec('BEGIN');
  try {
    const setFollow = db.prepare("UPDATE sources SET registered_by_user=?, updated_at=datetime('now') WHERE id=?");
    for (const s of db.prepare("SELECT id FROM sources WHERE status='active'").all()) setFollow.run(keep.has(s.id) ? 1 : 0, s.id);

    const findPlat = db.prepare("SELECT source_id FROM source_platforms WHERE platform='X' AND handle=? COLLATE NOCASE");
    const insSrc = db.prepare("INSERT INTO sources (id, source_type, display_name, registered_by_user, status, trust_tier) VALUES (?,?,?,1,'active',?)");
    const insPlat = db.prepare("INSERT INTO source_platforms (source_id, platform, handle, track_mode) VALUES (?, 'X', ?, ?)");

    const createOne = (c, trackMode) => {
      const handle = String(c.handle || c).trim(); if (!handle) return;
      // 同人合并：别名 handle（bcherny）不单独建源——只保留主号 BorisChy 一个源。
      // source_platforms 有 UNIQUE(source_id, platform)，一个源只能挂一个 X handle，故合并=只建一个。
      const mergeTarget = ALIAS_MERGE[handle];
      if (mergeTarget) {
        const tgt = findPlat.get(mergeTarget);
        if (tgt) { setFollow.run(1, tgt.source_id); aliased++; return; }
        // 主号还没建 → 跳过别名（主号会在本轮或已存在时承载此人）
        return;
      }
      const exist = findPlat.get(handle);
      if (exist) {
        // 已在库：升级采集档并置 followed（媒体保持原档，不强升）
        if (trackMode === 'active-query') db.prepare("UPDATE source_platforms SET track_mode='active-query' WHERE source_id=? AND platform='X' AND handle=? COLLATE NOCASE").run(exist.source_id, handle);
        setFollow.run(1, exist.source_id);
        return;
      }
      const name = c.name || handle;
      const tier = classifyTrustTier({ sourceType: 'Person', platform: 'X', handle, displayName: name });
      const id = randomUUID();
      insSrc.run(id, 'Person', name, tier);
      insPlat.run(id, handle, trackMode);
      created++;
    };

    for (const c of createRoster) createOne(c, 'active-query'); // 进 sync-x 采集
    for (const c of createMedia) createOne(c, 'passive');       // 只登记、不采集

    // 同人合并·收拾存量重复：若别名与主号已各自成源（历史遗留），把别名源的内容并入主号、别名源停用。
    // 非破坏性：内容改挂主号、别名源 status='inactive'（不删，可回溯）。用户确认时执行。
    const findActivePlat = db.prepare("SELECT sp.source_id FROM source_platforms sp JOIN sources s ON s.id=sp.source_id WHERE sp.platform='X' AND sp.handle=? COLLATE NOCASE AND s.status='active'");
    for (const [alias, target] of Object.entries(ALIAS_MERGE)) {
      const a = findActivePlat.get(alias), t = findActivePlat.get(target);
      if (a && t && a.source_id !== t.source_id) {
        db.prepare("UPDATE contents SET source_id=? WHERE source_id=?").run(t.source_id, a.source_id);
        db.prepare("UPDATE sources SET status='archived', registered_by_user=0, updated_at=datetime('now') WHERE id=?").run(a.source_id);
        setFollow.run(1, t.source_id);
        merged++;
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); db.close(); throw e; }
  db.close();
  return { kept: keep.size, created, aliased, merged };
}
