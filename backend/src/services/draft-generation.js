import { getDatabase } from '../db/init.js';
import { chat } from './llm.js';
import { createDraft } from '../db/drafts.js';

// M4 创作层生成引擎：同一素材集（活页 + 已并入素材卡），按平台分化输出。
// - 长文（公众号）：活页的"当前认知 + 各方观点 + 共识非共识"天然是综述骨架
// - 口播脚本：开场钩子 + 口语化主体 + 结尾引导，60-90 秒（抖音/视频号）
// - thread：钩子 + 分条 + 互动收尾（单篇快速版仍走 thread-generation.js，
//   这里是"从活页起稿"的主题版）
// 段落级溯源：素材以 [素材N] 编号喂给模型并要求引用标记；生成后解析正文里
// 实际出现的标记 → paragraph_refs 落库（草稿段落 → 素材卡 → 原始内容可回链）。

const PLATFORM_SPECS = {
  long: {
    label: '公众号长文',
    spec: `写一篇公众号深度长文（Markdown，1500-2500 字）：
- 结构：# 标题（吸引但不标题党）→ 导语（为什么现在值得读）→ 2-4 个小节（## 小标题）→ 「我的判断」小节（基于共识/非共识给出倾向性观点）→ 收束
- 观点交锋要写透：不同立场分别是谁、分歧在哪、为什么
- 语言书面但不学究，善用短段落`,
  },
  script: {
    label: '口播视频脚本',
    spec: `写一个 60-90 秒口播视频脚本（约 350-500 字，抖音/视频号）：
- 【钩子·前3秒】一句反直觉/冲突感的话，让人停下滑动
- 【主体】口语化短句，2-3 个要点，每个要点带一个具体例子或数字；书面词换成口语（"认知"→"想法"，"赋能"→"帮上忙"）
- 【结尾】一句总结 + 引导关注/评论的钩子问题
- 用换行分隔口播节奏，标注【】段落名`,
  },
  thread: {
    label: 'X thread',
    spec: `写一条 X thread（5-8 条推文）：
- 1/ 钩子：制造好奇缺口，60 字内
- 中间每条一个独立观点/事实，短句，可带数字对比
- 倒数第二条给最有争议的分歧点
- 最后一条：一句总结 + 互动提问
- 每条以 "N/ " 开头，条与条空行分隔`,
  },
};

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

function buildPrompt(topic, body, notes, platform, viewpoint) {
  const spec = PLATFORM_SPECS[platform];
  const viewsBlock = (body.views || []).length
    ? body.views.map(v => `- ${v.who}：${v.what}${v.conflict ? '（⚡与他方冲突）' : ''}`).join('\n')
    : '（暂无）';
  const notesBlock = notes.length
    ? notes.map((n, i) => `[素材${i + 1}]（来源：${n.source_title || '未知'}）\n${n.excerpt.slice(0, 800)}`).join('\n\n')
    : '（暂无素材，基于主题页综述创作）';

  // 观点入口（创作层的分水岭）：有作者立场 → 全文为它服务，AI 只补论证不替立场；
  // 没有 → 判断段落必须显式标注"AI 提议"，不许伪装成作者观点（诚实原则，决策5）
  const stanceBlock = viewpoint?.trim()
    ? `\n# 作者立场（最高优先级）\n作者想说的是：「${viewpoint.trim()}」\n全文围绕这个立场组织：观点段/判断段必须从它出发展开论证（可以补充论据、承认反方，但不得偷换或稀释这个立场）。\n`
    : `\n# 立场说明\n作者未提供立场。涉及"我的判断/倾向"的段落，开头必须标注"（AI 提议的判断，请替换为你的观点）"，不要伪装成作者本人的观点。\n`;

  return `你是一位独立开发者/AI产品经理的内容创作伙伴。基于他知识库中主题「${topic.name}」的主题页综述和素材，${spec.spec}
${stanceBlock}
# 主题页综述
## 当前认知
${body.current || topic.description || '（空）'}
## 各方观点
${viewsBlock}
## 共识 / 非共识
${body.consensus || '（暂无）'}

# 素材卡片（引用时在句尾标注 [素材N]，这是溯源标记，必须保留）
${notesBlock}

要求：
- 只用上面材料里真实存在的信息，不编造数据和引语
- 用到某条素材的观点/数据/例子时，在该句末尾标 [素材N]（多处可重复引用）
- 全部中文输出；第一行是标题（不带 # 也可以）`;
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
  if (!PLATFORM_SPECS[platform]) throw new Error(`invalid platform: ${platform}`);
  const { topic, body, notes } = gatherTopicMaterials(topicId);

  const result = await chat([{ role: 'user', content: buildPrompt(topic, body, notes, platform, viewpoint) }]);
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
  console.log(`✅ Draft generated from topic「${topic.name}」(${PLATFORM_SPECS[platform].label}, ${draft.paragraph_refs.length} refs, ¥${result.cost?.toFixed(4)})`);
  return draft;
}

// 去 AI 味后处理（RESEARCH-PIPELINE-EXTENSIONS §M4，huashu 三遍审校思路内化为一道工序）。
// 不落库、返回改写稿——由前端决定是否替换草稿区内容。
export async function humanize(draftText, platform = 'long') {
  if (!draftText?.trim()) throw new Error('draft is required');
  const platformNote = PLATFORM_SPECS[platform]?.label || '文稿';

  const result = await chat([{
    role: 'user',
    content: `你是资深中文编辑，请对这份${platformNote}做"去 AI 味"审校改写，按三遍法一次完成：
第一遍·词汇：删掉或替换 AI 高频词（"首先/其次/总之/综上所述/值得注意的是/不难发现/赋能/抓手/闭环"等），空洞形容词换成具体描述
第二遍·句式：拆掉整齐的排比和"总-分-总"套路，长短句交错，允许口语化的不完整句；删掉万能开头和万能结尾
第三遍·人味：在合适处加入第一人称的判断和犹豫（"我倾向于""说实话这点我也拿不准"），让立场有温度

硬约束：
- 事实、数字、引语、[素材N] 溯源标记一律不动
- 保持原有平台格式（分条/【】段落名/Markdown 结构）
- 篇幅变化不超过 ±20%
- 只输出改写后的全文，不要解释

# 原稿
${draftText.slice(0, 8000)}`,
  }]);
  if (!result.success) throw new Error(`LLM 调用失败: ${result.error}`);
  return { text: result.content.trim(), tokens: result.tokens, cost: result.cost };
}
