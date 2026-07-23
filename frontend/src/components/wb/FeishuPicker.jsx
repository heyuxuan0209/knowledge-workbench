import { useState, useEffect } from 'react'
import { api } from './util'
import { IconFeishu } from './Icons'

// 可复用的「从飞书取料」小面板（ADR-039）：搜整个飞书 / 看最近 / 连接态。选中一篇 → onPick(item)。
// 自包含（自己调 status/pick/search），只需 onPick + showToast。用于创作台左栏（也可给即时分析复用）。
export default function FeishuPicker({ onPick, showToast }) {
  const [connected, setConnected] = useState(null)
  const [list, setList] = useState(null)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [picking, setPicking] = useState(null)

  useEffect(() => {
    api('/api/feishu/oauth/status').then(j => setConnected(!!j.data?.connected)).catch(() => {})
    setLoading(true)
    api('/api/feishu/pick').then(j => setList(j.data || [])).catch(() => setList([])).finally(() => setLoading(false))
  }, [])

  const doSearch = async () => {
    const s = q.trim()
    if (!s) { setResults(null); return }
    setSearching(true)
    try { const j = await api(`/api/feishu/search?q=${encodeURIComponent(s)}`); setResults(j.data || []) }
    catch (e) { setResults([]); showToast?.('飞书搜索失败：' + e.message) }
    setSearching(false)
  }
  const pick = async (item) => {
    setPicking(item.feishuId)
    try { await onPick?.(item) } finally { setPicking(null) }
  }
  const searched = results !== null
  const shown = searched ? results : (list || [])

  return (
    <div className="wb-fsdoor" style={{ marginTop: 8 }}>
      <div className="wb-fsdoor-h">
        <span className="wb-src-fs"><IconFeishu size={16} /></span>
        <b>从飞书取料</b>
        <span className="sub2">搜/挑一篇 → 存进素材台</span>
        {connected === true && <span className="wb-fs-connected">已连接 ✓</span>}
      </div>
      {connected === false && (
        <div className="wb-fs-connectbar" style={{ margin: '6px 0' }}>
          <span>连接飞书后能读你<b>全部</b>文档（现在只读共享的）。</span>
          <button className="wb-btn-primary" style={{ padding: '3px 10px', fontSize: 11.5 }}
            onClick={() => window.open('/api/feishu/oauth/start', '_blank')}>连接飞书 →</button>
        </div>
      )}
      <div className="wb-fsdoor-search" style={{ marginTop: 6 }}>
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) doSearch() }}
          placeholder="搜飞书文档（关键词，搜整个飞书）…" />
        <button className="wb-btn-primary" style={{ padding: '7px 12px', fontSize: 12 }} disabled={searching} onClick={doSearch}>{searching ? '搜…' : '搜'}</button>
        {searched && <button className="wb-fsdoor-clear" onClick={() => { setQ(''); setResults(null) }}>看最近</button>}
      </div>
      <div className="wb-fsdoor-list" style={{ maxHeight: 200 }}>
        {(loading || searching) && <div className="wb-fs-empty">{searching ? '搜索中…' : '读取…'}</div>}
        {!loading && !searching && shown.length === 0 && (
          <div className="wb-fs-empty">{searched ? '没搜到匹配的' : '没最近内容——上面搜一下'}</div>
        )}
        {!loading && !searching && shown.map(it => (
          <button key={it.feishuId} className="wb-fs-pick-item" disabled={picking === it.feishuId} onClick={() => pick(it)}>
            <span className="ty">{it.sourceName || '云文档'}</span>
            <span className="nm">{it.title || '(无标题)'}</span>
            <span className="go">{picking === it.feishuId ? '拉取中…' : '拉进素材 →'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
