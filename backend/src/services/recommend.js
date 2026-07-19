import { getDatabase } from '../db/init.js';
import { embedBatch, cosine } from './embeddings.js';

// 为你推荐（VISION-V4 UI 改造 2b）：把近期内容和你的主题做语义匹配，取最相关的几条 + 理由。
// 复用 1a 向量层：主题综述向量 vs 候选内容向量，余弦最高的主题即"关联理由"。
// 排除已星标/已存素材（别推你看过的）和 GitHub 项目（那是项目 Tab）。阈值 0.5（bge-m3 上算相关）。

export async function getRecommendations({ limit = 3, windowDays = 3, maxCandidates = 40 } = {}) {
  const db = getDatabase();
  const candidates = db.prepare(`
    SELECT c.id, COALESCE(c.zh_title, c.en_title) AS title, c.zh_summary AS summary,
           c.url, c.permalink, c.category
    FROM contents c
    WHERE c.source_app != 'github_trending'
      AND datetime(COALESCE(c.published_at, c.created_at)) > datetime('now', '-' || ? || ' days')
      AND c.starred = 0
      AND c.id NOT IN (SELECT content_id FROM notes WHERE content_id IS NOT NULL)
    ORDER BY c.external_score DESC, datetime(COALESCE(c.published_at, c.created_at)) DESC
    LIMIT ?
  `).all(windowDays, maxCandidates);
  const topics = db.prepare('SELECT id, name, description, body FROM topics').all();
  db.close();

  if (!candidates.length || !topics.length) return [];

  const topicTexts = topics.map(t => {
    let b = {}; try { b = JSON.parse(t.body || '{}'); } catch { /* noop */ }
    return `${t.name}。${(b.current || t.description || '').slice(0, 1500)}`;
  });
  const [topicVecs, candVecs] = await Promise.all([
    embedBatch(topicTexts, { isQuery: false }),
    embedBatch(candidates.map(c => `${c.title} ${c.summary || ''}`), { isQuery: false }),
  ]);

  const scored = candidates.map((c, i) => {
    let best = { score: -1, topic: null };
    topicVecs.forEach((tv, j) => { const s = cosine(candVecs[i], tv); if (s > best.score) best = { score: s, topic: topics[j] }; });
    return { c, score: best.score, topic: best.topic };
  });
  scored.sort((a, b) => b.score - a.score);

  return scored
    .filter(r => r.score >= 0.5)
    .slice(0, limit)
    .map(r => ({
      id: r.c.id,
      title: r.c.title,
      url: r.c.permalink || r.c.url,
      category: r.c.category,
      reason: `关联你的主题「${r.topic.name}」`,
      topicId: r.topic.id,
      score: Math.round(r.score * 1000) / 1000,
    }));
}

// 缓存：推荐计算要嵌入几十条内容（bge-m3 上约 10s），不能每次进 feed 都算。
// 存 app_meta，前端读缓存秒回；由 cron/启动刷新。
export async function refreshRecommendations() {
  const recs = await getRecommendations();
  const db = getDatabase();
  db.prepare("INSERT OR REPLACE INTO app_meta(key, value) VALUES('recommendations', ?)").run(JSON.stringify(recs));
  db.close();
  console.log(`✅ 为你推荐已刷新：${recs.length} 条`);
  return recs;
}

export function getCachedRecommendations() {
  const db = getDatabase();
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'recommendations'").get();
  db.close();
  try { return row ? JSON.parse(row.value) : []; } catch { return []; }
}
