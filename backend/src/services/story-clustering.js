import { getDatabase } from '../db/init.js';
import { randomUUID } from 'crypto';
import { embedBatch, cosine as vecCosine, MODEL_NAME } from './embeddings.js';
import { TRUST_RANK } from './trust-tier.js';

// Story 聚类（M2 洞察层，ADR-008；P1 层3 升级为 bge-m3 事件簇，ADR-040）：
// 把近 N 天的 Feed 内容按"讲同一件事"聚成事件簇，主条按信任档选（官方 > 官方号 > KOL），
// 其余折叠成"另有 N 个来源报道"——解决"同一件事 N 个来源重复轰炸"。
//
// 升级点（原 TF-IDF bigram 0.25 → bge-m3 语义 0.80）：
// - 复用本地 bge-m3 向量（embeddings.js，零 API 成本），存进 contents.embedding（schema 预留）增量嵌入；
// - 贪心聚类：按热度降序遍历，与簇质心的向量余弦超阈值(0.80)则并入，否则自成一簇（素材查重 0.85 供参照，
//   事件簇取略低，因不同来源改写同一事件比"重复素材"差异更大）；质心存进 stories.centroid_embedding（预留字段）；
// - 主条按 trust tier 选（TRUST_RANK：T1 官方一手 > T1.5 官方号 > T2 KOL/媒体），同档比热度/新鲜度。
//
// tokenize 仍导出（material-ranking / topic-pages / period-report 复用其中文 bigram 分词，勿删）。

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are',
  'was', 'be', 'by', 'at', 'as', 'it', 'its', 'this', 'that', 'from', 'how', 'why',
  'what', 'your', 'you', 'we', 'our', 'new', 'via', 'using', 'use', 'can', 'will',
  'not', 'has', 'have', 'about', 'into', 'more', 'their', 'ask', 'show',
]);

// 中文常见虚词/低信息 bigram 的首字符（粗过滤即可，不追求完美）
const ZH_STOP_CHARS = new Set('的了在是和与及或对于从被把等这那其中我们你他它没有一个'.split(''));

export function tokenize(text) {
  if (!text) return [];
  const tokens = [];

  // 英文词
  for (const m of text.toLowerCase().matchAll(/[a-z][a-z0-9+#.-]{1,}/g)) {
    if (!STOPWORDS.has(m[0])) tokens.push(m[0]);
  }

  // 中文 bigram
  const zh = text.match(/[一-龥]/g) || [];
  for (let i = 0; i < zh.length - 1; i++) {
    if (ZH_STOP_CHARS.has(zh[i]) || ZH_STOP_CHARS.has(zh[i + 1])) continue;
    tokens.push(zh[i] + zh[i + 1]);
  }

  return tokens;
}

// 内容嵌入（增量）：给缺向量 / 换过模型的条目补 bge-m3 向量，存进 contents.embedding。
// 返回 id → 向量数组（含库里已存的），供聚类用。
async function ensureContentEmbeddings(db, contents) {
  const embedText = (c) => `${c.zh_title || c.en_title || ''} ${c.zh_summary || ''}`.trim();
  const need = contents.filter(c => !c.embedding || c.embedding_model !== MODEL_NAME);
  if (need.length) {
    const upd = db.prepare("UPDATE contents SET embedding = ?, embedding_model = ? WHERE id = ?");
    const BATCH = 32;
    for (let i = 0; i < need.length; i += BATCH) {
      const batch = need.slice(i, i + BATCH);
      const vecs = await embedBatch(batch.map(embedText));
      for (let j = 0; j < batch.length; j++) {
        const json = JSON.stringify(vecs[j]);
        upd.run(json, MODEL_NAME, batch[j].id);
        batch[j].embedding = json; // 供本次聚类直接用
      }
    }
    console.log(`  🧠 事件簇：新增嵌入 ${need.length} 条内容`);
  }
  const byId = new Map();
  for (const c of contents) {
    try { const v = JSON.parse(c.embedding); if (Array.isArray(v) && v.length) byId.set(c.id, v); } catch { /* 跳过坏向量 */ }
  }
  return byId;
}

// 贪心向量聚类。threshold 0.80：bge-m3 归一化余弦下，"同一事件不同来源"通常 ≥0.8，
// 相关但不同事件在 0.5-0.7，据此分开（素材查重用 0.85，事件簇取略低）。质心=成员均值重归一化。
export function clusterByVectors(contents, byId, threshold = 0.80) {
  const sorted = [...contents].sort((a, b) => (b.external_score || 0) - (a.external_score || 0));
  const clusters = []; // { memberIds:[], centroid:[number], n }
  for (const content of sorted) {
    const v = byId.get(content.id);
    if (!v) continue;
    let best = null, bestSim = threshold;
    for (const cl of clusters) {
      const sim = vecCosine(v, cl.centroid);
      if (sim > bestSim) { best = cl; bestSim = sim; }
    }
    if (best) {
      best.memberIds.push(content.id);
      const cen = best.centroid, n = best.n;
      for (let k = 0; k < cen.length; k++) cen[k] = (cen[k] * n + v[k]) / (n + 1); // 增量均值
      let nrm = 0; for (const x of cen) nrm += x * x; nrm = Math.sqrt(nrm) || 1;
      for (let k = 0; k < cen.length; k++) cen[k] /= nrm; // 重归一化，保持点积=余弦
      best.n = n + 1;
    } else {
      clusters.push({ memberIds: [content.id], centroid: v.slice(), n: 1 });
    }
  }
  return clusters;
}

// 簇内选主条：信任档优先（T1>T1.5>T2），同档比外部热度，再比新鲜度
function pickPrimary(members) {
  return [...members].sort((a, b) =>
    (TRUST_RANK[a.trust_tier] ?? 9) - (TRUST_RANK[b.trust_tier] ?? 9) ||
    (b.external_score || 0) - (a.external_score || 0) ||
    (new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at))
  )[0];
}

// 热度：独立内容数为主 + 新鲜度衰减 + 平台评分微调
function heatScore(members, now) {
  const freshest = Math.max(...members.map(m => new Date(m.published_at || m.created_at).getTime()));
  const ageHours = Math.max(0, (now - freshest) / 3600000);
  const freshness = Math.exp(-ageHours / 48); // 48h 半衰
  const avgScore = members.reduce((s, m) => s + (m.external_score || 0), 0) / members.length;
  return Math.round((members.length * 10 * freshness + avgScore / 10) * 10) / 10;
}

// 重建近 N 天的 stories（全删重建：聚类是派生数据，无需增量维护）。
// 异步：需要给内容补 bge-m3 向量（增量，首轮较慢、之后缓存秒级）。
export async function rebuildStories(days = 7, { threshold = 0.80 } = {}) {
  const db = getDatabase();
  const contents = db.prepare(`
    SELECT c.id, c.zh_title, c.en_title, c.zh_summary, c.published_at, c.created_at,
           c.external_score, c.source_id, c.embedding, c.embedding_model,
           COALESCE(s.trust_tier, 'T2') AS trust_tier
    FROM contents c
    LEFT JOIN sources s ON c.source_id = s.id
    WHERE datetime(COALESCE(c.published_at, c.created_at)) > datetime('now', ?)
      AND c.source_app != 'github_trending'
  `).all(`-${days} days`);

  const byId = await ensureContentEmbeddings(db, contents);
  const clusters = clusterByVectors(contents, byId, threshold).filter(c => c.memberIds.length >= 2);
  const byContent = new Map(contents.map(c => [c.id, c]));
  const now = Date.now();

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM story_contents;');
    db.exec('DELETE FROM stories;');

    const insertStory = db.prepare(`
      INSERT INTO stories (id, headline, centroid_embedding, heat_score, source_count, first_seen_at, last_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLink = db.prepare('INSERT INTO story_contents (story_id, content_id) VALUES (?, ?)');

    for (const cluster of clusters) {
      const members = cluster.memberIds.map(id => byContent.get(id));
      const rep = pickPrimary(members); // 主条：信任档优先
      const times = members.map(m => m.published_at || m.created_at).sort();

      const storyId = randomUUID();
      insertStory.run(
        storyId,
        rep.zh_title || rep.en_title || '(无标题)',
        JSON.stringify(cluster.centroid),
        heatScore(members, now),
        members.length,
        times[0],
        times[times.length - 1]
      );
      for (const id of cluster.memberIds) insertLink.run(storyId, id);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  const count = db.prepare('SELECT COUNT(*) c FROM stories').get().c;
  db.close();
  console.log(`✅ Stories rebuilt (bge-m3, thr=${threshold}): ${count} clusters from ${contents.length} contents (last ${days} days)`);
  return { stories: count, contents: contents.length };
}

// 近期焦点：stories + 成员内容（标题/来源/信任档），按热度排序。
// 成员按信任档排序 → members[0] 即主条（官方优先），前端把其余折叠成"另有 N 个来源报道"。
export function getStories(limit = 10) {
  const db = getDatabase();
  const stories = db.prepare(`
    SELECT * FROM stories ORDER BY heat_score DESC LIMIT ?
  `).all(limit);

  const memberStmt = db.prepare(`
    SELECT c.id, c.zh_title, c.en_title, c.url, c.source_app, c.external_score, c.published_at, c.content_type,
           s.display_name AS source_display_name, COALESCE(s.trust_tier, 'T2') AS trust_tier
    FROM story_contents sc
    JOIN contents c ON sc.content_id = c.id
    LEFT JOIN sources s ON c.source_id = s.id
    WHERE sc.story_id = ?
  `);
  for (const story of stories) {
    const members = memberStmt.all(story.id);
    members.sort((a, b) =>
      (TRUST_RANK[a.trust_tier] ?? 9) - (TRUST_RANK[b.trust_tier] ?? 9) ||
      (b.external_score || 0) - (a.external_score || 0)
    );
    story.members = members;
  }
  db.close();
  return stories;
}
