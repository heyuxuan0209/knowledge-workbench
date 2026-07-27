import { getDatabase } from '../db/init.js';

// 精选（第三刀·「全部」视图顶部）：从干净池子（archived=0）按**可解释信号**挑主条。
// 哲学（同 must-read）：不做自动学习/负优化，只用透明信号排序 + 用户显式 mute 过滤。每条带「为什么入选」。
// 复用 must-read 的 mute 存储（app_meta:mustread_mutes），扩展 categories 级——精选/必看的「少推」互通。
const MUTE_KEY = 'mustread_mutes';
function readMutes(db) {
  const r = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(MUTE_KEY);
  try { const m = JSON.parse(r?.value || '{}'); return { sources: new Set(m.sources || []), contents: new Set(m.contents || []), categories: new Set(m.categories || []) }; }
  catch { return { sources: new Set(), contents: new Set(), categories: new Set() }; }
}
const isOff = t => t === 'T1' || t === 'T1.5';
function freshness(created) {
  const t = new Date(/[zZ+]/.test(created || '') ? created : (created || '').replace(' ', 'T') + 'Z').getTime();
  if (!t) return 0;
  const days = (Date.now() - t) / 864e5;
  if (days < 2) return 18; if (days < 5) return 12; if (days < 10) return 6; return 0;
}

// 精选打分：多源同报 > 官方一手 / 你登记的源，叠加新鲜度。信号可解释、可在返回的 why 里看到。
export function getCurated(limit = 12) {
  const db = getDatabase();
  const mutes = readMutes(db);
  const rows = db.prepare(`
    SELECT c.id, COALESCE(c.zh_title, c.en_title) title, c.zh_summary summ, c.url, c.permalink,
           c.published_at, c.created_at, c.category, c.source_id, c.source_app,
           s.display_name src, s.registered_by_user reg, s.trust_tier tier,
           (SELECT COUNT(DISTINCT c2.source_id) FROM stories st JOIN story_contents sc2 ON sc2.story_id = st.id
              JOIN contents c2 ON c2.id = sc2.content_id
              WHERE st.primary_content_id = c.id AND c2.archived = 0 AND c2.source_id IS NOT NULL) sc
    FROM contents c LEFT JOIN sources s ON s.id = c.source_id
    WHERE c.archived = 0 AND c.source_app != 'github_trending' AND COALESCE(c.zh_title, c.en_title) IS NOT NULL
    ORDER BY julianday(c.created_at) DESC LIMIT 250
  `).all();
  db.close();

  const scored = [];
  for (const c of rows) {
    if (mutes.contents.has(c.id)) continue;
    if (c.source_id && mutes.sources.has(c.source_id)) continue;
    if (c.category && mutes.categories.has(c.category)) continue;
    let score = freshness(c.created_at), why = 'AI 精选';
    if (c.sc && c.sc > 1) { score += 28 + c.sc * 2; why = `${c.sc} 源同报 · 今日热点`; }
    else if (isOff(c.tier)) { score += 18; why = '官方一手'; }
    if (c.reg) { score += 22; if (!(c.sc > 1)) why = '你关注的一手源新作'; }
    scored.push({ c, score, why });
  }
  scored.sort((a, b) => b.score - a.score);

  // 每源最多 1 条：精选要多样，不能被单个源刷屏（否则成了"某人专场"）
  const top = [], seenSrc = new Set();
  for (const it of scored) {
    const k = it.c.source_id || it.c.src || it.c.id;
    if (seenSrc.has(k)) continue;
    seenSrc.add(k); top.push(it);
    if (top.length >= limit) break;
  }

  return top.map(({ c, why }) => ({
    id: c.id, title: c.title, summary: (c.summ || '').slice(0, 220), src: c.src || 'AI HOT',
    sourceId: c.source_id, category: c.category, url: c.url, permalink: c.permalink, why,
    badge: c.sc > 1 ? { t: `${c.sc} 源同报`, cls: 'cl' } : (isOff(c.tier) ? { t: '官方一手', cls: 'of' } : (c.reg ? { t: '你登记的源', cls: 'rg' } : null)),
    pub: (c.published_at || c.created_at || '').slice(0, 10),
  }));
}

// 需求3·「N 源同报」可点看是哪些源：给 content_id（事件簇主条）→ 返回该事件全部成员（源+标题+链接）。
export function getStoryMembers(contentId) {
  const db = getDatabase();
  const row = db.prepare('SELECT story_id FROM story_contents WHERE content_id=?').get(contentId)
    || db.prepare('SELECT id AS story_id FROM stories WHERE primary_content_id=?').get(contentId);
  if (!row) { db.close(); return []; }
  const mem = db.prepare(`
    SELECT c.id, COALESCE(s.display_name, c.source_app, '未知源') src, s.trust_tier tier,
           COALESCE(c.zh_title, c.en_title) title, c.url, c.permalink
    FROM story_contents sc JOIN contents c ON c.id = sc.content_id LEFT JOIN sources s ON s.id = c.source_id
    WHERE sc.story_id = ?
    ORDER BY CASE s.trust_tier WHEN 'T1' THEN 0 WHEN 'T1.5' THEN 1 ELSE 2 END, c.id`).all(row.story_id);
  db.close();
  return mem.map(m => ({ id: m.id, src: m.src, tier: m.tier, title: (m.title || '').slice(0, 70), url: m.url, permalink: m.permalink }));
}

// 需求2·话题卡：同一事件的活跃成员（各源+标题+摘要），distinct 源数（不算同源多条）。
function storyAliveMembers(db, storyId) {
  return db.prepare(`
    SELECT c.id, COALESCE(s.display_name, c.source_app, '未知源') src, s.trust_tier tier, c.source_id,
           COALESCE(c.zh_title, c.en_title) title, c.zh_summary summ, c.url, c.permalink
    FROM story_contents sc JOIN contents c ON c.id = sc.content_id LEFT JOIN sources s ON s.id = c.source_id
    WHERE sc.story_id = ? AND c.archived = 0
    ORDER BY CASE s.trust_tier WHEN 'T1' THEN 0 WHEN 'T1.5' THEN 1 ELSE 2 END, c.id`).all(storyId);
}

// 生成事件簇「AI 综合总结」（每簇一次、缓存到 stories.digest）：综合各源，给整体图景不逐条复述。
async function ensureStoryDigest(db, story, members) {
  if (story.digest) return story.digest;
  const { chat } = await import('./llm.js');
  const list = members.slice(0, 8).map((m, i) => `${i + 1}. [${m.src}] ${m.title}${m.summ ? ' —— ' + m.summ.slice(0, 120) : ''}`).join('\n');
  const prompt = `以下是同一件事的多个来源报道。综合它们，用中文写一段 100-150 字总结：**这件事是什么、有什么共识或不同角度**。给整体图景，不要逐条复述"某某源说"，别编造。只输出总结正文。

${list}`;
  const r = await chat([{ role: 'user', content: prompt }]);
  const digest = r.success ? r.content.trim() : null;
  if (digest) db.prepare("UPDATE stories SET digest=? WHERE id=?").run(digest, story.id);
  return digest;
}

// 话题卡列表：真·多源（distinct 源>1）且有活跃内容的事件簇 → 综合总结 + 成员。ensure=true 时补生成缺失的 digest。
export async function getTopicCards({ ensure = false } = {}) {
  const db = getDatabase();
  const stories = db.prepare(`
    SELECT st.id, st.headline, st.digest, st.primary_content_id,
           (SELECT COUNT(DISTINCT c.source_id) FROM story_contents sc JOIN contents c ON c.id=sc.content_id
            WHERE sc.story_id=st.id AND c.archived=0 AND c.source_id IS NOT NULL) dsrc
    FROM stories st ORDER BY st.last_updated_at DESC`).all();
  const cards = [];
  for (const st of stories) {
    if (st.dsrc <= 1) continue; // 同源多条不算多源、不成话题卡
    const members = storyAliveMembers(db, st.id);
    if (members.length < 2) continue;
    let digest = st.digest;
    if (!digest && ensure) digest = await ensureStoryDigest(db, st, members);
    cards.push({
      id: st.id, headline: st.headline, digest, sourceCount: st.dsrc,
      members: members.map(m => ({ id: m.id, src: m.src, tier: m.tier, title: (m.title || '').slice(0, 70), url: m.url, permalink: m.permalink })),
    });
  }
  db.close();
  return cards;
}

// 「调精选」面板数据：必进精选的源（你登记的）+ 当前被 mute 的源/主题——供白黑名单管理。
export function getCurateConfig() {
  const db = getDatabase();
  const mutes = readMutes(db);
  const regSources = db.prepare("SELECT s.id, s.display_name name FROM sources s WHERE s.registered_by_user=1 AND s.status='active' ORDER BY s.display_name").all();
  const cats = db.prepare("SELECT DISTINCT category FROM contents WHERE archived=0 AND category IS NOT NULL AND source_app!='github_trending' AND category IN ('模型','产品','行业','观点','其他')").all().map(r => r.category);
  const mutedSrcNames = mutes.sources.size ? db.prepare(`SELECT id, display_name name FROM sources WHERE id IN (${[...mutes.sources].map(() => '?').join(',')})`).all(...mutes.sources) : [];
  db.close();
  return {
    sources: regSources.map(s => ({ id: s.id, name: s.name, muted: mutes.sources.has(s.id) })),
    categories: cats.map(c => ({ name: c, muted: mutes.categories.has(c) })),
    mutedSources: mutedSrcNames,
  };
}

// mute / 取消 mute（源 / 主题category / 内容级）——显式过滤，可撤销，不回喂调权重。
export function setCurateMute({ sourceId = null, category = null, contentId = null, on = true } = {}) {
  const db = getDatabase();
  const r = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(MUTE_KEY);
  let m; try { m = JSON.parse(r?.value || '{}'); } catch { m = {}; }
  m.sources = new Set(m.sources || []); m.contents = new Set(m.contents || []); m.categories = new Set(m.categories || []);
  const apply = (set, key) => { if (key == null) return; on ? set.add(key) : set.delete(key); };
  apply(m.sources, sourceId); apply(m.categories, category); apply(m.contents, contentId);
  db.prepare('INSERT OR REPLACE INTO app_meta(key, value) VALUES(?, ?)').run(MUTE_KEY,
    JSON.stringify({ sources: [...m.sources], contents: [...m.contents], categories: [...m.categories] }));
  db.close();
  return { ok: true };
}
