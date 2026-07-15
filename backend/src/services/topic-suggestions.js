import { getDatabase } from '../db/init.js';
import { chat } from './llm.js';

// 建议主题（"系统主动帮我发现主题"的入口，回应 2026-07-15 用户反馈）：
// 三个信号合流 → LLM 提炼 2-3 个候选 → 用户点"建页"才生效（提议权归系统，
// 拍板权归用户——不全自动建页，避免长出无人照看的僵尸活页，ADR-009 门槛延续）。
// 信号：① 近 7 天 Feed 热点聚类（stories） ② 近 14 天素材标题 ③ 最新简报的涌现建议
// 成本控制：每天最多算一次（app_meta 缓存按日期失效）；忽略过的名字不再提。

const META_KEY = 'topic_suggestions';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readMeta(db) {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(META_KEY);
  try { return row ? JSON.parse(row.value) : {}; } catch { return {}; }
}

function writeMeta(db, obj) {
  db.prepare(`
    INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(META_KEY, JSON.stringify(obj));
}

export async function getTopicSuggestions({ force = false } = {}) {
  const db = getDatabase();
  const meta = readMeta(db);
  const dismissed = meta.dismissed || [];

  if (!force && meta.date === todayKey() && Array.isArray(meta.suggestions)) {
    db.close();
    return meta.suggestions.filter(s => !dismissed.includes(s.name));
  }

  const stories = db.prepare(`
    SELECT headline, source_count FROM stories ORDER BY heat_score DESC LIMIT 8
  `).all();
  const noteTitles = db.prepare(`
    SELECT COALESCE(title, source_title, '') t FROM notes
    WHERE datetime(created_at) > datetime('now', '-14 days') ORDER BY created_at DESC LIMIT 20
  `).all().map(r => r.t).filter(Boolean);
  const existingTopics = db.prepare("SELECT name FROM topics WHERE status != 'archived'").all().map(r => r.name);
  const latestReport = db.prepare(`
    SELECT emergent FROM reports WHERE period_type IN ('weekly', 'monthly') ORDER BY created_at DESC LIMIT 1
  `).get();
  let emergentNames = [];
  try { emergentNames = (JSON.parse(latestReport?.emergent || '{}').newTopics || []).map(t => `${t.name}（${t.why}）`); } catch { /* 空 */ }

  if (!stories.length && !noteTitles.length) {
    db.close();
    return []; // 没有信号，不硬凑
  }

  const result = await chat([{
    role: 'user',
    content: `你是知识库管理者。根据一位 AI 产品经理/自媒体人的近期信息流信号，建议 2-3 个值得建立长期研究主题（活页）的方向。

# 近期热点聚类（他信息流里的多源事件）
${stories.map(s => `- 【${s.source_count}源】${s.headline}`).join('\n') || '（无）'}

# 他最近保存的素材
${noteTitles.join('；') || '（无）'}

# 简报涌现建议（已有分析）
${emergentNames.join('\n') || '（无）'}

# 已有主题（不要重复或换皮）
${existingTopics.join('；') || '（无）'}

输出 JSON 数组（不要 markdown 代码块）：
[{ "name": "主题名（6-12字名词短语）", "why": "为什么值得立页（30字内，点出信号依据）" }]

要求：只在信号确实支撑时建议（热点一闪而过的不算，要有"可持续研究"价值）；宁缺毋滥，没有就输出 []`,
  }]);

  let suggestions = [];
  if (result.success) {
    try {
      const cleaned = result.content.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
      suggestions = (JSON.parse(cleaned) || []).slice(0, 3)
        .map(s => ({ name: String(s.name || '').slice(0, 20), why: String(s.why || '').slice(0, 60) }))
        .filter(s => s.name && !existingTopics.includes(s.name));
    } catch { suggestions = []; }
  }

  writeMeta(db, { date: todayKey(), suggestions, dismissed });
  db.close();
  return suggestions.filter(s => !dismissed.includes(s.name));
}

// 忽略某个建议（今后不再提这个名字）
export function dismissSuggestion(name) {
  const db = getDatabase();
  const meta = readMeta(db);
  meta.dismissed = [...new Set([...(meta.dismissed || []), name])];
  writeMeta(db, meta);
  db.close();
  return true;
}
