import { getDatabase } from '../db/init.js';
import { getIdea, addIdeaRelatedNotes } from '../db/ideas.js';

// 灵感"火候"（ADR-029 批次2 写作看板）：把每条灵感标成一个成熟度阶段，驱动看板的列。
// 第一性原理——真正的痛点是「先写哪条」+「这条火候够没够」。用系统已有的免费信号算，不额外烧 LLM：
//   料厚 = supporting 素材/内容 数；贴合主题 = supporting 素材落在哪个主题（note_topics 连表，免向量）；
//   时效 = 从 created_at 的天数 + 是否热点派生；搁置 = 太久没动。
// 阶段：seedling(攒着·火候不够) / ready(可以写了) / writing(在写) / topic(已养成主题)。

const STALE_DAYS = 14;   // 攒着太久 → 催办
const HOT_DAYS = 3;      // 新鲜且带时效 → 趁热
const AGING_DAYS = 10;   // 热点派生且超过 → 可能过期

// 「可以写了」阈值（先定一版，跑起来再调）。关键：火候看**你自己消化过的素材(notes)** + 主题贴合，
// 不看 AI 选题自带的原始新闻文章(contents)——那是起点、不是你的写作弹药。否则 AI 选题会全挤进"可以写了"。
//   ready = 你的素材 ≥2 条，或 ≥1 条且贴合某个你在养的主题。
const READY_NOTES = 2;
const READY_NOTES_WITH_TOPIC = 1;

function daysSince(s) {
  if (!s) return 0;
  const t = new Date(`${s.replace(' ', 'T')}Z`).getTime();
  return t ? Math.floor((Date.now() - t) / 86400000) : 0;
}

// 给一批已 hydrate 的 ideas（带 supporting_notes/contents）批量标注 readiness。就地改并返回。
export function annotateReadiness(ideas) {
  if (!ideas?.length) return ideas || [];

  // 批量：supporting 素材 → 主题（一次连表查，避免逐条）
  const allNoteIds = [...new Set(ideas.flatMap(i => (i.supporting_notes || []).map(n => n.id)))];
  const noteTopics = new Map(); // noteId -> [{id,name}]
  if (allNoteIds.length) {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT nt.note_id, t.id AS topic_id, t.name
      FROM note_topics nt JOIN topics t ON t.id = nt.topic_id
      WHERE nt.note_id IN (${allNoteIds.map(() => '?').join(',')})
    `).all(...allNoteIds);
    db.close();
    for (const r of rows) {
      if (!noteTopics.has(r.note_id)) noteTopics.set(r.note_id, []);
      noteTopics.get(r.note_id).push({ id: r.topic_id, name: r.name });
    }
  }

  for (const idea of ideas) {
    const noteCount = idea.supporting_notes?.length || 0;      // 你消化过的素材（真弹药）
    const contentCount = idea.supporting_contents?.length || 0; // AI 引的原始文章（起点，不算弹药）
    const materialCount = noteCount + contentCount;             // 展示用的"手里的料"总数

    // 贴合主题 = supporting 素材命中最多的那个主题
    const votes = new Map();
    for (const n of idea.supporting_notes || []) {
      for (const t of noteTopics.get(n.id) || []) {
        votes.set(t.id, { id: t.id, name: t.name, count: (votes.get(t.id)?.count || 0) + 1 });
      }
    }
    const relatedTopic = [...votes.values()].sort((a, b) => b.count - a.count)[0] || null;

    const ageDays = daysSince(idea.created_at);
    const hotDerived = idea.source_kind === 'ai' || idea.source_kind === 'feed';
    let timeliness = 'normal';
    if (hotDerived && ageDays >= AGING_DAYS) timeliness = 'stale';           // 可能过期
    else if (idea.why_now && ageDays <= HOT_DAYS) timeliness = 'hot';        // 趁热

    let stage;
    if (idea.status === 'adopted') stage = 'topic';        // 已养成主题
    else if (idea.status === 'created') stage = 'writing'; // 在写（已起稿）
    else {
      const ready = noteCount >= READY_NOTES
        || (noteCount >= READY_NOTES_WITH_TOPIC && relatedTopic);
      stage = ready ? 'ready' : 'seedling';
    }

    idea.readiness = {
      stage, materialCount, noteCount, contentCount, relatedTopic, timeliness, ageDays,
      stale: stage === 'seedling' && ageDays >= STALE_DAYS,
    };
  }
  return ideas;
}

// 自动补料（解决"手记灵感是孤岛"）：拿灵感标题语义检索素材库，把结果作为**相关素材建议**存 related。
// 关键（批次2 修正）：写 related 而非 supporting——建议不等于"你决定用的料"，用户点采纳才算数，火候不受它影响。
// 复用阶段1 向量层，查询侧短文本、亚秒级。minScore 提到 0.5 少挂噪音。返回补了几条建议。
export async function autoLinkIdea(ideaId, { limit = 4, minScore = 0.5 } = {}) {
  const idea = getIdea(ideaId);
  if (!idea?.title) return 0;
  const { searchNotes } = await import('./semantic-search.js');
  const exclude = new Set([...(idea.supporting_note_ids || []), ...(idea.related_note_ids || [])]);
  const hits = (await searchNotes(idea.title, { limit: limit + exclude.size, minScore }))
    .filter(h => !exclude.has(h.id))
    .slice(0, limit);
  if (!hits.length) return 0;
  addIdeaRelatedNotes(ideaId, hits.map(h => h.id));
  return hits.length;
}
