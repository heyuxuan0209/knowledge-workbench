import { useState, useEffect } from 'react'
import { IconBolt, IconDoc, IconTrash } from './Icons'
import { api, timeAgo } from './util'

// 主题库 + 活页详情（M3 知识层，ADR-009）。
// 列表数据来自 /api/topics；详情打开时拉 /api/topics/:id（含 changelog + 待收进素材）。
// "立即收进"触发同化：一次 Deepseek 调用更新综述并写修订记录。

const PHASE = {
  emerging: { label: '新建期', fg: '#3d5a80', bg: 'rgba(61,90,128,.12)' },
  active: { label: '持续演进', fg: '#a24b3f', bg: 'rgba(162,75,63,.1)' },
  mature: { label: '已成熟', fg: '#3f7350', bg: 'rgba(63,115,80,.12)' },
  archived: { label: '已归档', fg: '#706b60', bg: 'rgba(33,31,26,.08)' },
}

export default function TopicsView({ topics, loadTopics, topicView, setTopicView, activeTopic, setActiveTopic, setPage, setStudio, showToast, returnPage, goBack }) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  // 建议主题（系统提议、用户拍板）：热点聚类 + 近期素材 + 涌现建议，每日一算
  const [suggestions, setSuggestions] = useState([])
  useEffect(() => {
    api('/api/topics/suggestions').then(j => setSuggestions(j.data || [])).catch(() => {})
  }, [])
  const adoptSuggestion = async (s) => {
    try {
      const json = await api('/api/topics', { method: 'POST', body: { name: s.name, description: s.why } })
      setSuggestions(prev => prev.filter(x => x.name !== s.name))
      await loadTopics()
      showToast(`已建立主题页「${s.name}」${json.data.backfilled ? `，回扫到 ${json.data.backfilled} 条相关素材` : ''}`)
    } catch (err) { showToast(`建页失败：${err.message}`) }
  }
  const dismissSug = async (s) => {
    setSuggestions(prev => prev.filter(x => x.name !== s.name))
    api('/api/topics/suggestions/dismiss', { method: 'POST', body: { name: s.name } }).catch(() => {})
  }

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
      returnPage={returnPage} goBack={goBack}
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
        ? `已建立主题页「${name}」，找到 ${json.data.backfilled} 条相关素材，AI 正在生成综述（约半分钟后刷新可见）`
        : `已建立主题页「${name}」，之后保存的相关素材会自动收进综述`)
      setActiveTopic(json.data); setTopicView('page')
    } catch (err) { showToast(`建页失败：${err.message}`) } finally { setCreating(false) }
  }

  return (
    <>
      <div className="wb-page-title">我的主题库（{topics.length}）</div>
      <div className="wb-page-sub">每个主题是一篇 AI 帮你持续维护的综述：存进新素材，它自动更新正文、标出分歧，并记下每次修改</div>

      <div className="wb-acquire" style={{ marginTop: 16 }}>
        <input placeholder="搜索已有主题，或输入新主题名建立主题页…" value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && filtered.length === 0) createTopic() }} />
        <button className="wb-btn-primary" disabled={creating} onClick={() => {
          if (filtered.length === 0 && query.trim()) createTopic()
        }}>{creating ? '建页中…' : (query.trim() && filtered.length === 0 ? '建立主题页' : '搜索')}</button>
      </div>
      <div className="wb-feedbar" style={{ margin: '12px 0 0' }}>
        <span>排序 <b>最近活跃</b></span>
        <span className="wb-feedbar-sep">|</span>
        <span>保存素材后自动匹配主题 · 收进时 AI 更新综述</span>
      </div>

      {suggestions.length > 0 && (
        <div className="wb-card" style={{ padding: '14px 18px', background: 'var(--brief-bg)', borderColor: 'rgba(61,90,128,.22)' }}>
          <div className="wb-card-label">💡 建议主题 · 从你的信息流和素材里发现（每日更新）</div>
          {suggestions.map(s => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ minWidth: 0, flex: 1, fontSize: 13 }}>
                <b>{s.name}</b><span style={{ color: 'var(--sub2)' }}> — {s.why}</span>
              </span>
              <button className="wb-brief-link" style={{ flex: 'none' }} onClick={() => adoptSuggestion(s)}>建页 →</button>
              <button className="wb-note-del" style={{ flex: 'none' }} title="不感兴趣，今后不再建议" onClick={() => dismissSug(s)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {topics.length === 0 && (
        <div className="wb-empty">
          还没有主题页。<br />
          在上方输入主题名建页——之后每次保存素材，AI 会自动把相关内容收进综述、记下修订；<br />
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
                <span className="wb-pill" style={{ color: '#a9791f', background: 'rgba(169,121,31,.12)' }}>{tp.pending_count} 条待收进</span>
              )}
            </div>
            <div className="wb-topic-meta">已收进素材 {tp.note_count} · 修订 {Math.max(0, tp.changelog_count - 1)} 次 · 最近活跃 {timeAgo(tp.last_active_at)}</div>
            {tp.latest_change && <div className="wb-topic-evo">最新演进：{tp.latest_change.summary}</div>}
            {tp.conflict && <div className="wb-topic-conflict"><IconBolt />{tp.conflict}</div>}
            <div className="wb-topic-actions">
              <button className="wb-btn-primary" onClick={() => { setActiveTopic(tp); setTopicView('page') }}>打开主题 →</button>
              <button className="wb-btn-ghost" onClick={() => {
                setStudio(s => ({ ...s, source: `Topic：${tp.name}`, sourceTopicId: tp.id, platform: 'long', draft: '', draftId: null, title: null, refs: [], paragraphRefs: [] })); setPage('studio')
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

function TopicDetail({ topicId, back, onDelete, setPage, setStudio, showToast, returnPage, goBack }) {
  const [topic, setTopic] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try { setTopic((await api(`/api/topics/${topicId}`)).data) } catch (err) { showToast(`加载失败：${err.message}`) }
  }
  useEffect(() => { load() }, [topicId]) // eslint-disable-line react-hooks/exhaustive-deps

  const assimilate = async () => {
    setBusy(true)
    showToast('AI 正在把素材收进综述（约 20 秒，调用 Deepseek）…')
    try {
      const json = await api(`/api/topics/${topicId}/assimilate`, { method: 'POST', body: {} })
      if (!json.success) throw new Error(json.error)
      await load()
      showToast(`已收进 ${json.data.assimilated} 条素材：${json.data.changelog}${json.data.hasConflict ? ' ⚡发现观点冲突' : ''}`)
    } catch (err) { showToast(`收进失败：${err.message}`) } finally { setBusy(false) }
  }

  if (!topic) return <><button className="wb-back" onClick={back}>← 主题库</button><div className="wb-empty">加载中…</div></>

  const body = topic.body || { current: '', views: [], consensus: '' }
  return (
    <>
      <button className="wb-back" onClick={back}>← 主题库</button>
      {returnPage === 'reports' && (
        <button className="wb-back" style={{ marginLeft: 10 }} onClick={goBack}>← 返回周报</button>
      )}
      <div className="wb-topic-head" style={{ marginTop: 6 }}>
        <span className="wb-topic-name">{topic.name}</span>
        <button className="wb-note-del" title="重命名主题（AI 会先给 3 个候选名）" onClick={async () => {
          showToast('AI 正在想几个更好的名字…')
          let hint = ''
          let suggestions = []
          try {
            suggestions = (await api(`/api/topics/${topic.id}/suggest-names`, { method: 'POST' })).data || []
            hint = suggestions.length ? `AI 建议：\n${suggestions.map((s, i) => `${i + 1}) ${s}`).join('\n')}\n\n输入数字选用，或直接输入新名字：` : '输入新的主题名：'
          } catch { hint = '输入新的主题名（AI 建议获取失败）：' }
          const input = prompt(hint, topic.name)
          if (!input?.trim()) return
          const picked = /^[123]$/.test(input.trim()) ? suggestions[parseInt(input.trim()) - 1] : input.trim()
          if (!picked || picked === topic.name) return
          try {
            await api(`/api/topics/${topic.id}`, { method: 'PATCH', body: { name: picked } })
            await load()
            showToast(`主题已重命名为「${picked}」`)
          } catch (err) { showToast(`重命名失败：${err.message}`) }
        }}>✎</button>
        <button className="wb-btn-primary" style={{ marginLeft: 'auto' }} onClick={() => {
          setStudio(s => ({ ...s, source: `Topic：${topic.name}`, sourceTopicId: topic.id, platform: 'long', draft: '', draftId: null, title: null, refs: [], paragraphRefs: [] })); setPage('studio')
        }}>开始创作</button>
        <button className="wb-note-del" title="删除主题" onClick={() => onDelete(topic)}><IconTrash /></button>
      </div>

      <div className="wb-card">
        <div className="wb-card-label"><IconDoc />主题综述 · AI 维护，收进新素材自动更新</div>
        <div className="wb-review">
          <h4>当前认知</h4>
          {body.current
            ? body.current.split('\n').filter(Boolean).map((p, i) => <p key={i}>{p}</p>)
            : <p style={{ color: 'var(--sub2)' }}>（暂无综述——收进素材后由 AI 生成）</p>}
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
        <span style={{ fontSize: 13, color: 'var(--body2)' }}>
          待收进素材（{topic.pending_notes.length}）
          {topic.pending_notes.length > 0 && <span style={{ color: 'var(--sub2)' }}> · 保存时通常已自动收进，这里是失败兜底</span>}
        </span>
        {topic.pending_notes.length > 0 && (
          <button className="wb-btn-outline" style={{ marginLeft: 'auto' }} disabled={busy} onClick={assimilate}>
            {busy ? '收进中…' : '立即收进'}
          </button>
        )}
      </div>
      {topic.pending_notes.map(n => (
        <div key={n.id} className="wb-card" style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{n.title || n.source_title || '未命名素材'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--body2)', lineHeight: 1.6, marginTop: 4 }}>{n.excerpt.slice(0, 120)}…</div>
              <div style={{ fontSize: 11.5, color: 'var(--sub2)', marginTop: 4 }}>
                来源：{n.source_title || '未知'} · 匹配度 {Math.round((n.relevance || 0) * 100)}%
                {(n.matched_terms || []).length > 0 && <> · 因共享「{n.matched_terms.slice(0, 5).join('」「')}」被匹配</>}
              </div>
            </div>
            <button className="wb-note-del" style={{ flex: 'none' }} title="不属于这个主题，移除（素材本身保留）"
              onClick={async () => {
                try { await api(`/api/topics/${topic.id}/notes/${n.id}`, { method: 'DELETE' }); await load(); showToast('已移除（素材仍在素材库）') }
                catch (err) { showToast(`移除失败：${err.message}`) }
              }}>✕</button>
          </div>
        </div>
      ))}

      <div className="wb-card">
        <div className="wb-card-label">已收进素材（{topic.assimilated_notes?.length || 0}）· 综述由它们长成</div>
        <div style={{ fontSize: 11.5, color: 'var(--sub2)', marginBottom: 8 }}>
          自动收进的判定：保存素材时与主题名/综述做本地相似度匹配（不调 AI）。误收点 ✕ 移出——AI 会同时修订综述，剔除只有它支撑的论点。
        </div>
        {(topic.assimilated_notes || []).map(n => {
          const url = n.content_url || n.source_url
          return (
            <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid var(--line07)' }}>
              <span style={{ minWidth: 0, flex: 1, fontSize: 12.5 }}>
                <b>{n.title || n.source_title || '未命名素材'}</b>
                {url && <a href={url} target="_blank" rel="noreferrer" title="新标签打开原文" style={{ marginLeft: 4, color: 'var(--accent)', textDecoration: 'none' }}>↗</a>}
                <span style={{ color: 'var(--sub2)' }}
                  title={(n.matched_terms || []).length ? `匹配依据（共享关键词）：${n.matched_terms.join('、')}` : undefined}>
                  {' '}· {(n.assimilated_at || '').slice(5, 10)} · {n.added_by === 'user' ? '手动归入' : `自动匹配 ${Math.round((n.relevance || 0) * 100)}%`}
                  {n.added_by !== 'user' && (n.matched_terms || []).length > 0 && <>（共享「{n.matched_terms.slice(0, 3).join('」「')}」）</>}
                </span>
              </span>
              <button className="wb-note-del" style={{ flex: 'none' }} title="移出该素材并修订综述（约 20 秒）"
                onClick={async () => {
                  if (!confirm(`把《${n.title || n.source_title || '素材'}》移出本主题？\nAI 会修订综述、剔除只有它支撑的论点（素材本身保留在素材库）。`)) return
                  showToast('正在移出并修订综述（约 20 秒）…')
                  try {
                    const json = await api(`/api/topics/${topic.id}/notes/${n.id}`, { method: 'DELETE' })
                    await load()
                    showToast(json.data.revised ? '已移出，综述已修订' : '已移出（综述修订失败，请检查正文是否有残留论点）')
                  } catch (err) { showToast(`移出失败：${err.message}`) }
                }}>✕</button>
            </div>
          )
        })}
        {!(topic.assimilated_notes || []).length && <div style={{ fontSize: 12, color: 'var(--faint)' }}>还没有素材收进过这个主题</div>}
      </div>

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
