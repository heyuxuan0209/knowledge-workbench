import { getDatabase } from '../db/init.js';
import { randomUUID } from 'crypto';
import { classifyTrustTier } from './trust-tier.js';

// 关注盘点（第2件 · docs/x-following-precheck.md）：followed 语义修复——让用户一次性重设关注名单。
// 现状 registered_by_user 名单失真（历史操作/种子留下的一堆非主动关注）。面板列出近 30 天有内容的
// 作者源，预勾 = 从 X following 实拉的 26 个（A 组 17 个库内匹配预勾、B 组 9 个库里没有需新建）。
// 用户确认后 registered_by_user 只保留勾选项；同步注册新源不再自动置 followed（findOrCreateSource 默认 0）。

// §D 机器可读：handle → 显示名（26 个）。B 组=库里没有、需新建作者源的 9 个。
const HANDLE_MAP = { yaojingang: '姚金刚', AnatoliKopadze: 'Anatoli Kopadze', AnthropicAI: 'Anthropic', adityaag: 'Aditya Agarwal', danshipper: 'Dan Shipper', steipete: 'Peter Steinberger', nikunj: 'Nikunj Kothari', mattturck: 'Matt Turck', garrytan: 'Garry Tan', ryolu_: 'Ryo Lu', rauchg: 'Guillermo Rauch', amasad: 'Amjad Masad', GoogleLabs: 'Google Labs', AmandaAskell: 'Amanda Askell', petergyang: 'Peter Yang', BorisChy: 'Boris Cherny', joshwoodward: 'Josh Woodward', maxjjiang: '麦克斯', rohanpaul_ai: 'Rohan Paul', shao__meng: 'meng shao', NainsiDwiv50980: 'Nainsi Dwivedi', aparnadhinak: 'Aparna Dhinakaran', Elara200410: 'Elara', semil: 'Semil', thenanyu: 'Nan Yu', levelsio: 'Pieter Levels' };
const GROUP_B = ['yaojingang', 'AnatoliKopadze', 'maxjjiang', 'shao__meng', 'NainsiDwiv50980', 'aparnadhinak', 'Elara200410', 'semil', 'levelsio'];
const norm = (s) => String(s || '').trim().toLowerCase();
const precheckHandles = new Set(Object.keys(HANDLE_MAP).map(norm));
const precheckNames = new Set(Object.values(HANDLE_MAP).map(norm));

// 盘点数据：近 30 天有内容的作者源（按条数倒序）+ 当前 followed + 是否预勾 + 最近一条标题。
export function getFollowAudit() {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT s.id, s.display_name AS name, s.registered_by_user AS followed,
           sp.platform, sp.handle,
           (SELECT COUNT(*) FROM contents c WHERE c.source_id=s.id AND datetime(COALESCE(c.published_at,c.created_at))>datetime('now','-30 days')) AS cnt30,
           (SELECT COALESCE(c.zh_title,c.en_title) FROM contents c WHERE c.source_id=s.id ORDER BY datetime(COALESCE(c.published_at,c.created_at)) DESC LIMIT 1) AS latest
    FROM sources s LEFT JOIN source_platforms sp ON sp.source_id=s.id
    WHERE s.status='active'
  `).all();
  db.close();
  // 只列近 30 天有内容的 或 当前已关注的（让用户看到全部待裁决项）
  const items = rows.filter(r => r.cnt30 > 0 || r.followed)
    .map(r => {
      const pre = precheckHandles.has(norm(r.handle)) || precheckNames.has(norm(r.name));
      return { id: r.id, name: r.name, platform: r.platform, handle: r.handle, count30d: r.cnt30, latest: (r.latest || '').slice(0, 44), followed: !!r.followed, precheck: pre };
    })
    .sort((a, b) => (b.precheck - a.precheck) || (b.count30d - a.count30d));
  // B 组：库里没有、需新建（预勾）
  const existingHandles = new Set(rows.map(r => norm(r.handle)));
  const toCreate = GROUP_B.filter(h => !existingHandles.has(norm(h))).map(h => ({ handle: h, name: HANDLE_MAP[h] || h }));
  return { items, toCreate, precheckCount: items.filter(i => i.precheck).length };
}

// 应用：followed 只保留 keepIds；createHandles（B 组勾选，X handle）新建作者源并置 followed。
export function applyFollowAudit({ keepIds = [], createHandles = [] } = {}) {
  const db = getDatabase();
  const keep = new Set(keepIds);
  let created = 0;
  db.exec('BEGIN');
  try {
    // 全量重设：勾选→1，其余→0
    const setFollow = db.prepare("UPDATE sources SET registered_by_user=?, updated_at=datetime('now') WHERE id=?");
    for (const s of db.prepare("SELECT id FROM sources WHERE status='active'").all()) setFollow.run(keep.has(s.id) ? 1 : 0, s.id);
    // B 组新建作者源（X 直连名单，等 sync-x 采集）：dedup by platform+handle
    const insSrc = db.prepare("INSERT INTO sources (id, source_type, display_name, registered_by_user, status, trust_tier) VALUES (?,?,?,1,'active',?)");
    const insPlat = db.prepare("INSERT INTO source_platforms (source_id, platform, handle, track_mode) VALUES (?, 'X', ?, 'active-query')");
    const findPlat = db.prepare("SELECT source_id FROM source_platforms WHERE platform='X' AND handle=? COLLATE NOCASE");
    for (const c of createHandles) {
      const handle = String(c.handle || c).trim(); if (!handle) continue;
      const exist = findPlat.get(handle);
      if (exist) { setFollow.run(1, exist.source_id); continue; }
      const name = c.name || handle;
      const tier = classifyTrustTier({ sourceType: 'Person', platform: 'X', handle, displayName: name });
      const id = randomUUID();
      insSrc.run(id, 'Person', name, tier);
      insPlat.run(id, handle);
      created++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); db.close(); throw e; }
  db.close();
  return { kept: keep.size, created };
}
