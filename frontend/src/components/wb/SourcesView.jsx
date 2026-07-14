import { useState } from 'react'
import { api, MODES } from './util'

// 信息源登记处（视觉对齐原型 03-sources）：识别 → 确认登记 → 列表（track_mode 四色徽章）。
// 登记效果只有两个：内容进资讯流 + 高权重排序（ADR-007，不是订阅系统）。

export default function SourcesView({ sources, loadSources, loadNotes, showToast, setModal }) {
  const [input, setInput] = useState('')
  const [identifying, setIdentifying] = useState(false)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)

  const doIdentify = async () => {
    const v = input.trim()
    if (!v || identifying) return
    setIdentifying(true); setError(null); setPreview(null)
    try {
      const json = await api('/api/sources/identify', { method: 'POST', body: { input: v } })
      if (!json.success) throw new Error(json.error)
      setPreview(json.data)
    } catch (err) { setError(err.message) } finally { setIdentifying(false) }
  }

  const register = async () => {
    try {
      const json = await api('/api/sources/register', { method: 'POST', body: { identified: preview } })
      if (!json.success) throw new Error(json.error)
      setPreview(null); setInput('')
      loadSources()
      showToast(`已登记信息源：${json.data.display_name}`)
    } catch (err) { setError(`登记失败：${err.message}`) }
  }

  const unfollow = async (s) => {
    if (!confirm(`取消关注「${s.display_name}」？（历史内容不受影响，只是不再加权/追踪）`)) return
    try {
      await api(`/api/sources/${s.id}/register`, { method: 'DELETE' })
      loadSources()
    } catch (err) { showToast(`操作失败：${err.message}`) }
  }

  const modeOf = (m) => MODES[m] || MODES.passive

  return (
    <>
      <div className="wb-page-title">信息源</div>
      <div className="wb-page-sub">登记优质源：内容进 资讯流 并高权重排序 · 不是订阅系统</div>

      <div className="wb-acquire" style={{ marginTop: 16 }}>
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') doIdentify() }}
          placeholder="粘贴 X / YouTube / 博客链接，或输入公众号名称…"
        />
        <button className="wb-btn-primary" disabled={!input.trim() || identifying} onClick={doIdentify}>
          {identifying ? '识别中…' : '识别'}
        </button>
      </div>

      {error && <div className="wb-error">{error}</div>}

      {preview && (
        <div className="wb-card wb-src-preview">
          <div className="wb-src-preview-label">识别结果（可修改名称后登记）</div>
          <div className="wb-src-preview-row">
            <input className="wb-src-preview-name" value={preview.displayName}
              onChange={(e) => setPreview({ ...preview, displayName: e.target.value })} />
            <span className="wb-pill" style={{ color: modeOf(preview.trackMode).fg, background: modeOf(preview.trackMode).bg, borderRadius: 6 }}>
              {preview.platform} · {modeOf(preview.trackMode).cn}
            </span>
          </div>
          {preview.note && <div className="wb-src-note">{preview.note}</div>}
          <div className="wb-src-actions">
            <button className="wb-btn-primary" onClick={register}>登记为信息源</button>
            <button className="wb-btn-ghost" onClick={() => setPreview(null)}>取消</button>
          </div>
        </div>
      )}

      <div className="wb-src-entries" style={{ margin: '18px 0 12px' }}>
        <button className="wb-src-entry" onClick={() => setModal('pool')}>+ 添加信源池</button>
        <button className="wb-src-entry" onClick={() => setModal('import')}>+ 批量导入</button>
      </div>

      {sources.length === 0 && (
        <div className="wb-empty">还没有登记信息源。<br />也可以在资讯卡片上点「＋加为信息源」从内容里发现好作者。</div>
      )}

      {sources.map(s => (
        <div key={s.id} className="wb-card wb-src-row" style={{ marginTop: 0, marginBottom: 9, padding: '12px 15px', borderRadius: 10 }}>
          <span className="wb-src-name">{s.display_name}</span>
          {(s.platforms || []).map(p => (
            <span key={p.id} className="wb-pill" title={p.handle}
              style={{ color: modeOf(p.track_mode).fg, background: modeOf(p.track_mode).bg, borderRadius: 6 }}>
              {p.platform} · {modeOf(p.track_mode).cn}
            </span>
          ))}
          <span className="wb-src-count">{s.content_count} 条</span>
          <button className="wb-src-unfollow" style={{ color: '#a24b3f' }} onClick={() => unfollow(s)}>取消关注</button>
        </div>
      ))}
    </>
  )
}
