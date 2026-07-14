import { useState } from 'react'
import { api, MODES } from './util'

// 三个弹窗：选题详情 / 信源池 / 批量导入（点遮罩或 × 关闭）

function Modal({ title, onClose, children }) {
  return (
    <div className="wb-modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wb-modal">
        <div className="wb-modal-head">
          <div className="wb-modal-title">{title}</div>
          <button className="wb-modal-close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const Label = ({ children }) => (
  <div style={{ fontSize: 11.5, color: 'var(--sub2)', fontWeight: 600, margin: '14px 0 5px' }}>{children}</div>
)
const Body = ({ children }) => (
  <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--body2)' }}>{children}</div>
)

export function IdeaModal({ idea, onClose, onUpgrade, onCreate, onDismiss }) {
  return (
    <Modal title={idea.title} onClose={onClose}>
      <Label>切入角度</Label><Body>{idea.angle}</Body>
      <Label>为什么是现在</Label><Body>{idea.why_now}</Body>
      <Label>共识（{idea.consensus.length}）</Label>
      <Body>{idea.consensus.length ? idea.consensus.map((c, i) => <div key={i}>· {c}</div>) : '（无）'}</Body>
      <Label>非共识（{idea.non_consensus.length}）</Label>
      <Body>{idea.non_consensus.length ? idea.non_consensus.map((c, i) => <div key={i}>· {c}</div>) : '（无）'}</Body>
      <Label>支撑素材（{(idea.supporting_content_ids || []).length}）</Label>
      <Body style={{ color: 'var(--sub)' }}>来自你的信息流，创作时可溯源引用</Body>
      <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
        <button className="wb-btn-primary" onClick={onUpgrade}>升级为常驻主题</button>
        <button className="wb-btn-outline" onClick={() => onCreate('thread')}>创作 thread</button>
        <button className="wb-btn-ghost" onClick={() => onCreate('long')}>创作长文</button>
        <button className="wb-btn-ghost" onClick={onDismiss}>忽略</button>
      </div>
    </Modal>
  )
}

export function PoolModal({ onClose, showToast }) {
  return (
    <Modal title="添加信源池" onClose={onClose}>
      <Body>信源池是「内容池」不是具体的人：不创建作者身份，内容直接进资讯流并标注池名。</Body>
      <Label>类型</Label>
      <div className="wb-filterbar" style={{ marginTop: 0 }}>
        <button className="wb-filter-chip" style={{ borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 600 }}>GitHub Trending</button>
        <button className="wb-filter-chip" onClick={() => showToast('Reddit / HN 池：后续接入')}>Reddit ▾</button>
        <button className="wb-filter-chip" onClick={() => showToast('Reddit / HN 池：后续接入')}>Hacker News ▾</button>
      </div>
      <Label>范围与过滤</Label>
      <Body>AI/ML 相关仓库 · 按日增 star 排序 · 每日同步</Body>
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button className="wb-btn-primary" onClick={() => { onClose(); showToast('已添加信源池 · GitHub Trending（每日同步脚本已接入）') }}>确认添加</button>
        <button className="wb-btn-ghost" onClick={onClose}>取消</button>
      </div>
    </Modal>
  )
}

export function ImportModal({ onClose, showToast, onDone }) {
  const [text, setText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [results, setResults] = useState(null) // [{line, identified?, error?}]
  const [importing, setImporting] = useState(false)

  const parse = async () => {
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean)
    if (!lines.length) return
    setParsing(true)
    const out = []
    for (const line of lines) {
      try {
        const json = await api('/api/sources/identify', { method: 'POST', body: { input: line } })
        if (!json.success) throw new Error(json.error)
        out.push({ line, identified: json.data })
      } catch (err) {
        out.push({ line, error: err.message })
      }
    }
    setResults(out)
    setParsing(false)
  }

  const doImport = async () => {
    const ok = results.filter(r => r.identified)
    setImporting(true)
    let done = 0
    for (const r of ok) {
      try {
        await api('/api/sources/register', { method: 'POST', body: { identified: r.identified } })
        done++
      } catch { /* 单条失败不阻塞其余 */ }
    }
    setImporting(false)
    onClose(); onDone()
    const failed = results.length - done
    showToast(`已导入 ${done} 个信源${failed ? `（${failed} 个无法识别/失败已跳过）` : ''}`)
  }

  const byMode = (mode) => (results || []).filter(r => r.identified?.trackMode === mode)

  return (
    <Modal title="批量导入信源" onClose={onClose}>
      <Body>每行一个：链接（X / YouTube / 博客）或公众号名称。解析后按 track_mode 分类展示，无法识别的显式列出。</Body>
      <textarea
        value={text} onChange={(e) => setText(e.target.value)}
        placeholder={'https://x.com/karpathy\nhttps://simonwillison.net/\n晚点LatePost'}
        style={{
          width: '100%', minHeight: 110, marginTop: 12, fontSize: 13, lineHeight: 1.7,
          border: '1px solid var(--line14)', borderRadius: 9, padding: '10px 12px',
          background: 'var(--bg)', outline: 'none', resize: 'vertical',
        }}
      />
      {!results && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="wb-btn-primary" disabled={!text.trim() || parsing} onClick={parse}>
            {parsing ? '逐行识别中…' : '解析'}
          </button>
          <button className="wb-btn-ghost" onClick={onClose}>取消</button>
        </div>
      )}
      {results && (
        <>
          <Label>已识别 {results.filter(r => r.identified).length} 个信源</Label>
          {['active-query', 'active-rss', 'link-only', 'passive'].map(mode => {
            const group = byMode(mode)
            if (!group.length) return null
            return (
              <div key={mode} style={{ marginBottom: 6 }}>
                <Body>
                  <span className="wb-pill" style={{ color: MODES[mode].fg, background: MODES[mode].bg, borderRadius: 6, marginRight: 6 }}>{MODES[mode].cn}</span>
                  {group.map(r => r.identified.displayName).join('、')}
                </Body>
              </div>
            )
          })}
          {results.some(r => r.error) && (
            <Body>
              <span className="wb-pill" style={{ color: '#a24b3f', background: 'rgba(162,75,63,.12)', borderRadius: 6, marginRight: 6 }}>无法识别</span>
              {results.filter(r => r.error).map(r => r.line).join('、')}
            </Body>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="wb-btn-primary" disabled={importing || !results.some(r => r.identified)} onClick={doImport}>
              {importing ? '导入中…' : '确认导入全部'}
            </button>
            <button className="wb-btn-ghost" onClick={() => setResults(null)}>重新编辑</button>
          </div>
        </>
      )}
    </Modal>
  )
}
