// 共享工具与常量（Workbench UI v2）

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!json.success && json.success !== undefined && json.data === undefined) {
    throw new Error(json.error || `HTTP ${res.status}`)
  }
  return json
}

export function timeAgo(isoString) {
  if (!isoString) return ''
  const t = new Date(/[zZ+]/.test(isoString) ? isoString : isoString + 'Z').getTime()
  const diff = Date.now() - t
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return '刚刚'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// track_mode 四档配色与中文（与原型 MODES 一致）
export const MODES = {
  'passive': { fg: '#706b60', bg: 'rgba(33,31,26,.08)', cn: '仅标记加权' },
  'active-rss': { fg: '#3f7350', bg: 'rgba(63,115,80,.12)', cn: 'RSS 轮询' },
  'active-query': { fg: '#3d5a80', bg: 'rgba(61,90,128,.12)', cn: '主动查询' },
  'link-only': { fg: '#a9791f', bg: 'rgba(169,121,31,.12)', cn: '仅标记跳转' },
}

export const STANCE_COLORS = {
  '同意': { fg: '#3f7350', bg: 'rgba(63,115,80,.12)' },
  agree: { fg: '#3f7350', bg: 'rgba(63,115,80,.12)' },
  '反对': { fg: '#a24b3f', bg: 'rgba(162,75,63,.12)' },
  disagree: { fg: '#a24b3f', bg: 'rgba(162,75,63,.12)' },
  '存疑': { fg: '#a9791f', bg: 'rgba(169,121,31,.12)' },
  doubt: { fg: '#a9791f', bg: 'rgba(169,121,31,.12)' },
}
export const STANCE_CN = { agree: '同意', disagree: '反对', doubt: '存疑' }

export const TYPE_LABEL = {
  article: 'Article', video: 'Video', tweet: 'X', paper: 'Paper', repo: 'Repo', text: 'Text',
}

// 来源抓取能力（NotebookLM 式来源区分）：选中时就告知用户该条能拿到什么
// full=可抓原文 / summary=只有摘要（公众号/无链接）/ video=依赖字幕
export function sourceCapability(c) {
  if (!c) return { level: 'full', label: '原文' }
  const url = c.url || ''
  if (url.includes('mp.weixin.qq.com')) return { level: 'summary', label: '仅摘要' }
  if (c.content_type === 'video') return { level: 'video', label: '依赖字幕' }
  if (c.content_type === 'tweet') return { level: 'full', label: '原文' }
  if (!url || c.content_type === 'text') return { level: 'summary', label: '仅摘要' }
  return { level: 'full', label: '原文' }
}

// SSE 流式对话（/api/chat/ephemeral），onDelta 增量回调、onMeta 降级清单回调，返回完整文本
export async function streamEphemeralChat({ contentIds, adHocContents, messages }, onDelta, onMeta) {
  const res = await fetch('/api/chat/ephemeral', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentIds, adHocContents, messages }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const event = JSON.parse(line.slice(6))
      if (event.type === 'content') { full += event.content; onDelta(full) }
      else if (event.type === 'meta') { onMeta?.(event.degraded || []) }
      else if (event.type === 'error') throw new Error(event.error)
    }
  }
  return full
}
