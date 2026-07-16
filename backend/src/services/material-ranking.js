import { getNotes } from '../db/notes.js';
import { tokenize } from './story-clustering.js';
import { cosineTF } from './topic-pages.js';

// 创作台「可插入素材」相关性排序（2026-07-16 用户实测：右侧素材按保存时间倒序，
// 写 AI agent 文章时最上面却是不相关的机器人文章）。用主题匹配同款 TF 余弦
// （本地零成本，不调 LLM）把素材按"与当前草稿的相关度"排序。
//
// 复用 topic-pages.cosineTF：中文 bigram + 英文词，共享词 <2 判 0 分（防泛词，ADR-019）。
// 相关性只是排序信号——低分素材不隐藏（用户可能就想插入一条冷门素材），只沉底并标注。

const RELATED_THRESHOLD = 0.03; // 低于此视为"关联弱"，仅用于打标，不过滤

// draftText: 当前草稿正文（前端传标题+正文前段即可）
// topicId: 从主题起稿时的主题 id，命中该主题的素材加权提前（保留原"本主题优先"语义）
export function rankMaterials(draftText, topicId = null, limit = 60) {
  const notes = getNotes({ limit });
  const draftTokens = tokenize(draftText || '');

  const scored = notes.map(n => {
    const isMine = Boolean(topicId && (n.topic_ids || '').split(',').includes(topicId));
    // 草稿为空（还没开始写）时退化为原行为：本主题优先 + 时间序，score 记 0
    const { score, terms } = draftTokens.length
      ? cosineTF(tokenize(`${n.title || n.source_title || ''} ${n.excerpt || ''}`), draftTokens)
      : { score: 0, terms: [] };
    // 本主题素材加一个固定加权，保证"手动归类进本主题"的素材不会被相关度算法完全埋掉
    const rank = score + (isMine ? 0.5 : 0);
    return { ...n, relScore: score, relTerms: terms, isMine, related: score >= RELATED_THRESHOLD, _rank: rank };
  });

  // 有草稿内容 → 按相关度（含本主题加权）降序；完全同分（如草稿为空）→ 保持时间序
  scored.sort((a, b) => b._rank - a._rank);
  return scored.map(({ _rank, ...n }) => n);
}
