import { useState } from 'react'
import { timeAgo, STANCE_COLORS, STANCE_CN, api } from './util'
import { IconClip, IconExternal, IconTrash } from './Icons'

// 素材库（视觉对齐原型 02-notes）：结构化摘录 + 来源引用 + 立场徽章（可选）+ 删除。

export default function NotesView({ notes, loadNotes, showToast }) {
  const [keyword, setKeyword] = useState('')

  const del = async (note) => {
    if (!confirm('删除这张素材卡片？')) return
    try {
      await api(`/api/notes/${note.id}`, { method: 'DELETE' })
      loadNotes()
    } catch (err) { showToast(`删除失败：${err.message}`) }
  }

  const filtered = keyword.trim()
    ? notes.filter(n => (n.excerpt + (n.source_title || '') + (n.content_zh_title || '')).includes(keyword.trim()))
    : notes

  return (
    <>
      <div className="wb-page-title">素材库</div>
      <div className="wb-page-sub">{notes.length} 张素材卡片 · 在 AI 对话里点「保存到笔记」沉淀 · 创作台按段引用</div>

      <div className="wb-filterbar">
        <input placeholder="搜索素材…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <button className="wb-filter-chip" onClick={() => showToast('按来源筛选：随主题活页（M3）一起上线')}>按来源 ▾</button>
        <button className="wb-filter-chip" onClick={() => showToast('按 Topic 筛选：随主题活页（M3）一起上线')}>按 Topic ▾</button>
      </div>

      {filtered.length === 0 && (
        <div className="wb-empty">
          {keyword ? '没有匹配的素材' : <>还没有素材。<br />去资讯页选中内容分析，把有价值的回答「保存到笔记」。</>}
        </div>
      )}

      {filtered.map(note => {
        const stanceCn = STANCE_CN[note.stance] || note.stance
        const sc = STANCE_COLORS[note.stance]
        const url = note.content_url || note.source_url
        const title = note.content_zh_title || note.source_title
        return (
          <div key={note.id} className="wb-card">
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
              <span className="wb-note-time">{timeAgo(note.created_at)}</span>
              <button className="wb-note-del" onClick={() => del(note)} title="删除"><IconTrash /></button>
            </div>
          </div>
        )
      })}
    </>
  )
}
