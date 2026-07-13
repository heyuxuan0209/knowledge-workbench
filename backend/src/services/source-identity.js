// AI HOT 的 source 字段写法: "MarkTechPost（RSS）" / "X：阿易 AI Notes (@AYi_AInotes)"
// 只在能明确解析出人名 + handle 时才创建 Source，媒体名（RSS 源）不算"人"，source_id 留空。
// 被 aihot.js（持续同步）和 migrate-v3.js（历史数据迁移）共用，避免两处正则各自维护后跑偏。
export function parseAuthorFromAIHotSource(sourceText) {
  if (!sourceText) return null;

  const xMatch = sourceText.match(/^X[：:]\s*(.+?)\s*\(@([\w_]+)\)$/);
  if (xMatch) {
    return { displayName: xMatch[1].trim(), platform: 'X', handle: xMatch[2] };
  }

  return null;
}

export function detectContentType(url) {
  if (!url) return 'text';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'video';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'tweet';
  if (url.includes('github.com')) return 'repo';
  if (url.includes('arxiv.org')) return 'paper';
  return 'article';
}
