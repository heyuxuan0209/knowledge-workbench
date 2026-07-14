import { useState, useEffect, useCallback } from 'react'

// 信息源登记处（M1 沉淀层，ADR-007）：丢链接/公众号名称 → 自动识别 → 确认登记。
// 登记效果：该源内容进 Feed + 高权重排序。不是订阅系统。

const TRACK_MODE_LABEL = {
  'passive': '被动推送 · 零成本',
  'active-rss': 'RSS 轮询',
  'active-query': '主动查询（M2 接入）',
  'link-only': '仅标记跳转',
}

export default function SourcesView() {
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [identifying, setIdentifying] = useState(false)
  const [preview, setPreview] = useState(null)   // identify 返回的预览，确认后 register
  const [error, setError] = useState(null)

  const loadSources = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sources?registered=1')
      const json = await res.json()
      if (json.success) setSources(json.data)
    } catch (err) {
      console.error('Failed to fetch sources:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadSources() }, [loadSources])

  const handleIdentify = async () => {
    const value = input.trim()
    if (!value || identifying) return
    setIdentifying(true)
    setError(null)
    setPreview(null)
    try {
      const res = await fetch('/api/sources/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: value })
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setPreview(json.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setIdentifying(false)
    }
  }

  const handleRegister = async () => {
    if (!preview) return
    try {
      const res = await fetch('/api/sources/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identified: preview })
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setPreview(null)
      setInput('')
      loadSources()
    } catch (err) {
      setError(`登记失败：${err.message}`)
    }
  }

  const handleUnregister = async (id, name) => {
    if (!confirm(`取消关注「${name}」？（历史内容不受影响，只是不再加权/追踪）`)) return
    try {
      await fetch(`/api/sources/${id}/register`, { method: 'DELETE' })
      setSources(prev => prev.filter(s => s.id !== id))
    } catch (err) {
      alert(`操作失败：${err.message}`)
    }
  }

  return (
    <div className="sources-view">
      <div className="view-header">
        <h2>信息源</h2>
        <span className="view-subtitle">
          登记优质源：内容进 Feed 并高权重排序。支持 X 链接 / YouTube 频道 / 博客网址 / 公众号名称
        </span>
      </div>

      <div className="source-add-bar">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleIdentify() }}
          placeholder="粘贴 X/YouTube/博客链接，或输入公众号名称..."
        />
        <button className="btn-analyze" disabled={!input.trim() || identifying} onClick={handleIdentify}>
          {identifying ? '识别中...' : '识别'}
        </button>
      </div>

      {error && <div className="source-error">{error}</div>}

      {preview && (
        <div className="source-preview">
          <div className="source-preview-title">识别结果（可修改名称后登记）</div>
          <div className="source-preview-body">
            <input
              className="source-preview-name"
              value={preview.displayName}
              onChange={(e) => setPreview({ ...preview, displayName: e.target.value })}
            />
            <span className="type-badge">{preview.platform}</span>
            <span className="track-mode-badge">{TRACK_MODE_LABEL[preview.trackMode] || preview.trackMode}</span>
          </div>
          {preview.note && <div className="source-preview-note">{preview.note}</div>}
          <div className="source-preview-actions">
            <button className="btn-primary" style={{ width: 'auto', padding: '0.5rem 1.25rem' }} onClick={handleRegister}>
              登记为信息源
            </button>
            <button className="btn-secondary" onClick={() => setPreview(null)}>取消</button>
          </div>
        </div>
      )}

      <div className="sources-list">
        {loading ? (
          <div className="loading">加载中...</div>
        ) : sources.length === 0 ? (
          <div className="empty-state" style={{ padding: '2rem 1rem' }}>
            还没有登记信息源。也可以在 Feed 卡片上点"加为信息源"从内容里发现好作者。
          </div>
        ) : (
          sources.map(s => (
            <div key={s.id} className="source-row">
              <div className="source-row-main">
                <span className="source-name">{s.display_name}</span>
                {(s.platforms || []).map(p => (
                  <span key={p.id} className="track-mode-badge" title={p.handle}>
                    {p.platform} · {TRACK_MODE_LABEL[p.track_mode] || p.track_mode}
                  </span>
                ))}
              </div>
              <div className="source-row-side">
                <span className="source-count">{s.content_count} 条内容</span>
                <button className="btn-secondary" onClick={() => handleUnregister(s.id, s.display_name)}>
                  取消关注
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
