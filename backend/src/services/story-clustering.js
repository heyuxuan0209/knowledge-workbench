import { getDatabase } from '../db/init.js';
import { randomUUID } from 'crypto';

// Story 聚类（M2 洞察层，ADR-008）：把近 N 天的 Feed 内容按"讲同一件事"粗粒度分组，
// 驱动"近期焦点"模块和日报生成。只基于用户自己的信息流，不做全网挖掘。
//
// 实现约束（TBD-003 决议）：不用向量库/Embedding。轻量 TF-IDF + 余弦相似度：
// - 分词：英文按词（小写），中文按 bigram（无需分词库，对短标题+摘要足够）
// - 贪心聚类：按热度降序遍历，与已有簇的质心相似度超过阈值则并入，否则自成一簇
// - 只保留 >= 2 条内容的簇（单条不构成"焦点"）
//
// 范围声明（沿用 schema-v3 §6）：只做粗粒度分组供排序展示，不追求精确事件级去重。

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

function buildTfIdfVectors(docs) {
  // docs: [{id, tokens}]
  const df = new Map();
  for (const doc of docs) {
    for (const t of new Set(doc.tokens)) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = docs.length;

  return docs.map(doc => {
    const tf = new Map();
    for (const t of doc.tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const vec = new Map();
    let norm = 0;
    for (const [t, f] of tf) {
      const idf = Math.log(1 + N / (df.get(t) || 1));
      const w = f * idf;
      vec.set(t, w);
      norm += w * w;
    }
    return { id: doc.id, vec, norm: Math.sqrt(norm) || 1 };
  });
}

function cosine(a, b) {
  // 遍历较小的向量
  const [small, big] = a.vec.size <= b.vec.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small.vec) {
    const w2 = big.vec.get(t);
    if (w2) dot += w * w2;
  }
  return dot / (a.norm * b.norm);
}

// 贪心聚类。threshold 经验值：bigram TF-IDF 下 0.25 能把"同一事件不同来源"聚起来，
// 又不至于把泛主题（都提到 AI）误并。
export function clusterContents(contents, threshold = 0.25) {
  const docs = contents.map(c => ({
    id: c.id,
    tokens: tokenize(`${c.zh_title || ''} ${c.en_title || ''} ${c.zh_summary || ''}`),
  }));
  const vectors = buildTfIdfVectors(docs);
  const byId = new Map(vectors.map(v => [v.id, v]));

  // 按外部评分降序：热内容优先成簇心
  const sorted = [...contents].sort((a, b) => (b.external_score || 0) - (a.external_score || 0));

  const clusters = []; // { memberIds: [], centroid: {vec, norm} }
  for (const content of sorted) {
    const v = byId.get(content.id);
    if (!v || v.vec.size === 0) continue;

    let best = null;
    let bestSim = threshold;
    for (const cluster of clusters) {
      const sim = cosine(v, cluster.centroid);
      if (sim > bestSim) { best = cluster; bestSim = sim; }
    }

    if (best) {
      best.memberIds.push(content.id);
      // 质心增量更新：合并词权（简单求和后重归一化）
      for (const [t, w] of v.vec) {
        best.centroid.vec.set(t, (best.centroid.vec.get(t) || 0) + w);
      }
      let norm = 0;
      for (const w of best.centroid.vec.values()) norm += w * w;
      best.centroid.norm = Math.sqrt(norm) || 1;
    } else {
      clusters.push({ memberIds: [content.id], centroid: { vec: new Map(v.vec), norm: v.norm } });
    }
  }

  return clusters;
}

// 热度：独立内容数为主 + 新鲜度衰减 + 平台评分微调
function heatScore(members, now) {
  const freshest = Math.max(...members.map(m => new Date(m.published_at || m.created_at).getTime()));
  const ageHours = Math.max(0, (now - freshest) / 3600000);
  const freshness = Math.exp(-ageHours / 48); // 48h 半衰
  const avgScore = members.reduce((s, m) => s + (m.external_score || 0), 0) / members.length;
  return Math.round((members.length * 10 * freshness + avgScore / 10) * 10) / 10;
}

// 重建近 N 天的 stories（全删重建：聚类是派生数据，无需增量维护）
export function rebuildStories(days = 7) {
  const db = getDatabase();
  const contents = db.prepare(`
    SELECT id, zh_title, en_title, zh_summary, published_at, created_at, external_score, source_id
    FROM contents
    WHERE datetime(COALESCE(published_at, created_at)) > datetime('now', ?)
  `).all(`-${days} days`);

  const clusters = clusterContents(contents).filter(c => c.memberIds.length >= 2);
  const byId = new Map(contents.map(c => [c.id, c]));
  const now = Date.now();

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM story_contents;');
    db.exec('DELETE FROM stories;');

    const insertStory = db.prepare(`
      INSERT INTO stories (id, headline, heat_score, source_count, first_seen_at, last_updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertLink = db.prepare('INSERT INTO story_contents (story_id, content_id) VALUES (?, ?)');

    for (const cluster of clusters) {
      const members = cluster.memberIds.map(id => byId.get(id));
      // 代表标题：评分最高的成员（日报生成时 LLM 会重新起标题，这里够用）
      const rep = members.reduce((a, b) => ((b.external_score || 0) > (a.external_score || 0) ? b : a));
      const times = members.map(m => m.published_at || m.created_at).sort();

      const storyId = randomUUID();
      insertStory.run(
        storyId,
        rep.zh_title || rep.en_title || '(无标题)',
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
  console.log(`✅ Stories rebuilt: ${count} clusters from ${contents.length} contents (last ${days} days)`);
  return { stories: count, contents: contents.length };
}

// 近期焦点：stories + 成员内容（标题/来源），按热度排序
export function getStories(limit = 10) {
  const db = getDatabase();
  const stories = db.prepare(`
    SELECT * FROM stories ORDER BY heat_score DESC LIMIT ?
  `).all(limit);

  const memberStmt = db.prepare(`
    SELECT c.id, c.zh_title, c.en_title, c.url, c.source_app, c.external_score, c.published_at,
           s.display_name AS source_display_name
    FROM story_contents sc
    JOIN contents c ON sc.content_id = c.id
    LEFT JOIN sources s ON c.source_id = s.id
    WHERE sc.story_id = ?
    ORDER BY c.external_score DESC
  `);
  for (const story of stories) {
    story.members = memberStmt.all(story.id);
  }
  db.close();
  return stories;
}
