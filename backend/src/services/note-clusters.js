import { getDatabase } from '../db/init.js';

// 未归类素材的聚合建议（2026-07-16 反馈 #4：让用户自己建主题太重 →
// AI 提议"哪些放一起、为什么"，用户裁决）。
// 零 LLM：按共享关键词标签聚类——标签本身是保存素材时 AI 提取的（M7），
// 相当于智力已离线花过；"为什么"= 展示共享关键词，可解释不是黑盒。

function safeKw(s) {
  try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

const norm = (k) => k.trim().toLowerCase();

export function getClusterSuggestions() {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT n.id, n.title, n.source_title, n.keywords
    FROM notes n
    WHERE NOT EXISTS (SELECT 1 FROM note_topics nt WHERE nt.note_id = n.id)
    ORDER BY n.created_at DESC LIMIT 100
  `).all();
  db.close();

  const notes = rows
    .map(r => ({ id: r.id, title: r.title || r.source_title || '（未命名素材）', kws: safeKw(r.keywords).map(norm) }))
    .filter(n => n.kws.length);
  if (notes.length < 2) return [];

  // 泛化词过滤：出现在超过 60% 未归类素材里的关键词（如"AI"）不构成"相关"的证据
  const freq = new Map();
  for (const n of notes) for (const k of new Set(n.kws)) freq.set(k, (freq.get(k) || 0) + 1);
  const generic = new Set([...freq].filter(([, c]) => c > Math.max(2, notes.length * 0.6)).map(([k]) => k));

  // 倒排 → 共享≥1 个非泛化关键词即连边 → 并查集聚类
  const parent = new Map(notes.map(n => [n.id, n.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const byKw = new Map();
  for (const n of notes) {
    for (const k of new Set(n.kws)) {
      if (generic.has(k)) continue;
      if (!byKw.has(k)) byKw.set(k, []);
      byKw.get(k).push(n.id);
    }
  }
  for (const ids of byKw.values()) for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);

  const groups = new Map();
  for (const n of notes) {
    const root = find(n.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n);
  }

  const suggestions = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // 共享关键词 = 在 ≥2 个成员中出现的非泛化词，按覆盖数排序
    const count = new Map();
    for (const m of members) for (const k of new Set(m.kws)) {
      if (!generic.has(k)) count.set(k, (count.get(k) || 0) + 1);
    }
    const shared = [...count].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    if (!shared.length) continue;
    suggestions.push({
      noteIds: members.map(m => m.id),
      notes: members.map(m => ({ id: m.id, title: m.title })),
      sharedKeywords: shared.slice(0, 5),
      // 建议名 = 覆盖最广的共享词（用户可改，改名零成本）
      suggestedName: shared[0],
    });
  }
  // 大组排前（信号更强）
  return suggestions.sort((a, b) => b.noteIds.length - a.noteIds.length);
}
