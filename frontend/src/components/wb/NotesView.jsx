import { useState, useEffect, useRef, useCallback } from 'react'
import { timeAgo, STANCE_COLORS, STANCE_CN, api } from './util'
import { IconClip, IconExternal, IconTrash } from './Icons'
import { renderMarkdown } from './markdown'

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
  setPage, setStudio, gotoTopic,
}) {
  const [keyword, setKeyword] = useState('')
  const [searchMode, setSearchMode] = useState('semantic') // 'keyword' | 'semantic'（默认语义：模糊需求也能找到）
  const [relFilter, setRelFilter] = useState('all') // 语义结果按相关度档筛选：all|high|mid|low（免得弱相关一大堆往下滑）
  const [sourceFilter, setSourceFilter] = useState('')
  const [topicFilter, setTopicFilter] = useState('')
  const [ctypeFilter, setCtypeFilter] = useState('')
  const [sourceOptions, setSourceOptions] = useState([])
  const [results, setResults] = useState(null) // null = 无筛选，展示全局列表
  const [expandedNotes, setExpandedNotes] = useState(() => new Set()) // 展开看全文的素材（默认折叠成摘要）
  const [showAllTopics, setShowAllTopics] = useState(false) // 主题 chips 瘦身：默认藏零散的单条主题
  const [ovOpen, setOvOpen] = useState(() => localStorage.getItem('wb-notes-ov-collapsed') !== '1') // 素材概览默认展开
  const [topicSug, setTopicSug] = useState({}) // 语义补归类：noteId -> [{topicId,name,score}]（贴合但没标的主题）
  const highlightRef = useRef(null)
  const toggleExpand = (id) => setExpandedNotes(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const toggleOv = () => setOvOpen(o => { localStorage.setItem('wb-notes-ov-collapsed', o ? '1' : '0'); return !o })
  const startCreation = (t) => {
    setStudio?.(s => ({ ...s, source: `Topic：${t.name}`, sourceTopicId: t.id, platform: 'long', draft: '', draftId: null, title: null, refs: [], paragraphRefs: [] }))
    setPage?.('studio')
  }

  useEffect(() => {
    api('/api/notes/sources').then(j => setSourceOptions(j.data || [])).catch(() => {})
  }, [])

  const hasFilter = Boolean(keyword.trim() || sourceFilter || topicFilter || ctypeFilter)

  const fetchFiltered = useCallback(async () => {
    if (!hasFilter) { setResults(null); return }
    try {
      // 语义模式：只按关键框做语义检索（模糊需求→意思相近的素材），其余筛选器不参与
      if (searchMode === 'semantic' && keyword.trim()) {
        const params = new URLSearchParams({ q: keyword.trim(), limit: '30' })
        setResults((await api(`/api/notes/search-semantic?${params}`)).data || [])
        return
      }
      const params = new URLSearchParams({ limit: '200' })
      if (keyword.trim()) params.set('q', keyword.trim())
      if (sourceFilter) params.set('source', sourceFilter)
      if (topicFilter) params.set('topicId', topicFilter)
      if (ctypeFilter) params.set('ctype', ctypeFilter)
      setResults((await api(`/api/notes?${params}`)).data || [])
    } catch (err) { console.error(err) }
  }, [hasFilter, searchMode, keyword, sourceFilter, topicFilter, ctypeFilter])

  // 输入防抖 250ms 后查询后端
  useEffect(() => {
    const t = setTimeout(fetchFiltered, 250)
    return () => clearTimeout(t)
  }, [fetchFiltered])

  // 换查询/换模式时相关度档回到"全部"，避免停在空档
  useEffect(() => { setRelFilter('all') }, [keyword, searchMode])

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

  // 接受一条语义补归类建议：归入 + 从建议里移除
  const acceptSug = async (note, s) => {
    await assignTopic(note, s.topicId)
    setTopicSug(prev => {
      const c = { ...prev }
      c[note.id] = (c[note.id] || []).filter(x => x.topicId !== s.topicId)
      if (!c[note.id].length) delete c[note.id]
      return c
    })
  }
  const dismissSug = (note, s) => setTopicSug(prev => {
    const c = { ...prev }
    c[note.id] = (c[note.id] || []).filter(x => x.topicId !== s.topicId)
    if (!c[note.id].length) delete c[note.id]
    return c
  })

  // ---- 1b 知识关联：某条素材的相关素材（按需拉取，复用向量） ----
  const [relatedOpen, setRelatedOpen] = useState(null)  // 展开了哪条的相关列表
  const [relatedMap, setRelatedMap] = useState({})      // noteId -> related[]（缓存）
  const toggleRelated = async (noteId) => {
    if (relatedOpen === noteId) { setRelatedOpen(null); return }
    setRelatedOpen(noteId)
    if (!relatedMap[noteId]) {
      try { const j = await api(`/api/notes/${noteId}/related`); setRelatedMap(m => ({ ...m, [noteId]: j.data || [] })) }
      catch { setRelatedMap(m => ({ ...m, [noteId]: [] })) }
    }
  }
  const jumpToNote = (id) => setHighlightNoteId?.(id) // 高亮并滚动（highlight effect 负责）

  // ---- 1b 查重：疑似重复素材分组（语义），用户保留想要的、删掉多余 ----
  const DUP_KEY = 'wb-dismissed-dups'
  const [dupGroups, setDupGroups] = useState([])
  const [dupOpen, setDupOpen] = useState(false)
  const dupKey = (g) => g.notes.map(n => n.id).sort().join('|')
  const dupDismissed = () => { try { return JSON.parse(localStorage.getItem(DUP_KEY) || '[]') } catch { return [] } }
  useEffect(() => {
    if (notesTab !== 'mine') return
    api('/api/notes/duplicates').then(j => setDupGroups((j.data || []).filter(g => !dupDismissed().includes(dupKey(g))))).catch(() => {})
  }, [notes, notesTab]) // eslint-disable-line react-hooks/exhaustive-deps
  const dismissDup = (g) => {
    localStorage.setItem(DUP_KEY, JSON.stringify([...dupDismissed(), dupKey(g)].slice(-50)))
    setDupGroups(prev => prev.filter(x => dupKey(x) !== dupKey(g)))
  }
  const delDupNote = async (noteId, g) => {
    if (!confirm('删除这张素材卡片？（组里其它的保留）')) return
    try {
      await api(`/api/notes/${noteId}`, { method: 'DELETE' })
      showToast('已删除重复素材')
      loadNotes(); fetchFiltered()
      // 组内移除这条；只剩 1 条即视为已解决，整组消失
      setDupGroups(prev => prev.map(x => dupKey(x) === dupKey(g) ? { ...x, notes: x.notes.filter(n => n.id !== noteId) } : x).filter(x => x.notes.length >= 2))
    } catch (err) { showToast(`删除失败：${err.message}`) }
  }

  // ---- 聚合建议（2026-07-16 反馈 #4：AI 提议哪些放一起、为什么；用户勾选裁决） ----
  const [clusters, setClusters] = useState([])
  const [clusterEdit, setClusterEdit] = useState({}) // key → { name, excluded:Set }
  const clusterKey = (sug) => [...sug.noteIds].sort().join('|')
  const dismissed = () => { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') } catch { return [] } }
  useEffect(() => {
    api('/api/notes/new-topic-suggestions')
      .then(j => setClusters((j.data || []).filter(s => !dismissed().includes(clusterKey(s)))))
      .catch(() => {})
  }, [notes]) // eslint-disable-line react-hooks/exhaustive-deps

  // 语义补归类建议（贴合但没标的主题）：约 3-4s，异步拉，不阻塞页面
  useEffect(() => {
    api('/api/notes/topic-suggestions').then(j => setTopicSug(j.data?.suggestions || {})).catch(() => {})
  }, [notes.length]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // 语义搜索激活时：按相关度档筛选（默认全部），避免弱相关一大堆往下滑
  const semanticActive = searchMode === 'semantic' && Boolean(keyword.trim()) && results !== null && results.some(r => r.score != null)
  const relCounts = semanticActive
    ? shown.reduce((a, n) => { a[relBand(n.score)]++; a.all++; return a }, { all: 0, high: 0, mid: 0, low: 0 })
    : null
  const shownFiltered = (semanticActive && relFilter !== 'all') ? shown.filter(n => relBand(n.score) === relFilter) : shown

  // 主题 chips 的计数（基于已加载素材，近似值够用）
  const topicCount = {}
  notes.forEach(n => (n.topic_ids || '').split(',').filter(Boolean).forEach(id => { topicCount[id] = (topicCount[id] || 0) + 1 }))
  const inboxCount = notes.filter(n => !(n.topic_ids || '').trim()).length

  // ---- 素材概览（进页面就看全景，降搜索/注意力成本）----
  const topicsByCount = [...topics].sort((a, b) => (b.note_count || 0) - (a.note_count || 0))
  const mainTopics = topicsByCount.filter(t => (t.note_count || 0) >= 2)
  const scatterCount = topicsByCount.length - mainTopics.length
  const pendingTotal = topics.reduce((a, t) => a + (t.pending_count || 0), 0)
  const topPending = [...topics].filter(t => (t.pending_count || 0) > 0).sort((a, b) => b.pending_count - a.pending_count)[0]
  const readyTopic = topicsByCount.find(t => topicState(t).ready)
  const nextStep = readyTopic
    ? { text: <>从《<b>{readyTopic.name}</b>》开始创作——素材最足、综述已成型</>, cta: '开始创作', act: () => startCreation(readyTopic) }
    : topPending
      ? { text: <>《<b>{topPending.name}</b>》有 {topPending.pending_count} 条待并入，去把综述更新一版</>, cta: '去主题', act: () => gotoTopic?.(topPending.id) }
      : inboxCount > 3
        ? { text: <>先把 <b>{inboxCount}</b> 条未归类整理好，主题才成型</>, cta: '看未归类', act: () => { setNotesTab?.('mine'); setTopicFilter('__none__') } }
        : clusters.length
          ? { text: <>有 {clusters.length} 组零散素材可以聚成新主题</>, cta: null, act: null }
          : { text: <>继续攒——某主题攒到 5 条且综述成型，就能开写了</>, cta: null, act: null }

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
      <div className="wb-page-sub">你从资讯/精读里存下来的 {notes.length} 条有价值内容——可搜索、按主题归类，右侧问整个素材库，创作时引用。</div>

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
          {/* 素材概览：一进页面就看全景——围绕哪几个主题、到什么地步、下一步从哪开始 */}
          {topics.length > 0 && (
            <div className="wb-ov-card">
              <div className="wb-ov-head" onClick={toggleOv}>
                <span className="wb-ov-title">素材概览</span>
                <span className="wb-ov-metaline">{notes.length} 条素材 · 聚在 {mainTopics.length} 个主要主题{scatterCount > 0 ? ` (+${scatterCount} 个零散)` : ''}</span>
                <span className="wb-ov-toggle">{ovOpen ? '收起 ▴' : '展开 ▾'}</span>
              </div>
              {ovOpen && (
                <div className="wb-ov-inner">
                  <div className="wb-ov-topics">
                    {mainTopics.slice(0, 6).map(t => { const st = topicState(t); return (
                      <button key={t.id} className="wb-ov-topic" onClick={() => setTopicFilter(topicFilter === t.id ? '' : t.id)} title="只看这个主题的素材">
                        <span className="wb-ov-tn">{t.name.slice(0, 14)}</span>
                        <span className="wb-ov-tc">{t.note_count}</span>
                        <span className="wb-pill" style={{ fontSize: 10, color: st.fg, background: st.bg }}>{st.label}</span>
                        {t.pending_count > 0 && <span className="wb-pill" style={{ fontSize: 10, color: '#8a6a1a', background: 'rgba(169,121,31,.12)' }}>{t.pending_count} 待并入</span>}
                      </button>
                    ) })}
                  </div>
                  {(inboxCount > 0 || pendingTotal > 0 || clusters.length > 0 || Object.keys(topicSug).length > 0) && (
                    <div className="wb-ov-todo">
                      待处理：
                      {inboxCount > 0 && <button className="wb-brief-link" onClick={() => setTopicFilter('__none__')}>{inboxCount} 条未归类</button>}
                      {pendingTotal > 0 && <span> · {pendingTotal} 条待并入</span>}
                      {Object.keys(topicSug).length > 0 && <span> · <b style={{ color: 'var(--accent)' }}>{Object.keys(topicSug).length} 条可能漏归了主题</b>（卡片上一键补）</span>}
                      {clusters.length > 0 && <span> · {clusters.length} 组可聚成新主题</span>}
                    </div>
                  )}
                  <div className="wb-ov-next">
                    <span className="wb-ov-next-lbl">下一步</span>
                    <span className="wb-ov-next-text">{nextStep.text}</span>
                    {nextStep.cta && <button className="wb-btn-primary" style={{ padding: '5px 14px', fontSize: 12, marginLeft: 'auto', flexShrink: 0 }} onClick={nextStep.act}>{nextStep.cta} →</button>}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="wb-filterbar">
            <div className="wb-seg-toggle" style={{ flexShrink: 0 }} title="语义：按意思找（模糊需求也能命中）；关键词：按字面匹配">
              <button className={searchMode === 'semantic' ? 'active' : ''}
                onClick={() => { setSearchMode('semantic'); setCtypeFilter(''); setSourceFilter('') }}>语义</button>
              <button className={searchMode === 'keyword' ? 'active' : ''} onClick={() => setSearchMode('keyword')}>关键词</button>
            </div>
            <input placeholder={searchMode === 'semantic' ? '描述你想找的（如「怎么降低用户操作摩擦」）…' : '搜索素材（空格分隔多个关键词）…'}
              value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            {/* 类型/来源筛选只在关键词模式下有效，语义模式直接隐藏（不做灰按钮） */}
            {searchMode === 'keyword' && (
              <select className="wb-filter-chip" value={ctypeFilter} onChange={(e) => setCtypeFilter(e.target.value)}>
                <option value="">类型（全部）</option>
                <option value="article">📄 文章</option>
                <option value="video">🎬 视频</option>
                <option value="repo">⭐ GitHub 项目</option>
              </select>
            )}
            {searchMode === 'keyword' && (
              <select className="wb-filter-chip" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
                style={{ maxWidth: 160 }}>
                <option value="">按来源（全部）</option>
                {sourceOptions.map(s => <option key={s.source} value={s.source}>{s.source.slice(0, 24)}（{s.count}）</option>)}
              </select>
            )}
            {hasFilter && (
              <button className="wb-filter-chip" onClick={() => { setKeyword(''); setSourceFilter(''); setTopicFilter(''); setCtypeFilter('') }}>清除筛选</button>
            )}
          </div>

          {/* 语义搜索时用相关度档 chips（主题 chips 对语义结果无意义，换掉不并列）；
              否则用主题 tab（2026-07-16 反馈：内容多时下拉切换太钝，chips 一点即切） */}
          {semanticActive ? (
            <div className="wb-topic-chips">
              <button className={`wb-topic-chip${relFilter === 'all' ? ' active' : ''}`} onClick={() => setRelFilter('all')}>全部（{relCounts.all}）</button>
              <button className={`wb-topic-chip${relFilter === 'high' ? ' active' : ''}`} onClick={() => setRelFilter('high')}
                style={relFilter === 'high' ? undefined : { color: '#3f7350' }}>高度相关（{relCounts.high}）</button>
              <button className={`wb-topic-chip${relFilter === 'mid' ? ' active' : ''}`} onClick={() => setRelFilter('mid')}
                style={relFilter === 'mid' ? undefined : { color: '#8a6a1a' }}>相关（{relCounts.mid}）</button>
              <button className={`wb-topic-chip${relFilter === 'low' ? ' active' : ''}`} onClick={() => setRelFilter('low')}>弱相关（{relCounts.low}）</button>
            </div>
          ) : (
            <div className="wb-topic-chips">
              <button className={`wb-topic-chip${!topicFilter ? ' active' : ''}`} onClick={() => setTopicFilter('')}>全部</button>
              <button className={`wb-topic-chip${topicFilter === '__none__' ? ' active' : ''}`} onClick={() => setTopicFilter('__none__')}>
                未归类{inboxCount ? `（${inboxCount}）` : ''}
              </button>
              {(() => {
                // 瘦身：按素材数降序，默认只显示有量的（≥2）主题，零散单条藏进「更多」
                const sorted = [...topics].sort((a, b) => (topicCount[b.id] || 0) - (topicCount[a.id] || 0))
                const primary = showAllTopics ? sorted : sorted.filter(t => (topicCount[t.id] || 0) >= 2 || t.id === topicFilter)
                const hidden = sorted.length - primary.length
                return (<>
                  {primary.map(t => (
                    <button key={t.id} className={`wb-topic-chip${topicFilter === t.id ? ' active' : ''}`}
                      onClick={() => setTopicFilter(topicFilter === t.id ? '' : t.id)} title={t.name}>
                      {t.name.slice(0, 12)}{topicCount[t.id] ? `（${topicCount[t.id]}）` : ''}
                    </button>
                  ))}
                  {!showAllTopics && hidden > 0 && (
                    <button className="wb-topic-chip" onClick={() => setShowAllTopics(true)}>更多 {hidden} 个 ▾</button>
                  )}
                  {showAllTopics && (
                    <button className="wb-topic-chip" onClick={() => setShowAllTopics(false)}>收起 ▴</button>
                  )}
                </>)
              })()}
            </div>
          )}
          {hasFilter && results !== null && (
            <div style={{ fontSize: 12, color: 'var(--sub2)', margin: '6px 2px 0' }}>
              {searchMode === 'semantic' && keyword.trim()
                ? (results.length && results[0].score < 0.47
                    ? '库里暂时没有很贴合的，下面是最接近的几条——换个说法或再攒点素材试试'
                    : `按语义相关度排序（AI 比对意思，不是关键词）· ${results.length} 条`)
                : `筛选出 ${results.length} 条`}
            </div>
          )}

          {/* 查重条（1b）：语义判定的疑似重复素材，用户保留想要的、删掉多余 */}
          {!hasFilter && dupGroups.length > 0 && (
            <div style={{ margin: '10px 2px', border: '1px solid var(--line10)', borderRadius: 10, padding: '10px 12px', background: 'var(--surface)' }}>
              <div onClick={() => setDupOpen(o => !o)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
                🔁 发现 {dupGroups.length} 组疑似重复素材
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 400, color: 'var(--sub2)' }}>{dupOpen ? '收起 ▴' : '展开处理 ▾'}</span>
              </div>
              {dupOpen && dupGroups.map(g => (
                <div key={dupKey(g)} style={{ marginTop: 10, padding: 10, border: '1px solid var(--line08)', borderRadius: 8 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--sub2)', marginBottom: 6 }}>相似度 {Math.round(g.score * 100)}% · 保留你要的、删掉多余的（删除不影响另一条）</div>
                  {g.notes.map(n => (
                    <div key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', borderTop: '1px dashed var(--line08)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title || '（无标题）'}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--sub)', lineHeight: 1.5, maxHeight: 42, overflow: 'hidden' }}>{n.excerpt}</div>
                        <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>来源：{n.source_title || '未知'}</div>
                      </div>
                      <button className="wb-btn-ghost" style={{ flexShrink: 0 }} onClick={() => delDupNote(n.id, g)}>删除</button>
                    </div>
                  ))}
                  <button className="wb-btn-ghost" style={{ marginTop: 6 }} onClick={() => dismissDup(g)}>不是重复 · 忽略</button>
                </div>
              ))}
            </div>
          )}

          {/* 聚合建议条：AI 提议哪些未归类素材放一起 + 为什么（共享关键词），用户勾选裁决 */}
          {!hasFilter && clusters.map(sug => {
            const key = clusterKey(sug)
            const edit = clusterEdit[key] || {}
            const excluded = edit.excluded || new Set()
            return (
              <div key={key} className="wb-cluster-card">
                <div className="wb-cluster-head">
                  这 {sug.noteIds.length} 条不属于现有主题、但聊的是同一类事 → 可建新主题
                  <span className="wb-cluster-why">{sug.sharedKeywords?.[0] === '语义相关' ? '语义相关' : `共享：${sug.sharedKeywords.join('、')}`}</span>
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

          {(hasFilter ? shownFiltered : shown).length === 0 && (
            <div className="wb-empty">
              {semanticActive && relFilter !== 'all' ? '这个相关度档没有素材，换个档看看' : hasFilter ? '没有匹配的素材' : <>还没有素材。<br />去资讯页选中内容分析，把有价值的回答「保存到笔记」。</>}
            </div>
          )}

          {hasFilter
            ? shownFiltered.map(note => renderNote(note))
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
            {note.score != null && (() => { const r = relevanceLabel(note.score); return (
              <span className="wb-pill" style={{ marginLeft: 6, fontSize: 10, color: r.fg, background: r.bg }}>{r.text}</span>
            ) })()}
            <button className="wb-note-del" style={{ marginLeft: 6, fontSize: 11 }} title="修改标题" onClick={() => renameNote(note)}>✎</button>
          </div>
        )}
        {(() => {
          const long = (note.excerpt || '').length > 200
          const open = expandedNotes.has(note.id)
          if (!long) return <div className="wb-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.excerpt) }} />
          return (
            <div>
              {open
                ? <div className="wb-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.excerpt) }} />
                : <div className="wb-note-excerpt">{plainPreview(note.excerpt, 180)}…</div>}
              <button className="wb-note-jump" style={{ padding: 0, marginTop: 6 }} onClick={() => toggleExpand(note.id)}>
                {open ? '收起 ▴' : '展开全文 ▾'}
              </button>
            </div>
          )
        })()}
        {keywords.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {keywords.map(k => (
              <button key={k} className="wb-chip" title="点击搜索该关键词" onClick={() => setKeyword(k)}>{k}</button>
            ))}
          </div>
        )}
        {/* 语义补归类建议：AI 觉得它还贴合、但你没标的主题（治凭感性漏归） */}
        {topicSug[note.id]?.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, fontSize: 12 }}>
            <span style={{ color: 'var(--accent)' }}>AI 觉得还贴合：</span>
            {topicSug[note.id].map(s => (
              <span key={s.topicId} className="wb-pill" style={{ color: '#3d5a80', background: 'rgba(61,90,128,.08)', border: '1px dashed rgba(61,90,128,.4)', gap: 4 }}>
                <button className="wb-topic-pill-x" style={{ color: '#3d5a80' }} title={`归入《${s.name}》`} onClick={() => acceptSug(note, s)}>＋</button>
                {s.name.slice(0, 14)}
                <button className="wb-topic-pill-x" title="不对，忽略" onClick={() => dismissSug(note, s)}>×</button>
              </span>
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
          <button className="wb-note-jump" title="语义上相关的其它素材（把死知识连成网）"
            onClick={() => toggleRelated(note.id)}>🔗 相关{relatedOpen === note.id ? ' ▴' : ''}</button>
          <span className="wb-note-time">{timeAgo(note.created_at)}</span>
          <button className="wb-note-del" onClick={() => del(note)} title="删除"><IconTrash /></button>
        </div>
        {relatedOpen === note.id && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--line08)' }}>
            {!relatedMap[note.id] && <div style={{ fontSize: 12, color: 'var(--sub2)' }}>找相关素材中…</div>}
            {relatedMap[note.id]?.length === 0 && <div style={{ fontSize: 12, color: 'var(--sub2)' }}>没有明显相关的素材</div>}
            {relatedMap[note.id]?.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 6, lineHeight: 1.5 }}>
                按<b style={{ color: 'var(--sub2)' }}>意思的接近度</b>找的——AI 读过每条素材的含义、逐一比对相似度（不是靠共同关键词），越靠上越接近。
              </div>
            )}
            {relatedMap[note.id]?.map(r => { const rl = relevanceLabel(r.score); return (
              <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                <span className="wb-pill" style={{ fontSize: 10, color: rl.fg, background: rl.bg, flexShrink: 0 }}>{rl.text}</span>
                <button className="wb-note-jump" style={{ textAlign: 'left', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title="跳到这条素材" onClick={() => jumpToNote(r.id)}>{r.title || r.source_title || '（无标题）'}</button>
              </div>
            ) })}
          </div>
        )}
      </div>
    )
  }
}

// 主题成熟度（素材概览：告诉用户每个主题到什么地步了）
function topicState(t) {
  let cur = ''
  try { const b = typeof t.body === 'string' ? JSON.parse(t.body || '{}') : (t.body || {}); cur = (b.current || '').trim() } catch { /* noop */ }
  const hasSyn = cur.length > 60 // 真综述才算，10 字的占位 stub 不算"成型"
  const n = t.note_count || 0
  if (n >= 5 && hasSyn) return { label: '够写一篇', fg: '#3f7350', bg: 'rgba(63,115,80,.14)', ready: true }
  if (n >= 3 && hasSyn) return { label: '综述成型', fg: '#3d5a80', bg: 'rgba(61,90,128,.12)' }
  if (n >= 1) return { label: '攒素材中', fg: '#8a6a1a', bg: 'rgba(169,121,31,.12)' }
  return { label: '刚起步', fg: '#8a8478', bg: 'rgba(33,31,26,.06)' }
}

// 折叠预览：剥掉 markdown 符号，取首段纯文本（素材页急救：卡片不再倒整篇原文）
function plainPreview(md, n) {
  return String(md || '')
    .replace(/^#{1,6}\s+/gm, '').replace(/^>\s?/gm, '').replace(/^[-*]\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ').trim().slice(0, n)
}

function safeParseKeywords(s) {
  try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}

// 语义相关度 → 人话标签（用户看不懂 0.66 这种分数，产品要一眼就懂）。
// 阈值按 bge-m3 实测：贴合的匹配约 0.5+，无关约 0.3。
function relevanceLabel(score) {
  if (score >= 0.55) return { text: '高度相关', fg: '#3f7350', bg: 'rgba(63,115,80,.14)' }
  if (score >= 0.47) return { text: '相关', fg: '#8a6a1a', bg: 'rgba(169,121,31,.14)' }
  return { text: '弱相关', fg: '#8a8478', bg: 'rgba(33,31,26,.07)' }
}
function relBand(score) { return score >= 0.55 ? 'high' : score >= 0.47 ? 'mid' : 'low' }
