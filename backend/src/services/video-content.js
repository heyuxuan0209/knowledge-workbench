const VIDEO_TYPES = new Set(['youtube', 'video']);

export function videoPlatformFromUrl(raw) {
  let url;
  try { url = new URL(String(raw || '')); } catch { return null; }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be' || /(^|\.)youtube\.com$/.test(host)) return 'youtube';
  if (host === 'b23.tv' || /(^|\.)bilibili\.com$/.test(host)) return 'bilibili';
  if (/(^|\.)(x|twitter)\.com$/.test(host)) return 'x';
  return null;
}

// X 链接本身不能证明含视频，必须结合摄入后的 type；YouTube/B站链接则天然是视频。
export function isVideoContent(data = {}, rawUrl = '') {
  if (VIDEO_TYPES.has(data?.type)) return true;
  if (/YouTube|B站视频/i.test(data?.metadata?.platform || '')) return true;
  const platform = videoPlatformFromUrl(rawUrl || data?.metadata?.sourceUrl || '');
  return platform === 'youtube' || platform === 'bilibili';
}

// 发送路由的唯一判定入口。旧扩展可能漏传 contentType，因此 YouTube/B站用 URL 兜底；
// X 链接则必须以摄入结果为准，避免把普通推文误送到视频机器人。
export function shouldDeliverAsVideo({ contentType, url, cached } = {}) {
  return contentType === 'video' || isVideoContent(cached || {}, url);
}

export function deriveVideoSourceState(data = {}, source = null) {
  const explicit = source?.status || data.sourceStatus;
  if (['full', 'partial', 'failed'].includes(explicit)) return explicit;
  const note = `${source?.note || ''} ${data.note || ''}`;
  if (/转写失败|未能获取.*转写|仅解读.*文字|不代表视频内容/i.test(note)) return 'failed';
  if (source?.truncated || data.sourceTruncated || data.truncated
      || data.coverage?.mode === 'partial-transcript-map-reduce'
      || /前\s*\d+\s*分钟|部分覆盖|只取得.*前段/i.test(note)) return 'partial';
  return 'full';
}

export function videoSourceWarning(state, data = {}, source = null) {
  const note = source?.note || data.note || '';
  if (state === 'failed') {
    return note || '未取得视频字幕或音频转写，本次只基于随附文字，不能代表视频完整内容。';
  }
  if (state === 'partial') {
    return note || '本次只取得视频部分转写，不能代表完整视频。';
  }
  return null;
}
