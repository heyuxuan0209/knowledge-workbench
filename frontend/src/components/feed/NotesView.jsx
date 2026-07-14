import { useState, useEffect, useCallback } from 'react'

// 素材库（M1 沉淀层，ADR-010）：展示用户保存的素材卡片。
// 每张卡片 = 结构化摘录 + 来源引用（可跳转），创作时（M4）按段落溯源到这里。

function timeAgo(isoString) {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString + 'Z').getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return '刚刚'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function NotesView() {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)

  const loadNotes = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notes?limit=100')
      const json = await res.json()
      if (json.success) setNotes(json.data)
    } catch (err) {
      console.error('Failed to fetch notes:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadNotes() }, [loadNotes])

  const handleDelete = async (id) => {
    if (!confirm('删除这张素材卡片？')) return
    try {
      await fetch(`/api/notes/${id}`, { method: 'DELETE' })
      setNotes(prev => prev.filter(n => n.id !== id))
    } catch (err) {
      alert(`删除失败：${err.message}`)
    }
  }

  return (
    <div className="notes-view">
      <div className="view-header">
        <h2>素材库</h2>
        <span className="view-subtitle">
          {loading ? '加载中...' : `${notes.length} 张素材卡片 · 在 AI 对话中点"保存到笔记"沉淀素材`}
        </span>
      </div>

      {!loading && notes.length === 0 && (
        <div className="empty-state" style={{ padding: '3rem 1rem' }}>
          还没有素材。去 Feed 选中内容开始分析，把有价值的回答保存到笔记。
        </div>
      )}

      <div className="notes-list">
        {notes.map(note => {
          const url = note.content_url || note.source_url
          const title = note.content_zh_title || note.source_title
          return (
            <div key={note.id} className="note-card">
              <div className="note-excerpt">{note.excerpt}</div>
              <div className="note-footer">
                <span className="note-source">
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer">📎 {title || url}</a>
                  ) : (
                    <span>📎 {title || '无来源信息'}</span>
                  )}
                </span>
                <span className="note-time">{timeAgo(note.created_at)}</span>
                <button className="note-delete" onClick={() => handleDelete(note.id)} title="删除">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  </svg>
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
