import { getDatabase } from '../db/init.js';
import { chat } from './llm.js';
import { createDraft } from '../db/drafts.js';
import { loadPrompt, render, getPlatform } from './creation-prompts.js';

// M4 创作层生成引擎：同一素材集（活页 + 已并入素材卡），按平台分化输出。
// 平台规格 / 起稿框架 / 立场块的全部语言规范在 reference/prompts/creation/
// （P1 文件化：改文件即改行为，新增平台=加一个 platforms/*.md）。
// 这里只保留程序逻辑：素材编号、[素材N] 溯源解析、落库。

function gatherTopicMaterials(topicId) {
  const db = getDatabase();
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId);
  if (!topic) { db.close(); throw new Error('Topic not found'); }

  let body;
  try { body = JSON.parse(topic.body || '{}'); } catch { body = {}; }

  const notes = db.prepare(`
    SELECT n.id, n.excerpt, n.source_title, n.source_url, n.content_id
    FROM note_topics nt JOIN notes n ON nt.note_id = n.id
    WHERE nt.topic_id = ? AND nt.status = 'assimilated'
    ORDER BY nt.assimilated_at DESC LIMIT 12
  `).all(topicId);
  db.close();
  return { topic, body, notes };
}

function buildPrompt(topic, body, notes, platformSpec, viewpoint) {
  const viewsBlock = (body.views || []).length
    ? body.views.map(v => `- ${v.who}：${v.what}${v.conflict ? '（⚡与他方冲突）' : ''}`).join('\n')
    : '（暂无）';
  const notesBlock = notes.length
    ? notes.map((n, i) => `[素材${i + 1}]（来源：${n.source_title || '未知'}）\n${n.excerpt.slice(0, 800)}`).join('\n\n')
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
      sourceTitle: notes[idx].source_title,
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
