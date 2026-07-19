import { getDatabase } from '../db/init.js';
import { chat } from './llm.js';

// 内容分类（VISION-V4 UI 改造 2b）：DeepSeek 批量把每条内容归到一个类别，缓存进 contents.category。
// 文章与 GitHub 项目用不同类目（前端两个 Tab 分别出 chips）。成本≈几厘/批，只分类未分类的、不重算。

export const ARTICLE_CATS = ['模型', '产品', '行业', '观点'];
export const REPO_CATS = ['工具Agent', '模型', '应用', '基建'];

// 类别定义（2026-07-19 用户反馈：光有类名不够，写进 prompt 让归类更稳，也给前端做 tooltip）。
// 一句话区分：模型=技术本身，产品=能用的工具，行业=商业与政策，观点=人的思考与做法。
export const ARTICLE_DEFS = {
  '模型': '模型本身：发布/更新、技术路线、训练方法、benchmark、研究成果',
  '产品': '能用的工具/应用/SDK/Agent 工具、产品功能更新',
  '行业': '生意与格局：融资/IPO/政策/法律/数据中心/公司动向/地缘竞争',
  '观点': '人的思考与做法：观点、经验、方法论、辩论、教程、评论',
};
export const REPO_DEFS = {
  '工具Agent': 'Agent 框架/CLI/开发者工具/自动化',
  '模型': '模型权重/训练/推理相关的开源项目',
  '应用': '面向具体场景的完整应用、示例合集、产品',
  '基建': '底层设施：数据/向量库/部署/可观测/协议',
};

function buildPrompt(items, cats, defs) {
  const list = items.map((it, i) => `${i + 1}. ${(it.title || '').slice(0, 80)}${it.summary ? ' —— ' + it.summary.slice(0, 80) : ''}`).join('\n');
  const defLines = cats.map(c => `- ${c}：${defs[c] || ''}`).join('\n');
  return `你是 AI 领域内容编辑。按下面的**类别定义**，把每条内容归到唯一一个最贴切的类别（都不合适才用「其他」）。

类别定义：
${defLines}

判断优先看内容的"本质"：讲技术/模型→模型；讲能用的工具→产品；讲生意/政策/公司动向→行业；讲观点/经验/怎么做→观点。

${list}

只输出 JSON（不要 markdown 代码块），格式：{"1":"类别名","2":"类别名",...}
键是上面的编号，值是类别名，必须覆盖 1 到 ${items.length} 全部。`;
}

async function classifyGroup(items, cats, defs) {
  if (!items.length) return {};
  const result = await chat([{ role: 'user', content: buildPrompt(items, cats, defs) }]);
  if (!result.success) throw new Error(`分类 LLM 调用失败: ${result.error}`);
  let parsed;
  try {
    parsed = JSON.parse(result.content.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim());
  } catch { return {}; }
  const valid = new Set([...cats, '其他']);
  const map = {};
  items.forEach((it, i) => { const c = parsed[String(i + 1)]; map[it.id] = valid.has(c) ? c : '其他'; });
  return map;
}

// 给未分类的内容批量补类别（同步后调用 + 存量回填）。force=true 时全量重分类。
export async function classifyUnclassified({ limit = 300, force = false } = {}) {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, COALESCE(zh_title, en_title) AS title, zh_summary AS summary, source_app
    FROM contents
    WHERE ${force ? '1=1' : 'category IS NULL'}
    ORDER BY datetime(COALESCE(published_at, created_at)) DESC
    LIMIT ?
  `).all(limit);
  db.close();
  if (!rows.length) return { classified: 0, total: 0 };

  const repos = rows.filter(r => r.source_app === 'github_trending');
  const arts = rows.filter(r => r.source_app !== 'github_trending');

  const map = {};
  const BATCH = 20; // 一批 20 条，控制单次 prompt 长度
  for (const [group, cats, defs] of [[arts, ARTICLE_CATS, ARTICLE_DEFS], [repos, REPO_CATS, REPO_DEFS]]) {
    for (let i = 0; i < group.length; i += BATCH) {
      try { Object.assign(map, await classifyGroup(group.slice(i, i + BATCH), cats, defs)); }
      catch (err) { console.error('[classify] 批失败:', err.message); }
    }
  }

  const db2 = getDatabase();
  const stmt = db2.prepare('UPDATE contents SET category = ? WHERE id = ?');
  let n = 0;
  for (const [id, cat] of Object.entries(map)) { stmt.run(cat, id); n++; }
  db2.close();
  console.log(`✅ 内容分类：${n}/${rows.length} 条已归类`);
  return { classified: n, total: rows.length };
}

// 各类别计数（供前端 chips 显示数量）。isRepo 决定统计文章流还是项目。
export function categoryCounts({ repo = false } = {}) {
  const db = getDatabase();
  const cond = repo ? "source_app = 'github_trending'" : "source_app != 'github_trending'";
  const rows = db.prepare(`SELECT category, COUNT(*) c FROM contents WHERE ${cond} AND category IS NOT NULL GROUP BY category`).all();
  db.close();
  const out = {};
  for (const r of rows) out[r.category] = r.c;
  return out;
}
