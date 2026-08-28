/**
 * 计算可写入发布复盘表的互动率。
 *
 * 某些平台会返回互不兼容的累计口径（例如曝光 1、点赞 3）。这种情况下
 * 算出来的 300% 不是可比较的互动率，宁可留空，也不能污染复盘。
 */
export function safeInteractionRate(interactions, base) {
  const n = Number(interactions);
  const d = Number(base);
  if (!Number.isFinite(n) || !Number.isFinite(d) || n < 0 || d <= 0 || n > d) return null;
  return Number((n / d).toFixed(4));
}
