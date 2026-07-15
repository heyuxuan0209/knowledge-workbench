import { useState, useEffect } from 'react'
import { IconBolt, IconDoc, IconTrash } from './Icons'
import { api, timeAgo } from './util'

// 主题库 + 活页详情（M3 知识层，ADR-009）。
// 列表数据来自 /api/topics；详情打开时拉 /api/topics/:id（含 changelog + 待并入素材）。
// "全部并入"触发同化：一次 Deepseek 调用更新综述并写修订记录。

const PHASE = {
  emerging: { label: '新建期', fg: '#3d5a80', bg: 'rgba(61,90,128,.12)' },
  active: { label: '持续演进', fg: '#a24b3f', bg: 'rgba(162,75,63,.1)' },
  mature: { label: '已成熟', fg: '#3f7350', bg: 'rgba(63,115,80,.12)' },
  archived: { label: '已归档', fg: '#706b60', bg: 'rgba(33,31,26,.08)' },
}

export default function TopicsView({ topics, loadTopics, topicView, setTopicView, activeTopic, setActiveTopic, setPage, setStudio, showToast }) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const deleteTopic = async (tp, { fromDetail = false } = {}) => {
    if (!confirm(`删除主题「${tp.name}」？综述与修订记录会一并删除（素材卡片保留）。`)) return false
    try {
      await api(`/api/topics/${tp.id}`, { method: 'DELETE' })
      await loadTopics()
      if (fromDetail) setTopicView('list')
      showToast(`已删除主题「${tp.name}」`)
      return true
    } catch (err) { showToast(`删除失败：${err.message}`); return false }
  }

  if (topicView === 'page' && activeTopic) {
    return <TopicDetail topicId={activeTopic.id} back={() => { setTopicView('list'); loadTopics() }}
      onDelete={(tp) => deleteTopic(tp, { fromDetail: true })}
      setPage={setPage} setStudio={setStudio} showToast={showToast} />
  }

  const filtered = query.trim()
    ? topics.filter(t => t.name.toLowerCase().includes(query.trim().toLowerCase()))
    : topics

  const createTopic = async () => {
    const name = query.trim()
    if (!name) return
    if (topics.some(t => t.name === name)) { showToast('该主题已存在'); return }
    setCreating(true)
    try {
      const json = await api('/api/topics', { method: 'POST', body: { name } })
      await loadTopics()
      setQuery('')
      showToast(json.data.backfilled
        ? `已建立活页「${name}」，回扫匹配到 ${json.data.backfilled} 条素材待并入`
        : `已建立活页「${name}」，保存相关素材后 AI 开始维护综述`)
      setActiveTopic(json.data); setTopicView('page')
    } catch (err) { showToast(`建页失败：${err.message}`) } finally { setCreating(false) }
  }

  return (
    <>
      <div className="wb-page-title">我的主题库（{topics.length}）</div>
      <div className="wb-page-sub">每个主题是一篇 AI 帮你持续维护的综述：存进新素材，它自动更新正文、标出分歧，并记下每次修改</div>

      <div className="wb-acquire" style={{ marginTop: 16 }}>
        <input placeholder="搜索已有主题，或输入新主题名建立活页…" value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && filtered.length === 0) createTopic() }} />
        <button className="wb-btn-primary" disabled={creating} onClick={() => {
          if (filtered.length === 0 && query.trim()) createTopic()
        }}>{creating ? '建页中…' : (query.trim() && filtered.length === 0 ? '建立活页' : '搜索')}</button>
      </div>
      <div className="wb-feedbar" style={{ margin: '12px 0 0' }}>
        <span>排序 <b>最近活跃</b></span>
        <span className="wb-feedbar-sep">|</span>
        <span>保存素材后自动匹配主题 · 并入时 AI 更新综述</span>
      </div>

      {topics.length === 0 && (
        <div className="wb-empty">
          还没有主题活页。<br />
          在上方输入主题名建页；保存素材会自动匹配到相关主题，等你「并入」；<br />
          简报里的选题也可以「升级为主题」在这里建页。
        </div>
      )}

      {filtered.map(tp => {
        const ph = PHASE[tp.evolution_phase] || PHASE.emerging
        return (
          <div key={tp.id} className="wb-card" style={{ padding: '16px 18px' }}>
            <div className="wb-topic-head">
              <span style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 600 }}>{tp.name}</span>
              <span className="wb-pill" style={{ color: ph.fg, background: ph.bg }}>{ph.label}</span>
              {tp.pending_count > 0 && (
                <span className="wb-pill" style={{ color: '#a9791f', background: 'rgba(169,121,31,.12)' }}>{tp.pending_count} 条待并入</span>
              )}
            </div>
            <div className="wb-topic-meta">已并入素材 {tp.note_count} · 修订 {Math.max(0, tp.changelog_count - 1)} 次 · 最近活跃 {timeAgo(tp.last_active_at)}</div>
            {tp.latest_change && <div className="wb-topic-evo">最新演进：{tp.latest_change.summary}</div>}
            {tp.conflict && <div className="wb-topic-conflict"><IconBolt />{tp.conflict}</div>}
            <div className="wb-topic-actions">
              <button className="wb-btn-primary" onClick={() => { setActiveTopic(tp); setTopicView('page') }}>打开主题 →</button>
              <button className="wb-btn-ghost" onClick={() => {
                setStudio(s => ({ ...s, source: `Topic：${tp.name}`, platform: 'thread' })); setPage('studio')
              }}>开始创作</button>
              <button className="wb-note-del" style={{ marginLeft: 'auto' }} title="删除主题"
                onClick={() => deleteTopic(tp)}><IconTrash /></button>
            </div>
          </div>
        )
      })}
    </>
  )
}

function TopicDetail({ topicId, back, onDelete, setPage, setStudio, showToast }) {
  const [topic, setTopic] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try { setTopic((await api(`/api/topics/${topicId}`)).data) } catch (err) { showToast(`加载失败：${err.message}`) }
  }
  useEffect(() => { load() }, [topicId]) // eslint-disable-line react-hooks/exhaustive-deps

  const assimilate = async () => {
    setBusy(true)
    showToast('AI 正在把素材并入综述（约 20 秒，调用 Deepseek）…')
    try {
      const json = await api(`/api/topics/${topicId}/assimilate`, { method: 'POST', body: {} })
      if (!json.success) throw new Error(json.error)
      await load()
      showToast(`已并入 ${json.data.assimilated} 条素材：${json.data.changelog}${json.data.hasConflict ? ' ⚡发现观点冲突' : ''}`)
    } catch (err) { showToast(`并入失败：${err.message}`) } finally { setBusy(false) }
  }

  if (!topic) return <><button className="wb-back" onClick={back}>← 主题库</button><div className="wb-empty">加载中…</div></>

  const body = topic.body || { current: '', views: [], consensus: '' }
  return (
    <>
      <button className="wb-back" onClick={back}>← 主题库</button>
      <div className="wb-topic-head" style={{ marginTop: 6 }}>
        <span className="wb-topic-name">{topic.name}</span>
        <button className="wb-btn-primary" style={{ marginLeft: 'auto' }} onClick={() => {
          setStudio(s => ({ ...s, source: `Topic：${topic.name}`, platform: 'thread' })); setPage('studio')
        }}>开始创作</button>
        <button className="wb-note-del" title="删除主题" onClick={() => onDelete(topic)}><IconTrash /></button>
      </div>

      <div className="wb-card">
        <div className="wb-card-label"><IconDoc />主题综述 · AI 维护，并入新素材自动更新</div>
        <div className="wb-review">
          <h4>当前认知</h4>
          {body.current
            ? body.current.split('\n').filter(Boolean).map((p, i) => <p key={i}>{p}</p>)
            : <p style={{ color: 'var(--sub2)' }}>（暂无综述——并入素材后由 AI 生成）</p>}
          {body.views.length > 0 && <>
            <h4>各方观点</h4>
            {body.views.map((v, i) => (
              <p key={i}>· <b>{v.who}</b>：{v.what} {v.ref && <span className="ref">[{v.ref}]</span>}{v.conflict && <span className="conflict"> ⚡观点冲突</span>}</p>
            ))}
          </>}
          {body.consensus && <>
            <h4>共识 / 非共识</h4>
            {body.consensus.split('\n').filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
          </>}
        </div>
      </div>

      <div className="wb-card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: 'var(--body2)' }}>待并入素材（{topic.pending_notes.length}）</span>
        {topic.pending_notes.length > 0 && (
          <button className="wb-btn-outline" style={{ marginLeft: 'auto' }} disabled={busy} onClick={assimilate}>
            {busy ? '并入中…' : '全部并入'}
          </button>
        )}
      </div>
      {topic.pending_notes.map(n => (
        <div key={n.id} className="wb-card" style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 12.5, color: 'var(--body2)', lineHeight: 1.6 }}>{n.excerpt.slice(0, 160)}{n.excerpt.length > 160 ? '…' : ''}</div>
          <div style={{ fontSize: 11.5, color: 'var(--sub2)', marginTop: 6 }}>
            来源：{n.source_title || '未知'} · 匹配度 {Math.round((n.relevance || 0) * 100)}%
          </div>
        </div>
      ))}

      <div className="wb-card">
        <div className="wb-card-label">修订记录 · 自动生成（changelog 即演进时间线）</div>
        <div>
          {topic.changelog.map((c) => (
            <div key={c.id} className="wb-timeline-item">
              <div className="wb-timeline-dot" style={c.change_type === 'conflict' ? { borderColor: 'var(--amber)', background: 'rgba(169,121,31,.25)' } : undefined} />
              <div className="wb-timeline-when">{(c.created_at || '').slice(5, 10)}</div>
              <div className="wb-timeline-text">{c.change_type === 'conflict' ? '⚡ ' : ''}{c.summary}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
