import { getDatabase } from '../db/init.js';
import { chat } from './llm.js';

// 内容分类（VISION-V4 UI 改造 2b）：DeepSeek 批量把每条内容归到一个类别，缓存进 contents.category。
// 文章与 GitHub 项目用不同类目（前端两个 Tab 分别出 chips）。成本≈几厘/批，只分类未分类的、不重算。

export const ARTICLE_CATS = ['模型', '产品', '行业', '观点方法'];
export const REPO_CATS = ['工具Agent', '模型', '应用', '基建'];

function buildPrompt(items, cats) {
  const list = items.map((it, i) => `${i + 1}. ${(it.title || '').slice(0, 80)}${it.summary ? ' —— ' + it.summary.slice(0, 80) : ''}`).join('\n');
  return `你是 AI 领域内容编辑。把下面每条内容归到**唯一一个**最贴切的类别。
类别只能从这些里选：${cats.join(' / ')}；都不合适才用「其他」。

${list}

只输出 JSON（不要 markdown 代码块），格式：{"1":"类别名","2":"类别名",...}
键是上面的编号，值是类别名，必须覆盖 1 到 ${items.length} 全部。`;
}

async function classifyGroup(items, cats) {
  if (!items.length) return {};
  const result = await chat([{ role: 'user', content: buildPrompt(items, cats) }]);
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
  for (const [group, cats] of [[arts, ARTICLE_CATS], [repos, REPO_CATS]]) {
    for (let i = 0; i < group.length; i += BATCH) {
      try { Object.assign(map, await classifyGroup(group.slice(i, i + BATCH), cats)); }
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
