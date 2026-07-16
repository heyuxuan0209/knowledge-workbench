import { useState, useEffect, useRef, useCallback } from 'react'
import { timeAgo, STANCE_COLORS, STANCE_CN, api } from './util'
import { IconClip, IconExternal, IconTrash } from './Icons'

// 素材库（2026-07-16 反馈改版）：双 Tab——
// 「我的素材」：聚合建议条（AI 提议哪些放一起+为什么）→ 未归类收件箱 → 按主题分组；
// 「选题建议 · AI」：从 Feed 简报迁来（折叠在简报里被遮挡没意义），
//   含支撑素材聚合，逐条可移除（用户裁决 AI 的聚合结果）。
// 素材卡：类型徽章（GitHub 项目/文章/视频）+ 关键词标签 + 归入主题 + 选中分析。

const PAGE_LABEL = { studio: '创作台', topics: '主题库', feed: '资讯', reports: '周报' }
const CTYPE_BADGE = {
  repo: '⭐ GitHub 项目', video: '🎬 视频', article: '📄 文章', paper: '📄 论文', tweet: '🐦 推文',
}
const DISMISS_KEY = 'wb-dismissed-clusters'

export default function NotesView({
  notes, loadNotes, loadTopics, loadBrief, showToast, highlightNoteId, setHighlightNoteId,
  returnPage, goBack, topics = [], report, upgradeIdea, createFromIdea,
  notesTab = 'mine', setNotesTab, toggleSelectNote, selectedItems = [],
}) {
  const [keyword, setKeyword] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [topicFilter, setTopicFilter] = useState('')
  const [ctypeFilter, setCtypeFilter] = useState('')
  const [sourceOptions, setSourceOptions] = useState([])
  const [results, setResults] = useState(null) // null = 无筛选，展示全局列表
  const highlightRef = useRef(null)

  useEffect(() => {
    api('/api/notes/sources').then(j => setSourceOptions(j.data || [])).catch(() => {})
  }, [])

  const hasFilter = Boolean(keyword.trim() || sourceFilter || topicFilter || ctypeFilter)

  const fetchFiltered = useCallback(async () => {
    if (!hasFilter) { setResults(null); return }
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (keyword.trim()) params.set('q', keyword.trim())
      if (sourceFilter) params.set('source', sourceFilter)
      if (topicFilter) params.set('topicId', topicFilter)
      if (ctypeFilter) params.set('ctype', ctypeFilter)
      setResults((await api(`/api/notes?${params}`)).data || [])
    } catch (err) { console.error(err) }
  }, [hasFilter, keyword, sourceFilter, topicFilter, ctypeFilter])

  // 输入防抖 250ms 后查询后端
  useEffect(() => {
    const t = setTimeout(fetchFiltered, 250)
    return () => clearTimeout(t)
  }, [fetchFiltered])

  useEffect(() => {
    if (highlightNoteId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const timer = setTimeout(() => setHighlightNoteId?.(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [highlightNoteId, setHighlightNoteId])

  const del = async (note) => {
    if (!confirm('删除这张素材卡片？')) return
    try {
      await api(`/api/notes/${note.id}`, { method: 'DELETE' })
      loadNotes()
      fetchFiltered()
    } catch (err) { showToast(`删除失败：${err.message}`) }
  }

  // 归入主题：入口保持一键零摩擦，归类在素材库里补——未归类是显式待办不是默认垃圾堆。
  // 可当场新建主题，名字以后随时改（按 ID 关联）
  const assignTopic = async (note, val) => {
    if (!val) return
    try {
      let topicId = val
      if (val === '__new__') {
        const name = prompt('新主题名称（随手起即可，以后随时可改名）：')?.trim()
        if (!name) return
        const j = await api('/api/topics', { method: 'POST', body: { name } })
        topicId = j.data.id
        loadTopics?.()
      }
      await api(`/api/notes/${note.id}/topics`, { method: 'POST', body: { topicId } })
      showToast('已归入主题（AI 会把它并入主题综述）')
      loadNotes()
      fetchFiltered()
    } catch (err) { showToast(`归类失败：${err.message}`) }
  }

  // ---- 聚合建议（2026-07-16 反馈 #4：AI 提议哪些放一起、为什么；用户勾选裁决） ----
  const [clusters, setClusters] = useState([])
  const [clusterEdit, setClusterEdit] = useState({}) // key → { name, excluded:Set }
  const clusterKey = (sug) => [...sug.noteIds].sort().join('|')
  const dismissed = () => { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') } catch { return [] } }
  useEffect(() => {
    api('/api/notes/cluster-suggestions')
      .then(j => setClusters((j.data || []).filter(s => !dismissed().includes(clusterKey(s)))))
      .catch(() => {})
  }, [notes]) // eslint-disable-line react-hooks/exhaustive-deps

  const dismissCluster = (sug) => {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed(), clusterKey(sug)].slice(-50)))
    setClusters(prev => prev.filter(s => clusterKey(s) !== clusterKey(sug)))
  }
  const acceptCluster = async (sug) => {
    const key = clusterKey(sug)
    const edit = clusterEdit[key] || {}
    const name = (edit.name ?? sug.suggestedName).trim()
    const chosen = sug.noteIds.filter(id => !edit.excluded?.has(id))
    if (!name) { showToast('给主题起个名（随手起，以后能改）'); return }
    if (chosen.length < 2) { showToast('至少保留 2 条素材才值得建页'); return }
    try {
      const j = await api('/api/topics', { method: 'POST', body: { name } })
      for (const nid of chosen) {
        await api(`/api/notes/${nid}/topics`, { method: 'POST', body: { topicId: j.data.id } })
      }
      dismissCluster(sug)
      showToast(`已建主题「${name}」并归入 ${chosen.length} 条素材，AI 正在生成综述`)
      loadNotes(); loadTopics?.()
    } catch (err) { showToast(`建页失败：${err.message}`) }
  }

  // 摘除主题关联（AI 自动匹配错了 / 归错了）；重归属用旁边的「归入主题…」下拉
  const unlinkTopic = async (note, t) => {
    try {
      await api(`/api/notes/${note.id}/topics/${t.id}`, { method: 'DELETE' })
      showToast(`已把这条素材从「${t.name}」摘除`)
      loadNotes()
      fetchFiltered()
    } catch (err) { showToast(`摘除失败：${err.message}`) }
  }

  // 改素材标题（AI 起的标题不贴切时）
  const renameNote = async (note) => {
    const title = prompt('修改素材标题：', note.title || '')?.trim()
    if (!title || title === note.title) return
    try {
      await api(`/api/notes/${note.id}`, { method: 'PATCH', body: { title } })
      loadNotes()
      fetchFiltered()
    } catch (err) { showToast(`修改失败：${err.message}`) }
  }

  // ---- 选题建议（从 Feed 简报迁入） ----
  const ideas = (report?.ideas || []).filter(i => i.status === 'suggested' || i.status === 'adopted')
  const removeSupport = async (idea, contentId) => {
    try {
      await api(`/api/ideas/${idea.id}`, { method: 'PATCH', body: { removeContentId: contentId } })
      showToast('已从该选题移除这篇素材')
      loadBrief?.()
    } catch (err) { showToast(`移除失败：${err.message}`) }
  }
  const dismissIdea = async (idea) => {
    try { await api(`/api/ideas/${idea.id}`, { method: 'PATCH', body: { status: 'dismissed' } }); loadBrief?.() }
    catch (err) { showToast(`忽略失败：${err.message}`) }
  }

  const shown = results ?? notes

  // 主题 chips 的计数（基于已加载素材，近似值够用）
  const topicCount = {}
  notes.forEach(n => (n.topic_ids || '').split(',').filter(Boolean).forEach(id => { topicCount[id] = (topicCount[id] || 0) + 1 }))
  const inboxCount = notes.filter(n => !(n.topic_ids || '').trim()).length

  // 无筛选时按主题分组：素材可属多主题——按第一主题归组避免重复卡片；未归类置顶当收件箱
  const groups = []
  if (!hasFilter) {
    const firstTopic = n => (n.topic_ids || '').split(',')[0] || null
    const unassigned = shown.filter(n => !firstTopic(n))
    if (unassigned.length) groups.push({ id: '__inbox__', name: '未归类', notes: unassigned })
    for (const t of topics) {
      const tn = shown.filter(n => firstTopic(n) === t.id)
      if (tn.length) groups.push({ id: t.id, name: t.name, notes: tn })
    }
    const placed = new Set(groups.flatMap(g => g.notes.map(n => n.id)))
    const rest = shown.filter(n => !placed.has(n.id))
    if (rest.length) groups.push({ id: '__rest__', name: '其他（原主题已删除）', notes: rest })
  }

  return (
    <>
      {returnPage && (
        <button className="wb-back" onClick={goBack}>← 返回{PAGE_LABEL[returnPage] || '上一页'}</button>
      )}
      <div className="wb-page-title">素材库</div>
      <div className="wb-page-sub">{notes.length} 张素材卡片 · AI 对话「保存到笔记」/ 精读弹窗「存为素材」沉淀 · 创作台按段引用</div>

      <div className="wb-seg-toggle" style={{ margin: '10px 0 4px', display: 'inline-flex' }}>
        <button className={notesTab === 'mine' ? 'active' : ''} onClick={() => setNotesTab?.('mine')}>我的素材</button>
        <button className={notesTab === 'ideas' ? 'active' : ''} onClick={() => setNotesTab?.('ideas')}>选题建议 · AI（{ideas.length}）</button>
      </div>

      {notesTab === 'ideas' && (
        <>
          {ideas.length === 0 && (
            <div className="wb-empty">暂无选题建议。<br />去资讯页点「生成今日简报」，AI 会基于你的信息流聚类提出选题。</div>
          )}
          {ideas.map(idea => (
            <div key={idea.id} className="wb-idea-card">
              <div className="wb-idea-angle">{idea.title}</div>
              <div className="wb-idea-meta">角度：{idea.angle} · 时机：{idea.why_now}</div>
              {(idea.consensus?.length || idea.non_consensus?.length) ? (
                <div className="wb-idea-stats">共识：{(idea.consensus || []).join('；') || '—'}<br />非共识：{(idea.non_consensus || []).join('；') || '—'}</div>
              ) : null}
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11.5, color: 'var(--sub2)', marginBottom: 4 }}>支撑素材（{(idea.supporting_contents || []).length}）· 不合适的可移除</div>
                {(idea.supporting_contents || []).map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0' }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.url
                        ? <a href={c.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{c.title}</a>
                        : c.title}
                    </span>
                    <button className="wb-note-del" title="从该选题移除" onClick={() => removeSupport(idea, c.id)}>✕</button>
                  </div>
                ))}
              </div>
              <div className="wb-idea-actions">
                <button className="wb-btn-ghost" onClick={() => upgradeIdea(idea)}>升级为主题</button>
                <button className="wb-btn-outline" onClick={() => createFromIdea(idea, 'thread')}>直接创作 thread</button>
                <button className="wb-btn-ghost" onClick={() => dismissIdea(idea)}>忽略</button>
              </div>
            </div>
          ))}
        </>
      )}

      {notesTab === 'mine' && (
        <>
          <div className="wb-filterbar">
            <input placeholder="搜索素材（空格分隔多个关键词）…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            <select className="wb-filter-chip" value={ctypeFilter} onChange={(e) => setCtypeFilter(e.target.value)}>
              <option value="">类型（全部）</option>
              <option value="article">📄 文章</option>
              <option value="video">🎬 视频</option>
              <option value="repo">⭐ GitHub 项目</option>
            </select>
            <select className="wb-filter-chip" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
              style={{ maxWidth: 160 }}>
              <option value="">按来源（全部）</option>
              {sourceOptions.map(s => <option key={s.source} value={s.source}>{s.source.slice(0, 24)}（{s.count}）</option>)}
            </select>
            {hasFilter && (
              <button className="wb-filter-chip" onClick={() => { setKeyword(''); setSourceFilter(''); setTopicFilter(''); setCtypeFilter('') }}>清除筛选</button>
            )}
          </div>

          {/* 主题 tab（2026-07-16 反馈：内容多时下拉切换太钝，chips 一点即切） */}
          <div className="wb-topic-chips">
            <button className={`wb-topic-chip${!topicFilter ? ' active' : ''}`} onClick={() => setTopicFilter('')}>全部</button>
            <button className={`wb-topic-chip${topicFilter === '__none__' ? ' active' : ''}`} onClick={() => setTopicFilter('__none__')}>
              未归类{inboxCount ? `（${inboxCount}）` : ''}
            </button>
            {topics.map(t => (
              <button key={t.id} className={`wb-topic-chip${topicFilter === t.id ? ' active' : ''}`}
                onClick={() => setTopicFilter(topicFilter === t.id ? '' : t.id)} title={t.name}>
                {t.name.slice(0, 12)}{topicCount[t.id] ? `（${topicCount[t.id]}）` : ''}
              </button>
            ))}
          </div>
          {hasFilter && results !== null && (
            <div style={{ fontSize: 12, color: 'var(--sub2)', margin: '6px 2px 0' }}>筛选出 {results.length} 条</div>
          )}

          {/* 聚合建议条：AI 提议哪些未归类素材放一起 + 为什么（共享关键词），用户勾选裁决 */}
          {!hasFilter && clusters.map(sug => {
            const key = clusterKey(sug)
            const edit = clusterEdit[key] || {}
            const excluded = edit.excluded || new Set()
            return (
              <div key={key} className="wb-cluster-card">
                <div className="wb-cluster-head">
                  🤖 这 {sug.noteIds.length} 条可以放一起
                  <span className="wb-cluster-why">为什么：共享关键词 {sug.sharedKeywords.join('、')}</span>
                </div>
                {sug.notes.map(n => (
                  <label key={n.id} className="wb-cluster-item">
                    <input type="checkbox" checked={!excluded.has(n.id)} onChange={(e) => {
                      const next = new Set(excluded)
                      e.target.checked ? next.delete(n.id) : next.add(n.id)
                      setClusterEdit(prev => ({ ...prev, [key]: { ...edit, excluded: next } }))
                    }} />
                    <span>{n.title}</span>
                  </label>
                ))}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <input className="wb-cluster-name" value={edit.name ?? sug.suggestedName}
                    onChange={(e) => setClusterEdit(prev => ({ ...prev, [key]: { ...edit, name: e.target.value } }))}
                    title="建议主题名（可改，以后也随时能改）" />
                  <button className="wb-btn-outline" onClick={() => acceptCluster(sug)}>建页并归入</button>
                  <button className="wb-btn-ghost" onClick={() => dismissCluster(sug)}>忽略</button>
                </div>
              </div>
            )
          })}

          {shown.length === 0 && (
            <div className="wb-empty">
              {hasFilter ? '没有匹配的素材' : <>还没有素材。<br />去资讯页选中内容分析，把有价值的回答「保存到笔记」。</>}
            </div>
          )}

          {hasFilter
            ? shown.map(note => renderNote(note))
            : groups.map(g => (
              <div key={g.id}>
                <div className="wb-note-group-head">
                  <span className="wb-note-group-name">{g.name}</span>
                  <span className="wb-note-group-count">{g.notes.length}</span>
                  {g.id === '__inbox__' && (
                    <span className="wb-note-group-hint">收件箱 · 周清 2 分钟：归入主题或删除</span>
                  )}
                </div>
                {g.notes.map(note => renderNote(note))}
              </div>
            ))}
        </>
      )}
    </>
  )

  function renderNote(note) {
    const stanceCn = STANCE_CN[note.stance] || note.stance
    const sc = STANCE_COLORS[note.stance]
    const url = note.content_url || note.source_url
    const title = note.content_zh_title || note.source_title
    const highlighted = note.id === highlightNoteId
    const keywords = safeParseKeywords(note.keywords)
    const noteTopics = safeParseKeywords(note.topics_json) // [{id,name,status,addedBy}]
    const noteTopicIds = noteTopics.map(t => t.id)
    const ctypeBadge = CTYPE_BADGE[note.content_content_type] || (note.content_id ? null : '🤖 AI 解读')
    const selected = selectedItems.some(x => x.id === note.content_id || x.id === `note-${note.id}`)
    return (
      <div key={note.id} className={`wb-card${selected ? ' selected' : ''}`} ref={highlighted ? highlightRef : null}
        style={highlighted ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 2px rgba(61,90,128,.18)', transition: 'box-shadow .3s' } : undefined}>
        {note.title && (
          <div style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
            {note.title}
            <button className="wb-note-del" style={{ marginLeft: 6, fontSize: 11 }} title="修改标题" onClick={() => renameNote(note)}>✎</button>
          </div>
        )}
        <div className="wb-note-excerpt">{note.excerpt}</div>
        {keywords.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {keywords.map(k => (
              <button key={k} className="wb-chip" title="点击搜索该关键词" onClick={() => setKeyword(k)}>{k}</button>
            ))}
          </div>
        )}
        <div className="wb-note-foot">
          {ctypeBadge && <span className="wb-pill" style={{ color: '#706b60', background: 'rgba(33,31,26,.07)' }}>{ctypeBadge}</span>}
          <span className="wb-note-src"><IconClip />来源 <b>{title || '（未记录）'}</b></span>
          {url ? (
            <a className="wb-note-jump" href={url} target="_blank" rel="noreferrer">
              跳转原文<IconExternal size={10} />
            </a>
          ) : (
            <button className="wb-note-jump" onClick={() => showToast('该素材来自多篇内容的 AI 解读，无单一原文链接')}>查看来源内容</button>
          )}
          {stanceCn && sc && (
            <span className="wb-pill" style={{ color: sc.fg, background: sc.bg }}>{stanceCn}</span>
          )}
          {noteTopics.map(t => {
            // 你手动归的 = 实心；AI 自动匹配的 = 虚线 + 「疑似」（pending 未并入时）。都可 ✕ 摘除
            const isAuto = t.addedBy !== 'user'
            const suspect = isAuto && t.status === 'pending'
            return (
              <span key={t.id} className="wb-pill wb-topic-pill"
                style={{ color: '#3d5a80', background: 'rgba(61,90,128,.1)', border: isAuto ? '1px dashed rgba(61,90,128,.45)' : '1px solid transparent' }}
                title={isAuto ? `AI 自动匹配${suspect ? '（疑似相关，未并入）' : '（已并入综述）'}，不对可 ✕ 摘除` : '你归入的主题'}>
                {t.name.slice(0, 14)}{suspect ? ' ·疑似' : ''}
                <button className="wb-topic-pill-x" title={`从「${t.name}」摘除`}
                  onClick={() => unlinkTopic(note, t)}>×</button>
              </span>
            )
          })}
          <button className={`wb-note-jump${selected ? '' : ''}`} style={selected ? { color: 'var(--accent)', fontWeight: 600 } : undefined}
            title="送入右侧快速分析（可多选素材一起解读）" onClick={() => toggleSelectNote?.(note)}>
            {selected ? '✓ 已选中' : '选中分析'}
          </button>
          <select className="wb-note-assign" value="" title="归入主题（可当场新建，名字以后随时改）"
            onChange={(e) => assignTopic(note, e.target.value)}>
            <option value="">归入主题…</option>
            {topics.filter(t => !noteTopicIds.includes(t.id)).map(t => (
              <option key={t.id} value={t.id}>{t.name.slice(0, 20)}</option>
            ))}
            <option value="__new__">＋ 新建主题…</option>
          </select>
          <span className="wb-note-time">{timeAgo(note.created_at)}</span>
          <button className="wb-note-del" onClick={() => del(note)} title="删除"><IconTrash /></button>
        </div>
      </div>
    )
  }
}

function safeParseKeywords(s) {
  try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}
