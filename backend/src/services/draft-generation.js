import { getDatabase } from '../db/init.js';
import { chat } from './llm.js';
import { createDraft } from '../db/drafts.js';
import { loadPrompt, render, getPlatform, getGenre, getPlatformForm } from './creation-prompts.js';

// M4 创作层生成引擎：同一素材集（活页 + 已并入素材卡），按平台分化输出。
// 平台规格 / 起稿框架 / 立场块的全部语言规范在 reference/prompts/creation/
// （P1 文件化：改文件即改行为，新增平台=加一个 platforms/*.md）。
// 这里只保留程序逻辑：素材编号、[素材N] 溯源解析、落库。

// selectedNoteIds 非空 → 只取这几条素材（ADR-028 阶段1：生成用"你选的"，不是整个主题）；
// 为空 → 老行为不变（取主题全部已并入素材，最多 12 条）
function gatherTopicMaterials(topicId, selectedNoteIds = null) {
  const db = getDatabase();
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId);
  if (!topic) { db.close(); throw new Error('Topic not found'); }

  let body;
  try { body = JSON.parse(topic.body || '{}'); } catch { body = {}; }

  let notes;
  if (selectedNoteIds && selectedNoteIds.length) {
    const ph = selectedNoteIds.map(() => '?').join(',');
    notes = db.prepare(`
      SELECT n.id, n.title, n.excerpt, n.source_title, n.source_url, n.content_id
      FROM note_topics nt JOIN notes n ON nt.note_id = n.id
      WHERE nt.topic_id = ? AND nt.status = 'assimilated' AND n.id IN (${ph})
      ORDER BY nt.assimilated_at DESC
    `).all(topicId, ...selectedNoteIds);
  } else {
    notes = db.prepare(`
      SELECT n.id, n.title, n.excerpt, n.source_title, n.source_url, n.content_id
      FROM note_topics nt JOIN notes n ON nt.note_id = n.id
      WHERE nt.topic_id = ? AND nt.status = 'assimilated'
      ORDER BY nt.assimilated_at DESC LIMIT 12
    `).all(topicId);
  }
  db.close();
  return { topic, body, notes };
}

// 启发式推荐：看选中的素材是什么，荐一个文体（平台默认公众号长文，用户可改）
export function recommendForMaterials(noteIds) {
  if (!Array.isArray(noteIds) || !noteIds.length) return { genre: '读书精读体', platformForm: 'gzh-long', reason: '' };
  const db = getDatabase();
  const ph = noteIds.map(() => '?').join(',');
  const notes = db.prepare(`SELECT note_type, content_id, source_url, title, excerpt, keywords FROM notes WHERE id IN (${ph})`).all(...noteIds);
  db.close();
  const n = notes.length;
  const external = notes.filter(x => x.content_id || x.source_url).length;
  const blob = notes.map(x => `${x.title || ''} ${x.excerpt || ''} ${x.keywords || ''}`).join(' ').toLowerCase();
  const has = re => re.test(blob);

  let genre = '读书精读体', reason = `你选的多是外部文章（${external}/${n} 条），适合消化成一篇带你判断的解读`;
  if (external === 0) { genre = '实践复盘体'; reason = '这些更像你自己的记录/经历，适合第一人称复盘（要有你的亲历）'; }
  else if (has(/方法|步骤|如何|怎么做|流程|教程|指南|清单|工作流/)) { genre = '方法教程体'; reason = '素材偏方法/步骤，适合做成看完就能上手的教程'; }
  else if (has(/争议|分歧|对立|两种|误区|其实不是|反直觉|vs|之争/)) { genre = '思辨辨析体'; reason = '素材里有对立/误区，适合辨析立论'; }
  else if (n === 1) { genre = '一句话提炼体'; reason = '就一条素材，适合提炼成一个能被转述的记忆点'; }
  return { genre, platformForm: 'gzh-long', reason };
}

// 供前端勾选用：列出某主题的已并入素材（id + 短摘要 + 来源）
export function listTopicMaterials(topicId) {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT n.id, n.excerpt, n.source_title, n.source_url
    FROM note_topics nt JOIN notes n ON nt.note_id = n.id
    WHERE nt.topic_id = ? AND nt.status = 'assimilated'
    ORDER BY nt.assimilated_at DESC LIMIT 30
  `).all(topicId);
  db.close();
  return rows.map(r => ({ id: r.id, excerpt: (r.excerpt || '').slice(0, 90), sourceTitle: r.source_title || '未命名素材', sourceUrl: r.source_url || null }));
}

function buildPrompt(topic, body, notes, platformSpec, viewpoint) {
  const viewsBlock = (body.views || []).length
    ? body.views.map(v => `- ${v.who}：${v.what}${v.conflict ? '（⚡与他方冲突）' : ''}`).join('\n')
    : '（暂无）';
  const notesBlock = notes.length
    ? notes.map((n, i) => `[素材${i + 1}]（来源：${n.title || n.source_title || '未知'}）\n${n.excerpt.slice(0, 800)}`).join('\n\n')
    : '（暂无素材，基于主题页综述创作）';

  // 观点入口（创作层的分水岭）：有作者立场 → 全文为它服务，AI 只补论证不替立场；
  // 没有 → 判断段落必须显式标注"AI 提议"（诚实原则，决策5）。措辞见 stance-*.md
  const stanceBlock = viewpoint?.trim()
    ? render(loadPrompt('stance-with.md'), { viewpoint: viewpoint.trim() })
    : loadPrompt('stance-without.md');

  return render(loadPrompt('draft-frame.md'), {
    topicName: topic.name,
    platformSpec,
    stanceBlock,
    current: body.current || topic.description || '（空）',
    views: viewsBlock,
    consensus: body.consensus || '（暂无）',
    notes: notesBlock,
  });
}

// 从生成正文解析实际出现的 [素材N] 标记 → 段落级溯源引用
function extractRefs(bodyText, notes) {
  const refs = [];
  const seen = new Set();
  for (const m of bodyText.matchAll(/\[素材(\d+)\]/g)) {
    const idx = parseInt(m[1]) - 1;
    if (idx < 0 || idx >= notes.length || seen.has(idx)) continue;
    seen.add(idx);
    refs.push({
      marker: `[素材${idx + 1}]`,
      noteId: notes[idx].id,
      sourceTitle: notes[idx].title || notes[idx].source_title,
      sourceUrl: notes[idx].source_url || null,
      contentId: notes[idx].content_id,
    });
  }
  return refs;
}

// 从活页起稿：一次 LLM 调用 → 落库为 Draft（含溯源引用）。
// viewpoint = 作者立场（观点入口），可空——空时判断段落如实标注"AI 提议"
export async function generateFromTopic(topicId, platform = 'long', viewpoint = null) {
  const spec = getPlatform(platform); // 未知平台在此抛错（附可用清单提示）
  const { topic, body, notes } = gatherTopicMaterials(topicId);

  const result = await chat([{ role: 'user', content: buildPrompt(topic, body, notes, spec.spec, viewpoint) }]);
  if (!result.success) throw new Error(`LLM 调用失败: ${result.error}`);

  const text = result.content.trim();
  const title = text.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80);

  const draft = createDraft({
    platform,
    title,
    body: text,
    paragraphRefs: extractRefs(text, notes),
    sourceKind: 'topic',
    sourceId: topicId,
    sourceLabel: `Topic：${topic.name}`,
    tokens: result.tokens || 0,
    costYuan: result.cost || 0,
  });
  console.log(`✅ Draft generated from topic「${topic.name}」(${spec.label}, ${draft.paragraph_refs.length} refs, ¥${result.cost?.toFixed(4)})`);
  return draft;
}

// 去 AI 味后处理（huashu 三遍审校内化，措辞见 creation/humanize.md）。
// 不落库、返回改写稿——由前端决定是否替换草稿区内容。
export async function humanize(draftText, platform = 'long') {
  if (!draftText?.trim()) throw new Error('draft is required');
  let platformNote = '文稿';
  try { platformNote = getPlatform(platform).label; } catch { /* 平台未知不阻塞审校 */ }

  const result = await chat([{
    role: 'user',
    content: render(loadPrompt('humanize.md'), { platformNote, draft: draftText.slice(0, 8000) }),
  }]);
  if (!result.success) throw new Error(`LLM 调用失败: ${result.error}`);
  return { text: result.content.trim(), tokens: result.tokens, cost: result.cost };
}

// ── ADR-026 并行新路径：文体(genre) × 平台形态(platform-form) 拼装起稿 ──
// 与老 generateFromTopic 完全并存，不改老路径。ADR-027：第一人称文体豁免强制溯源 + 综述块。
const FIRST_PERSON_GENRES = ['实践复盘体', '个人叙事体'];

// 输出干净正文（覆盖平台模板里的 Markdown 说法）——用户要"干净正文，不要 ## 和 **"
const CLEAN_OUTPUT = `【输出格式·最高优先】直接输出可发布的干净正文，**不要用任何 Markdown 符号**：不要 # / ##（标题）、不要 **加粗**、不要 - 或 * 列表符号、不要 \`代码\`反引号。需要小标题时，单独成一行写一句普通文字（前面不加 #）；需要强调时靠措辞，不靠加粗。段落之间用空行分隔。[素材N] 溯源标记要保留。\n\n`;
// 卡片平台（小红书卡片/抖音卡片）：必须按【封面卡】/【卡N】/【正文文案】结构输出，图卡工具靠这个解析
const CARD_OUTPUT = `【输出格式·最高优先】严格按下面这个图卡结构输出，一块一行，字段名一字不差：
【封面卡】大字：（≤12字钩子）／小字：（≤22字，谁该看/能带走什么）
【卡1】标题：（一句话要点）／正文：（≤60字）
【卡2】标题：…／正文：…
…（按内容条数，最多 8 张）
【正文文案】（发布时配在图片下方那段）
注意：封面卡必须用「大字：…／小字：…」，内容卡必须用「标题：…／正文：…」，不要混。不要 Markdown 符号（##、**）。[素材N] 溯源标记要保留（渲染成图前会自动去掉）。\n\n`;
const isCardForm = k => String(k || '').includes('card');


function buildPromptV2(topic, body, notes, composedSpec, viewpoint, skipOverview) {
  const viewsBlock = (body.views || []).length
    ? body.views.map(v => `- ${v.who}：${v.what}${v.conflict ? '（⚡与他方冲突）' : ''}`).join('\n')
    : '（暂无）';
  const notesBlock = notes.length
    ? notes.map((n, i) => `[素材${i + 1}]（来源：${n.title || n.source_title || '未知'}）\n${n.excerpt.slice(0, 800)}`).join('\n\n')
    : '（暂无素材，基于主题页综述创作）';
  const stanceBlock = viewpoint?.trim()
    ? render(loadPrompt('stance-with.md'), { viewpoint: viewpoint.trim() })
    : loadPrompt('stance-without.md');

  return render(loadPrompt('draft-frame.md'), {
    topicName: topic.name,
    platformSpec: composedSpec,
    stanceBlock,
    current: skipOverview ? '（本篇不使用主题综述——见拼装说明）' : (body.current || topic.description || '（空）'),
    views: skipOverview ? '（略）' : viewsBlock,
    consensus: skipOverview ? '（略）' : (body.consensus || '（暂无）'),
    notes: notesBlock,
  });
}

export async function generateFromTopicV2(topicId, genreKey, platformFormKey, viewpoint = null, selectedNoteIds = null) {
  const genre = getGenre(genreKey);           // 未知文体在此抛错（附可用清单）
  const pform = getPlatformForm(platformFormKey);
  const firstPerson = FIRST_PERSON_GENRES.includes(genreKey);
  const materialsPicked = !!(selectedNoteIds && selectedNoteIds.length);
  const skipOverview = firstPerson || materialsPicked;   // 手选素材 或 第一人称 → 不塞主题综述

  // 后置/更具体指令覆盖 draft-frame 的全局硬约束
  let exemption = '';
  if (materialsPicked) exemption += `【只用选中素材·ADR-028】本篇只基于下方勾选的 ${selectedNoteIds.length} 条素材创作；**不要引入主题页综述、也不要引入任何未勾选的内容**。[素材N] 只标你实际引用的这几条。\n\n`;
  if (firstPerson) exemption += `【拼装豁免·ADR-027】本篇是第一人称亲历文体：[素材N] 溯源只在"引用外部信息/数据"时标，不对你自己的经历强制标注。底线不变：用到外部信息照样必须标、不许编。\n\n`;
  const fmtNote = isCardForm(platformFormKey) ? CARD_OUTPUT : CLEAN_OUTPUT;
  const composedSpec = `${fmtNote}${exemption}【文体骨架】\n${genre.spec}\n\n---\n\n【平台形态】\n${pform.spec}`;

  const { topic, body, notes } = gatherTopicMaterials(topicId, selectedNoteIds);
  console.log(`  ↳ 生成用素材：${materialsPicked ? `选中 ${notes.length} 条（跳过主题综述）` : `主题全部 ${notes.length} 条`}`);
  const result = await chat([{ role: 'user', content: buildPromptV2(topic, body, notes, composedSpec, viewpoint, skipOverview) }]);
  if (!result.success) throw new Error(`LLM 调用失败: ${result.error}`);

  const text = result.content.trim();
  const title = text.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80);

  const draft = createDraft({
    platform: platformFormKey,          // v2 稿以 platform-form key 落库（草稿箱图标退化为默认，不影响）
    title,
    body: text,
    paragraphRefs: extractRefs(text, notes),
    sourceKind: 'topic',
    sourceId: topicId,
    sourceLabel: `Topic：${topic.name}｜${genre.label}×${pform.label}`,
    tokens: result.tokens || 0,
    costYuan: result.cost || 0,
  });
  console.log(`✅ Draft v2 from「${topic.name}」(${genre.label}×${pform.label}, ${draft.paragraph_refs.length} refs, ¥${result.cost?.toFixed(4)})`);
  return draft;
}

// ── ADR-028 阶段1·B：不依赖主题，直接按一组素材 id 生成 ──
// 从整个素材库挑的素材集 → 生成，永远只用这些、无主题综述。
export async function generateFromMaterials(noteIds, genreKey, platformFormKey, viewpoint = null) {
  if (!Array.isArray(noteIds) || !noteIds.length) throw new Error('至少选 1 条素材');
  const genre = getGenre(genreKey);
  const pform = getPlatformForm(platformFormKey);
  const firstPerson = FIRST_PERSON_GENRES.includes(genreKey);

  const db = getDatabase();
  const ph = noteIds.map(() => '?').join(',');
  const notes = db.prepare(`SELECT id, title, excerpt, source_title, source_url, content_id FROM notes WHERE id IN (${ph})`).all(...noteIds);
  db.close();
  if (!notes.length) throw new Error('选中的素材找不到');

  let exemption = `【只用选中素材·ADR-028】本篇只基于下方 ${notes.length} 条素材创作；**不要引入任何未提供的内容**。[素材N] 只标你实际引用的这几条。\n\n`;
  if (firstPerson) exemption += `【拼装豁免·ADR-027】第一人称亲历文体：[素材N] 只在引用外部信息时标。底线不变：用到外部信息照样标、不许编。\n\n`;
  const fmtNote = isCardForm(platformFormKey) ? CARD_OUTPUT : CLEAN_OUTPUT;
  const composedSpec = `${fmtNote}${exemption}【文体骨架】\n${genre.spec}\n\n---\n\n【平台形态】\n${pform.spec}`;

  // 无主题：造一个最小 topic + 空 body，skipOverview=true（不塞综述）
  const result = await chat([{ role: 'user', content: buildPromptV2({ name: '自选素材', description: '' }, {}, notes, composedSpec, viewpoint, true) }]);
  if (!result.success) throw new Error(`LLM 调用失败: ${result.error}`);

  const text = result.content.trim();
  const title = text.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80);
  const draft = createDraft({
    platform: platformFormKey, title, body: text,
    paragraphRefs: extractRefs(text, notes),
    sourceKind: 'manual', sourceId: null,
    sourceLabel: `自选 ${notes.length} 条素材｜${genre.label}×${pform.label}`,
    tokens: result.tokens || 0, costYuan: result.cost || 0,
  });
  console.log(`✅ Draft(materials) ${genre.label}×${pform.label}, ${notes.length} 素材, ${draft.paragraph_refs.length} refs, ¥${result.cost?.toFixed(4)}`);
  return draft;
}
