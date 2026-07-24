import { getDatabase } from '../db/init.js';
import { randomUUID } from 'crypto';
import { embedText, cosine, MODEL_NAME } from './embeddings.js';
import { chat } from './llm.js';

// P3 追踪型主题管道（ADR-040 补充的追踪判定契约）：
//  ① 成员判定 = aboutness（主角性）：向量召回（保召回）+ LLM 主角判定（滤词面假阳），每条标"收录理由"。
//  ② 增量归线：LLM 只判"归入已有主线/开新/进零散区"，判据=因果连通性，禁词面归堆；主线 ≤6。
//  ③ 四槽位综述：脉络(事实直白·句级可溯源) / 判断(犀利·标"AI 判断·供你反驳"·不引用) / 待追(中性) / 钩子(接提为灵感)。
//     硬约束：写不进出处的事实句不许出现。条目 ≥8 且成因果链才出综述，否则"攒料中"。

const RECALL_THRESHOLD = 0.35;   // 向量召回宽松（保召回，aboutness 筛假阳）
const RECALL_WINDOW_DAYS = 31;
const MAX_STORYLINES = 6;
const MIN_FOR_SYNTHESIS = 8;

const parseVec = (j) => { try { const v = JSON.parse(j); return Array.isArray(v) && v.length ? v : null; } catch { return null; } };
const extractJson = (t) => { const s = t?.indexOf('{'), e = t?.lastIndexOf('}'); if (s == null || s < 0 || e <= s) return null; try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; } };
const dstr = (iso) => (iso || '').slice(5, 10); // MM-DD

export async function createTrackingTopic({ name, aliases = [], createdBy = 'user' }) {
  const db = getDatabase();
  const id = randomUUID();
  const vec = await embedText([name, ...aliases].join(' / '));
  db.prepare(`INSERT INTO tracking_topics (id, name, aliases, created_by, centroid_embedding, embedding_model) VALUES (?,?,?,?,?,?)`)
    .run(id, name, JSON.stringify(aliases), createdBy, JSON.stringify(vec), MODEL_NAME);
  db.close();
  return { id, name, aliases };
}

export function getTrackingTopicByName(name) {
  const db = getDatabase();
  const t = db.prepare('SELECT * FROM tracking_topics WHERE name = ?').get(name);
  db.close();
  return t;
}

// 列表（mock E）：每个追踪主题带成员数、主线数、本周新增、总览
export function listTrackingTopics() {
  const db = getDatabase();
  const topics = db.prepare('SELECT * FROM tracking_topics ORDER BY updated_at DESC').all();
  const out = topics.map(t => {
    const memberCount = db.prepare('SELECT COUNT(*) c FROM tracking_topic_contents WHERE tracking_topic_id=? AND muted=0').get(t.id).c;
    const storylineCount = db.prepare("SELECT COUNT(*) c FROM storylines WHERE tracking_topic_id=? AND status='active'").get(t.id).c;
    const weekNew = db.prepare(`SELECT COUNT(*) c FROM tracking_topic_contents ttc JOIN contents c ON ttc.content_id=c.id
      WHERE ttc.tracking_topic_id=? AND ttc.muted=0 AND datetime(COALESCE(c.published_at,c.created_at))>datetime('now','-7 days')`).get(t.id).c;
    const span = db.prepare(`SELECT MIN(COALESCE(c.published_at,c.created_at)) a, MAX(COALESCE(c.published_at,c.created_at)) b
      FROM tracking_topic_contents ttc JOIN contents c ON ttc.content_id=c.id WHERE ttc.tracking_topic_id=? AND ttc.muted=0`).get(t.id);
    const days = span?.a ? Math.max(1, Math.round((new Date(span.b) - new Date(span.a)) / 86400000)) : 0;
    return { id: t.id, name: t.name, aliases: JSON.parse(t.aliases || '[]'), status: t.status, created_by: t.created_by,
      overview: t.overview, memberCount, storylineCount, weekNew, spanDays: days,
      gathering: memberCount < MIN_FOR_SYNTHESIS };
  });
  db.close();
  return out;
}

// 一键跑完整管道（收录→归线→综述）
export async function refreshTrackingTopic(topicId) {
  const m = await determineMembers(topicId);
  const s = await assignStorylines(topicId);
  const g = await generateSynthesis(topicId);
  return { members: m, storylines: s, synthesis: g };
}

// 踢出一条（记 mute，不自动学习）
export function ejectContent(topicId, contentId) {
  const db = getDatabase();
  const r = db.prepare('UPDATE tracking_topic_contents SET muted=1 WHERE tracking_topic_id=? AND content_id=?').run(topicId, contentId);
  db.close();
  return { ejected: r.changes };
}

// ① 成员判定：向量召回 + LLM aboutness（主角性）
export async function determineMembers(topicId, { days = RECALL_WINDOW_DAYS } = {}) {
  const db = getDatabase();
  const topic = db.prepare('SELECT * FROM tracking_topics WHERE id=?').get(topicId);
  if (!topic) { db.close(); return { added: 0 }; }
  const cv = parseVec(topic.centroid_embedding);
  const aliases = JSON.parse(topic.aliases || '[]');
  const existing = new Set(db.prepare('SELECT content_id FROM tracking_topic_contents WHERE tracking_topic_id=?').all(topicId).map(r => r.content_id));
  const cands = db.prepare(`
    SELECT id, COALESCE(zh_title,en_title) title, zh_summary summary, en_title, published_at, created_at, source_app, embedding
    FROM contents WHERE source_app!='github_trending'
      AND datetime(COALESCE(published_at,created_at)) > datetime('now','-${days} days')`).all();
  db.close();

  // 召回 = 别名词面命中（高召回网，别名是 Claude/Anthropic 这类独特名，词面假阳低）∪ 向量高相似（补词面漏的）。
  // aboutness LLM 再滤主角性——契约："纯关键词假阳 8%，必须向量召回 + LLM 主角判定"。
  const aliasLc = [topic.name, ...aliases].map(a => a.toLowerCase()).filter(Boolean);
  const recalled = [];
  for (const c of cands) {
    if (existing.has(c.id)) continue;
    const hay = `${c.title || ''} ${c.summary || ''} ${c.en_title || ''}`.toLowerCase();
    const kw = aliasLc.some(a => hay.includes(a));
    const v = parseVec(c.embedding);
    const s = (cv && v) ? cosine(cv, v) : 0;
    if (kw || s >= RECALL_THRESHOLD) recalled.push({ ...c, sim: s });
  }
  recalled.sort((a, b) => b.sim - a.sim);
  if (!recalled.length) return { added: 0, recalled: 0 };

  const kept = [];
  for (let i = 0; i < recalled.length; i += 15) {
    const batch = recalled.slice(i, i + 15);
    const list = batch.map((c, j) => `${j}. ${c.title}｜${(c.summary || '').slice(0, 60)}`).join('\n');
    const prompt = `追踪对象「${topic.name}」（别名：${aliases.join('、')}）。判断下面每条的**主角**是不是这个对象。
主角性(aboutness)判据：内容主要讲的就是它/它的产品/它的动作才算——员工推广自家产品→算；员工发的生活贴、只顺带提一句→不算；词面撞名但主角无关（如别的产品恰好名字像）→不算。
必须回带序号 i + 一句"为什么收进来"(reason，≤18字)。只输出 JSON：{"members":[{"i":0,"about":true,"reason":"..."}]}

${list}`;
    const r = await chat([{ role: 'user', content: prompt }]);
    const arr = r.success && extractJson(r.content)?.members;
    if (Array.isArray(arr)) for (const e of arr) { if (Number.isInteger(e?.i) && e.i >= 0 && e.i < batch.length && e.about) kept.push({ c: batch[e.i], reason: (e.reason || '').slice(0, 40) }); }
  }

  const wdb = getDatabase();
  const ins = wdb.prepare(`INSERT OR IGNORE INTO tracking_topic_contents (tracking_topic_id, content_id, reason, relevance) VALUES (?,?,?,?)`);
  for (const k of kept) ins.run(topicId, k.c.id, k.reason, Math.round(k.c.sim * 1000) / 1000);
  wdb.prepare("UPDATE tracking_topics SET last_seen_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(topicId);
  wdb.close();
  return { added: kept.length, recalled: recalled.length };
}

// 取主题全部成员（含内容字段），按时间升序
function loadMembers(db, topicId) {
  return db.prepare(`
    SELECT ttc.content_id id, ttc.reason, ttc.storyline_id, ttc.relevance,
           COALESCE(c.zh_title,c.en_title) title, c.zh_summary summary, c.url,
           COALESCE(c.published_at,c.created_at) ts, c.source_app,
           COALESCE(s.trust_tier,'T2') trust_tier
    FROM tracking_topic_contents ttc JOIN contents c ON ttc.content_id=c.id
    LEFT JOIN sources s ON c.source_id=s.id
    WHERE ttc.tracking_topic_id=? AND ttc.muted=0
    ORDER BY datetime(COALESCE(c.published_at,c.created_at)) ASC`).all(topicId);
}

// ② 增量归线：LLM 按因果连通性把成员分主线（≤6）+ 零散区。首版全量分（增量版后续接）。
export async function assignStorylines(topicId) {
  const db = getDatabase();
  const topic = db.prepare('SELECT * FROM tracking_topics WHERE id=?').get(topicId);
  const members = loadMembers(db, topicId);
  db.close();
  if (members.length < 2) return { storylines: 0 };

  const list = members.map((m, i) => `${i}. [${dstr(m.ts)}] ${m.title}`).join('\n');
  const prompt = `下面是追踪主题「${topic.name}」的 ${members.length} 条内容（按时间排）。请按**因果连通性**把它们归成主线——
判据：一条是另一条的原因/后续/证据/反驳/同一进程 → 同一条主线（不是"话题相似"就归堆，禁词面归类）。
- 主线数 ≤ ${MAX_STORYLINES}，每条主线给一个能概括其"脉络"的名字（8-16 字，带张力，别用泛词）。
- 真正成不了因果链的零散条目，全部放进最后一组、名字固定为"零散动态"。
必须覆盖全部 0..${members.length - 1}，只输出 JSON（不要代码块）：
{"storylines":[{"name":"主线名","members":[0,3,5]}, ..., {"name":"零散动态","members":[...]}]}

${list}`;
  const r = await chat([{ role: 'user', content: prompt }], 'deepseek', null, { temperature: 0 });
  const groups = r.success && extractJson(r.content)?.storylines;
  if (!Array.isArray(groups) || !groups.length) return { storylines: 0, error: 'LLM 归线失败' };

  const wdb = getDatabase();
  wdb.exec('BEGIN');
  try {
    wdb.prepare('DELETE FROM storylines WHERE tracking_topic_id=?').run(topicId);
    wdb.prepare('UPDATE tracking_topic_contents SET storyline_id=NULL WHERE tracking_topic_id=?').run(topicId);
    const insSL = wdb.prepare(`INSERT INTO storylines (id, tracking_topic_id, name, status, ord) VALUES (?,?,?,?,?)`);
    const setLine = wdb.prepare('UPDATE tracking_topic_contents SET storyline_id=? WHERE tracking_topic_id=? AND content_id=?');
    const seen = new Set();
    let ord = 0;
    for (const g of groups) {
      const idxs = (g.members || []).filter(i => Number.isInteger(i) && i >= 0 && i < members.length && !seen.has(i) && (seen.add(i), true));
      if (!idxs.length) continue;
      const scattered = /零散/.test(g.name || '');
      const slId = randomUUID();
      insSL.run(slId, topicId, (g.name || '未命名').slice(0, 40), scattered ? 'scattered' : 'active', scattered ? 99 : ord++);
      for (const i of idxs) setLine.run(slId, topicId, members[i].id);
    }
    // 未被 LLM 覆盖的兜进零散
    const leftover = members.filter((_, i) => !seen.has(i));
    if (leftover.length) {
      let sc = wdb.prepare("SELECT id FROM storylines WHERE tracking_topic_id=? AND status='scattered' LIMIT 1").get(topicId);
      if (!sc) { const slId = randomUUID(); insSL.run(slId, topicId, '零散动态', 'scattered', 99); sc = { id: slId }; }
      for (const m of leftover) setLine.run(sc.id, topicId, m.id);
    }
    wdb.exec('COMMIT');
  } catch (e) { wdb.exec('ROLLBACK'); wdb.close(); throw e; }
  const n = wdb.prepare('SELECT COUNT(*) c FROM storylines WHERE tracking_topic_id=?').get(topicId).c;
  wdb.close();
  return { storylines: n };
}

// ③ 四槽位综述：每条 active 主线生成 脉络/判断/待追/钩子 + 总览。硬约束：写不进出处的事实句不许出现。
export async function generateSynthesis(topicId) {
  const db = getDatabase();
  const topic = db.prepare('SELECT * FROM tracking_topics WHERE id=?').get(topicId);
  const members = loadMembers(db, topicId);
  const storylines = db.prepare("SELECT * FROM storylines WHERE tracking_topic_id=? ORDER BY status ASC, ord ASC").all(topicId);
  db.close();
  if (members.length < MIN_FOR_SYNTHESIS) return { status: 'gathering', count: members.length, need: MIN_FOR_SYNTHESIS };

  const byLine = new Map();
  for (const m of members) { if (!byLine.has(m.storyline_id)) byLine.set(m.storyline_id, []); byLine.get(m.storyline_id).push(m); }

  const wdb = getDatabase();
  const updSL = wdb.prepare('UPDATE storylines SET narrative=?, verdict=?, watch=?, hook=?, updated_at=datetime(\'now\') WHERE id=?');
  const activeNames = [];
  for (const sl of storylines) {
    const ms = byLine.get(sl.id) || [];
    if (sl.status === 'scattered' || ms.length < 2) continue; // 零散区不生成叙事
    const evid = ms.map((m, i) => `[${dstr(m.ts)}] ${m.title}｜${(m.summary || '').slice(0, 80)}｜出处#${i + 1}${m.url ? '=' + m.url : '（无链接）'}`).join('\n');
    const prompt = `你在给追踪主题「${topic.name}」写主线「${sl.name}」的综述段。素材（按时间）：
${evid}

写成四个槽位，硬约束：**每个事实句都必须能落到上面某条素材（写不进出处的事实句不许出现，宁可不写）**：
- narrative（脉络）：把这些事按时间/因果串成一段直白叙事，点名日期与主体，句句基于素材、不夸张不编造。
- verdict（一句话判断）：犀利、独立、有观点的一句——这是"AI 判断·供你反驳"，不引用素材、只下判断。
- watch（待追）：中性地提一句"接下来值得盯什么"。
- hook（钩子）：给一个可写的角度（给角度不给腔调），一句话。
只输出 JSON（不要代码块）：{"narrative":"...","verdict":"...","watch":"...","hook":"..."}`;
    const r = await chat([{ role: 'user', content: prompt }], 'deepseek', null, { temperature: 0.2 });
    const j = extractJson(r.content) || {};
    updSL.run(j.narrative || '', j.verdict || '', j.watch || '', j.hook || '', sl.id);
    activeNames.push(sl.name);
  }

  // 一句话总览（读所有主线判断后收一句）
  const verdicts = wdb.prepare("SELECT name, verdict FROM storylines WHERE tracking_topic_id=? AND status='active' AND verdict!='' ").all(topicId);
  let overview = '';
  if (verdicts.length) {
    const vr = await chat([{ role: 'user', content: `下面是追踪主题「${topic.name}」各主线的判断：\n${verdicts.map(v => `- ${v.name}：${v.verdict}`).join('\n')}\n\n用一句话总览这个月这个主题的整体态势（犀利、有张力、别罗列）。只输出这一句话。` }], 'deepseek', null, { temperature: 0.3 });
    overview = (vr.success ? vr.content : '').trim().replace(/^["「]|["」]$/g, '').slice(0, 200);
  }
  wdb.prepare("UPDATE tracking_topics SET overview=?, updated_at=datetime('now') WHERE id=?").run(overview, topicId);
  wdb.close();
  return { status: 'ready', storylines: activeNames.length, overview };
}

// 读整份综述（供 UI / 导出）
export function getTrackingSynthesis(topicId) {
  const db = getDatabase();
  const topic = db.prepare('SELECT * FROM tracking_topics WHERE id=?').get(topicId);
  if (!topic) { db.close(); return null; }
  const members = loadMembers(db, topicId);
  const storylines = db.prepare("SELECT * FROM storylines WHERE tracking_topic_id=? ORDER BY status ASC, ord ASC").all(topicId);
  db.close();
  const byLine = new Map();
  for (const m of members) { if (!byLine.has(m.storyline_id)) byLine.set(m.storyline_id, []); byLine.get(m.storyline_id).push(m); }
  return {
    ...topic, aliases: JSON.parse(topic.aliases || '[]'), memberCount: members.length,
    storylines: storylines.map(sl => ({ ...sl, members: byLine.get(sl.id) || [] })),
  };
}
