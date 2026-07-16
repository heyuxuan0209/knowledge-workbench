import { useState, useEffect, useRef, useCallback } from 'react'
import { timeAgo, STANCE_COLORS, STANCE_CN, api } from './util'
import { IconClip, IconExternal, IconTrash } from './Icons'

// 素材库（视觉对齐原型 02-notes）：结构化摘录 + 来源引用 + 立场徽章（可选）+ 删除。
// highlightNoteId：从创作台/主题页/周报点素材跳转过来时，滚动定位并高亮该卡片。
// 筛选/搜索（2026-07-16 反馈 #8）：关键词（空格分多词模糊匹配）/ 按来源 / 按主题，
// 全部走后端 SQL——不再是"只搜已加载那一页"的前端内存过滤。

const PAGE_LABEL = { studio: '创作台', topics: '主题库', feed: '资讯', reports: '周报' }

export default function NotesView({ notes, loadNotes, showToast, highlightNoteId, setHighlightNoteId, returnPage, goBack, topics = [] }) {
  const [keyword, setKeyword] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [topicFilter, setTopicFilter] = useState('')
  const [sourceOptions, setSourceOptions] = useState([])
  const [results, setResults] = useState(null) // null = 无筛选，展示全局列表
  const highlightRef = useRef(null)

  useEffect(() => {
    api('/api/notes/sources').then(j => setSourceOptions(j.data || [])).catch(() => {})
  }, [])

  const hasFilter = Boolean(keyword.trim() || sourceFilter || topicFilter)

  const fetchFiltered = useCallback(async () => {
    if (!hasFilter) { setResults(null); return }
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (keyword.trim()) params.set('q', keyword.trim())
      if (sourceFilter) params.set('source', sourceFilter)
      if (topicFilter) params.set('topicId', topicFilter)
      setResults((await api(`/api/notes?${params}`)).data || [])
    } catch (err) { console.error(err) }
  }, [hasFilter, keyword, sourceFilter, topicFilter])

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

  const shown = results ?? notes

  return (
    <>
      {returnPage && (
        <button className="wb-back" onClick={goBack}>← 返回{PAGE_LABEL[returnPage] || '上一页'}</button>
      )}
      <div className="wb-page-title">素材库</div>
      <div className="wb-page-sub">{notes.length} 张素材卡片 · 在 AI 对话里点「保存到笔记」沉淀 · 创作台按段引用</div>

      <div className="wb-filterbar">
        <input placeholder="搜索素材（空格分隔多个关键词）…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <select className="wb-filter-chip" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
          style={{ maxWidth: 160 }}>
          <option value="">按来源（全部）</option>
          {sourceOptions.map(s => <option key={s.source} value={s.source}>{s.source.slice(0, 24)}（{s.count}）</option>)}
        </select>
        <select className="wb-filter-chip" value={topicFilter} onChange={(e) => setTopicFilter(e.target.value)}
          style={{ maxWidth: 160 }}>
          <option value="">按主题（全部）</option>
          {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {hasFilter && (
          <button className="wb-filter-chip" onClick={() => { setKeyword(''); setSourceFilter(''); setTopicFilter('') }}>清除筛选</button>
        )}
      </div>
      {hasFilter && results !== null && (
        <div style={{ fontSize: 12, color: 'var(--sub2)', margin: '6px 2px 0' }}>筛选出 {results.length} 条</div>
      )}

      {shown.length === 0 && (
        <div className="wb-empty">
          {hasFilter ? '没有匹配的素材' : <>还没有素材。<br />去资讯页选中内容分析，把有价值的回答「保存到笔记」。</>}
        </div>
      )}

      {shown.map(note => {
        const stanceCn = STANCE_CN[note.stance] || note.stance
        const sc = STANCE_COLORS[note.stance]
        const url = note.content_url || note.source_url
        const title = note.content_zh_title || note.source_title
        const highlighted = note.id === highlightNoteId
        return (
          <div key={note.id} className="wb-card" ref={highlighted ? highlightRef : null}
            style={highlighted ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 2px rgba(61,90,128,.18)', transition: 'box-shadow .3s' } : undefined}>
            {note.title && <div style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{note.title}</div>}
            <div className="wb-note-excerpt">{note.excerpt}</div>
            <div className="wb-note-foot">
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
              {note.topic_names && (
                <span className="wb-pill" style={{ color: '#3d5a80', background: 'rgba(61,90,128,.1)' }} title="所属主题">{note.topic_names}</span>
              )}
              <span className="wb-note-time">{timeAgo(note.created_at)}</span>
              <button className="wb-note-del" onClick={() => del(note)} title="删除"><IconTrash /></button>
            </div>
          </div>
        )
      })}
    </>
  )
}
