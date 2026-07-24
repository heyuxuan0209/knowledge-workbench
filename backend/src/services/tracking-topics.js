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
const fulldate = (iso) => (iso || '').slice(0, 10) || '（无日期）'; // YYYY-MM-DD（注入用，防年份幻觉）

// 后校验（返工④）：脉络里"没有 [#n] 出处标记的实质陈述句"剔除——落实"写不进出处不许出现"。
// 保留：带 [#n] 的句子、很短的过渡句（<12 字，如"但转折出现："）。
function stripUnsourced(text) {
  if (!text) return '';
  const parts = String(text).split(/(?<=[。！？])/); // 按句末标点切，保留标点
  const kept = parts.filter(s => {
    const t = s.trim();
    if (!t) return false;
    if (/\[#\d+\]/.test(t)) return true;          // 有出处角标 → 留
    if (t.replace(/[，、：；""'']/g, '').length < 12) return true; // 短过渡句 → 留
    return false;                                  // 无出处的实质陈述句 → 剔
  });
  return kept.join('').trim();
}

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

// ② 归线（两步走·返工①）：先让 LLM **列候选因果链**（每链写明谁是谁的原因/后续/反应）再分配条目；
// 零散区跑第二遍"能否挂入已有链"；薄线（<${MIN_LINE = 3} 条）并入零散。判据=因果连通性，禁话题/词面归堆。
const MIN_LINE = 3;
export async function assignStorylines(topicId) {
  const db = getDatabase();
  const topic = db.prepare('SELECT * FROM tracking_topics WHERE id=?').get(topicId);
  const members = loadMembers(db, topicId);
  db.close();
  if (members.length < 2) return { storylines: 0 };

  const list = members.map((m, i) => `${i}. [${dstr(m.ts)}] ${m.title}`).join('\n');
  // ── 第一步：列因果链（要理由）+ 分配 ──
  const promptA = `追踪主题「${topic.name}」有下面 ${members.length} 条内容（按时间）。把它们归成**因果链主线**。

**判据 = 因果连通性**：一条是另一条的 原因 / 后续 / 反应 / 证据 / 反驳 / 同一进程的不同阶段 → 同一条链。
**禁止**：按"话题/主体相似"归堆（如"都提到 ${topic.name}"就归一起）；主角不符的（如第三方滥用、别的产品）进零散或不归。

示范这种链怎么找：
- "秘密递交 IPO → 巨额投资/算力采购 → 版权和解获批 → 治理背书" = 一条"上市前商业冲刺"链（都是 IPO 前的清障/铺垫动作，互为因果）。
- "开源模型登顶 → 市场震荡 → 制裁威胁 → 蒸馏指控" = 一条"护城河遭遇战"链（一环触发下一环）。

要求：
- 先想清每条链的**因果关系**（谁引发谁），再分配条目；主线 ≤ ${MAX_STORYLINES}，每链 ≥2 条。
- 每条链给名字（8-16 字、带张力、非泛词）+ 一句 why（这条链的因果主轴是什么）。
- 真串不成因果链的条目放进 scattered。

只输出 JSON（不要代码块）：{"chains":[{"name":"...","why":"因果主轴一句话","members":[0,3,5]}],"scattered":[1,2]}

${list}`;
  const rA = await chat([{ role: 'user', content: promptA }], 'deepseek', null, { temperature: 0 });
  const parsed = rA.success && extractJson(rA.content);
  let chains = Array.isArray(parsed?.chains) ? parsed.chains : [];
  let scattered = Array.isArray(parsed?.scattered) ? parsed.scattered.filter(i => Number.isInteger(i) && i >= 0 && i < members.length) : [];
  if (!chains.length) return { storylines: 0, error: 'LLM 归线失败' };

  // 去重 + 收集已分配
  const assigned = new Set();
  chains = chains.map(c => ({ name: (c.name || '未命名').slice(0, 40), why: c.why || '', members: (c.members || []).filter(i => Number.isInteger(i) && i >= 0 && i < members.length && !assigned.has(i) && (assigned.add(i), true)) }))
    .filter(c => c.members.length);
  // 未覆盖的补进 scattered
  for (let i = 0; i < members.length; i++) if (!assigned.has(i) && !scattered.includes(i)) scattered.push(i);
  scattered = scattered.filter(i => !assigned.has(i));

  // ── 第二步：零散条目跑"能否挂入已有链" ──
  if (scattered.length && chains.length) {
    const chainList = chains.map((c, i) => `${i}. ${c.name}｜${c.why}`).join('\n');
    const scatList = scattered.map(i => `${i}. [${dstr(members[i].ts)}] ${members[i].title}`).join('\n');
    const promptB = `已有这些因果链：\n${chainList}\n\n下面是暂未归线的零散条目。逐条判断它是不是某条链的 原因/后续/反应/证据（因果相关，不是话题相似）——是则给 chain 序号，不是则 -1（真零散）。
只输出 JSON：{"assign":[{"i":<条目序号>,"chain":<链序号或-1>}]}\n\n${scatList}`;
    const rB = await chat([{ role: 'user', content: promptB }], 'deepseek', null, { temperature: 0 });
    const asg = rB.success && extractJson(rB.content)?.assign;
    if (Array.isArray(asg)) for (const a of asg) {
      if (Number.isInteger(a?.i) && Number.isInteger(a?.chain) && a.chain >= 0 && a.chain < chains.length && scattered.includes(a.i)) {
        chains[a.chain].members.push(a.i); assigned.add(a.i); scattered = scattered.filter(x => x !== a.i);
      }
    }
  }

  // 薄线（<3 条）并入零散（返工①：不硬留薄线）
  const thin = chains.filter(c => c.members.length < MIN_LINE);
  chains = chains.filter(c => c.members.length >= MIN_LINE);
  for (const c of thin) scattered.push(...c.members);
  scattered = [...new Set(scattered)];

  const wdb = getDatabase();
  wdb.exec('BEGIN');
  try {
    wdb.prepare('DELETE FROM storylines WHERE tracking_topic_id=?').run(topicId);
    wdb.prepare('UPDATE tracking_topic_contents SET storyline_id=NULL WHERE tracking_topic_id=?').run(topicId);
    const insSL = wdb.prepare(`INSERT INTO storylines (id, tracking_topic_id, name, narrative, status, ord) VALUES (?,?,?,?,?,?)`);
    const setLine = wdb.prepare('UPDATE tracking_topic_contents SET storyline_id=? WHERE tracking_topic_id=? AND content_id=?');
    let ord = 0;
    for (const c of chains) {
      const slId = randomUUID();
      insSL.run(slId, topicId, c.name, c.why || null, 'active', ord++); // 暂存 why 在 narrative，综述阶段覆盖
      for (const i of c.members) setLine.run(slId, topicId, members[i].id);
    }
    if (scattered.length) {
      const slId = randomUUID(); insSL.run(slId, topicId, '零散动态', null, 'scattered', 99);
      for (const i of scattered) setLine.run(slId, topicId, members[i].id);
    }
    wdb.exec('COMMIT');
  } catch (e) { wdb.exec('ROLLBACK'); wdb.close(); throw e; }
  const n = wdb.prepare("SELECT COUNT(*) c FROM storylines WHERE tracking_topic_id=? AND status='active'").get(topicId).c;
  wdb.close();
  return { storylines: n, scattered: scattered.length };
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
    // 出处编号 [#n]（按时间序，与 UI 成员顺序一致）+ 真实日期（含年份，从 published_at 注入，不让 LLM 生成）
    const evid = ms.map((m, i) => `[#${i + 1}] ${fulldate(m.ts)}｜${m.title}｜${(m.summary || '').slice(0, 90)}`).join('\n');
    const prompt = `给追踪主题「${topic.name}」的主线「${sl.name}」写综述段。素材（按时间，[#n] 是出处编号）：
${evid}

严格按四槽位输出，硬性纪律：
1. narrative（脉络）：**叙事，不是流水账**——按"起点 → 转折 → 现状"讲清这条线怎么演变的（谁引发谁），日期只做锚点。
   **禁止**"X 日……；同日……；X 日……"的编年罗列句式。
   **日期/数字只能用上面素材里给的，一个字都不许自己编（尤其年份）**。
   **每个事实句结尾必须带它的出处编号 [#n]**（如"…完成百万行迁移 [#3]。"）；写不进出处的事实句不许出现，宁可不写。
2. verdict（判断）：犀利、独立、可反驳的一句——"AI 判断·供你反驳"，只下判断、不引用、不带出处。
3. watch（待追）：中性一句"接下来值得盯什么"。
4. hook（钩子）：给创作接缝，**结构固定**="角度：<一句选题角度>。可接：<建议文体×平台>。"——**禁止反问句**、禁议论文腔。
只输出 JSON（不要代码块）：{"narrative":"...","verdict":"...","watch":"...","hook":"..."}`;
    const r = await chat([{ role: 'user', content: prompt }], 'deepseek', null, { temperature: 0.2 });
    const j = extractJson(r.content) || {};
    const narrative = stripUnsourced(j.narrative || ''); // 后校验：剔除无 [#n] 标记的陈述句
    updSL.run(narrative, j.verdict || '', j.watch || '', j.hook || '', sl.id);
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
