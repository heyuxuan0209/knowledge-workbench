import { getDatabase } from '../db/init.js';
import { cosine } from './embeddings.js';
import { getStories } from './story-clustering.js';

// 今日必看（P1 层4 · ADR-040）：双通道配额制，**不融合总分**——两种诉求目标函数不同，
// 融合成一个分会互相稀释且不可解释。配额/阈值全是代码里的数字，理由分别标注、可说人话。
//   · 行业大事通道（2 条）：事件簇 top，分 = 簇大小 × AIHOT 分 × 信任加权（保证没追踪的大事不漏）
//   · 个人相关通道（2-3 条）：L2 行为画像向量匹配过阈值（贴合你近期真在看的）
// 兴趣画像只用"噪音进不去的信号层"（ADR-040）：
//   L1 追踪主题 = P3 前为空，先不接；L3 全量沉淀 = 先不用；
//   **L2 行为锚点**：近 60 天有真实动作的对象（星标内容 / 存下的素材[精读·归位]），带时间衰减——
//   测试垃圾的特征恰是"存了再没碰"，60 天衰减 + 只取有向量的行为对象，自动沉底。
// 反馈只做显式 mute（源/内容级"没兴趣"），**不做自动学习调权重**（卡兹克 V7→V8 负优化红线）。

const MUTE_KEY = 'mustread_mutes';
const REL_THRESHOLD = 0.5;   // bge-m3 归一化余弦，≥0.5 算"贴合"（与 recommend.js 一致）
const ANCHOR_WINDOW_DAYS = 60;
const CAND_WINDOW_DAYS = 5;
const DECAY_TAU = 45;        // 时间衰减常数（天）：约 30 天权重减半

function tsMs(iso) { return new Date(/[zZ+]/.test(iso || '') ? iso : `${iso}Z`).getTime() || 0; }

export function getMutes(db) {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(MUTE_KEY);
  try {
    const m = row ? JSON.parse(row.value) : {};
    return { sources: new Set(m.sources || []), contents: new Set(m.contents || []) };
  } catch { return { sources: new Set(), contents: new Set() }; }
}

// 显式 mute：记源/内容级"没兴趣"，只过滤、不回喂调权重
export function addMute({ sourceId = null, contentId = null } = {}) {
  const db = getDatabase();
  const cur = getMutes(db);
  if (sourceId) cur.sources.add(sourceId);
  if (contentId) cur.contents.add(contentId);
  const val = JSON.stringify({ sources: [...cur.sources].slice(-500), contents: [...cur.contents].slice(-500) });
  db.prepare("INSERT OR REPLACE INTO app_meta(key, value) VALUES(?, ?)").run(MUTE_KEY, val);
  db.close();
  return { muted: true };
}

// 行业大事通道：事件簇 top（簇大小 × AIHOT 分 × 信任加权，全是代码里的数字）
function industryPicks(stories, quota, muted) {
  const trustBoost = t => (t === 'T1' ? 1.3 : t === 'T1.5' ? 1.15 : 1);
  const tierTag = t => (t === 'T1' ? ' · 官方一手' : t === 'T1.5' ? ' · 官方号' : '');
  return stories
    .filter(s => s.source_count >= 2 && s.members?.[0] && !muted.contents.has(s.members[0].id))
    .map(s => {
      const p = s.members[0]; // 主条（getStories 已按信任档排序）
      const maxScore = Math.max(0, ...s.members.map(m => m.external_score || 0));
      const score = s.source_count * (1 + maxScore / 50) * trustBoost(p.trust_tier);
      return { s, p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, quota)
    .map(({ s, p }) => ({
      id: p.id, title: p.zh_title || p.en_title, url: p.url,
      channel: 'industry',
      reason: `今日行业大事 · ${s.source_count} 个来源在说${tierTag(p.trust_tier)}`,
      sourceCount: s.source_count, sourceId: null,
    }));
}

// 个人相关通道：L2 行为锚点向量匹配（星标内容 + 近 60 天存下的素材），时间衰减
function personalPicks(db, quota, muted, excludeIds) {
  const anchors = [];
  const push = (rows, kind) => {
    for (const r of rows) {
      try {
        const v = JSON.parse(r.embedding);
        if (!Array.isArray(v) || !v.length) continue;
        const ageD = Math.max(0, (Date.now() - tsMs(r.ts)) / 86400000);
        anchors.push({ vec: v, title: r.title || '', decay: Math.exp(-ageD / DECAY_TAU), kind });
      } catch { /* 跳过坏向量 */ }
    }
  };
  push(db.prepare(`
    SELECT id, COALESCE(zh_title, en_title) AS title, embedding, COALESCE(updated_at, created_at) AS ts
    FROM contents WHERE starred = 1 AND embedding IS NOT NULL
      AND datetime(COALESCE(updated_at, created_at)) > datetime('now', '-${ANCHOR_WINDOW_DAYS} days')
  `).all(), 'star');
  push(db.prepare(`
    SELECT COALESCE(title, source_title) AS title, embedding, created_at AS ts
    FROM notes WHERE embedding IS NOT NULL
      AND datetime(created_at) > datetime('now', '-${ANCHOR_WINDOW_DAYS} days')
  `).all(), 'note');
  if (!anchors.length) return [];

  const cands = db.prepare(`
    SELECT c.id, COALESCE(c.zh_title, c.en_title) AS title, c.url, c.permalink, c.embedding, c.source_id
    FROM contents c
    WHERE c.source_app != 'github_trending' AND c.embedding IS NOT NULL AND c.starred = 0
      AND datetime(COALESCE(c.published_at, c.created_at)) > datetime('now', '-${CAND_WINDOW_DAYS} days')
      AND c.id NOT IN (SELECT content_id FROM notes WHERE content_id IS NOT NULL)
  `).all();

  const picks = [];
  for (const c of cands) {
    if (excludeIds.has(c.id) || muted.contents.has(c.id) || (c.source_id && muted.sources.has(c.source_id))) continue;
    let cv; try { cv = JSON.parse(c.embedding); } catch { continue; }
    if (!Array.isArray(cv) || !cv.length) continue;
    let bestRaw = -1, bestDecayed = -1, bestTitle = null;
    for (const a of anchors) {
      const raw = cosine(cv, a.vec);
      const decayed = raw * a.decay;
      if (decayed > bestDecayed) { bestDecayed = decayed; bestRaw = raw; bestTitle = a.title; }
    }
    if (bestRaw >= REL_THRESHOLD) picks.push({ c, score: bestDecayed, anchorTitle: bestTitle });
  }
  picks.sort((a, b) => b.score - a.score);
  return picks.slice(0, quota).map(p => ({
    id: p.c.id, title: p.c.title, url: p.c.permalink || p.c.url,
    channel: 'personal',
    reason: `贴合你近期在看的《${(p.anchorTitle || '').slice(0, 16)}》`,
    sourceId: p.c.source_id,
  }));
}

// 双通道拼装：行业在前、个人在后；个人排掉已在行业通道的，各带各的理由。
export function getMustRead({ industryQuota = 2, personalQuota = 3 } = {}) {
  const stories = getStories(10); // 自管连接
  const db = getDatabase();
  try {
    const muted = getMutes(db);
    const industry = industryPicks(stories, industryQuota, muted);
    const exclude = new Set(industry.map(x => x.id));
    const personal = personalPicks(db, personalQuota, muted, exclude);
    return [...industry, ...personal];
  } finally {
    db.close();
  }
}
