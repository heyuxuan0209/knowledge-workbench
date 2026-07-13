import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import EphemeralChatDialog from '../components/EphemeralChatDialog'

// Feed 主页（WIREFRAMES.md §1 的简化版）：全量流 + 即兴分析入口。
// 简化范围（相比线框图）：暂不做"近期焦点"Story 聚类模块（stories 表还没有写入逻辑，
// 见 schema-v3.sql 注释）、暂不做 Topics 侧栏（Topic 归类是 Phase 3，见架构文档 §10）。
// 这两项一旦有对应的后端能力再补，不在这里预留空壳 UI。
const CONTENT_TYPE_LABEL = {
  article: '文章', video: '视频', tweet: '推文', paper: '论文', repo: '仓库', text: '文本'
}

function formatTime(dateStr) {
  if (!dateStr) return ''
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diffMs / 1000 / 60 / 60)
  if (hours < 1) return '刚刚'
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

export default function FeedPage() {
  const [contents, setContents] = useState([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [pasteInput, setPasteInput] = useState('')
  const [dialog, setDialog] = useState(null) // { contentIds, contentTitles, adHocInput } | null

  const LIMIT = 20

  const loadPage = useCallback(async (nextOffset) => {
    setLoading(true)
    try {
      const res = await axios.get('/api/contents', { params: { limit: LIMIT, offset: nextOffset } })
      const page = res.data.data || []
      setContents(prev => nextOffset === 0 ? page : [...prev, ...page])
      setHasMore(page.length === LIMIT)
      setOffset(nextOffset + page.length)
    } catch (error) {
      console.error('Failed to fetch contents:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPage(0) }, [loadPage])

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleAnalyzeSelected = () => {
    const ids = [...selectedIds]
    const titles = contents.filter(c => ids.includes(c.id)).map(c => c.zh_title || c.en_title).filter(Boolean)
    setDialog({ contentIds: ids, contentTitles: titles, adHocInput: null })
  }

  const handleAnalyzePaste = (e) => {
    e.preventDefault()
    if (!pasteInput.trim()) return
    setDialog({ contentIds: [], contentTitles: [], adHocInput: pasteInput.trim() })
    setPasteInput('')
  }

  const closeDialog = () => setDialog(null)

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Research Workbench</h1>

      <form onSubmit={handleAnalyzePaste} className="flex gap-2 mb-8">
        <input
          value={pasteInput}
          onChange={(e) => setPasteInput(e.target.value)}
          placeholder="粘贴链接/文本开始分析…"
          className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
        <button
          type="submit"
          disabled={!pasteInput.trim()}
          className="px-5 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-40"
        >
          分析
        </button>
      </form>

      <div className="space-y-4">
        {contents.map(item => {
          const title = item.zh_title || item.en_title || '（无标题）'
          const selected = selectedIds.has(item.id)
          return (
            <article
              key={item.id}
              className={`border rounded-lg p-4 transition-colors ${selected ? 'border-gray-900 bg-gray-50' : 'border-gray-100 hover:border-gray-200'}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleSelect(item.id)}
                  className="mt-1.5 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-1.5">
                    <span className="font-medium text-gray-900">
                      {item.source_display_name || '未识别来源'}
                    </span>
                    <span className="px-1.5 py-0.5 bg-gray-100 rounded">
                      {CONTENT_TYPE_LABEL[item.content_type] || item.content_type}
                    </span>
                    {item.external_score > 0 && <span>⭐ {item.external_score}</span>}
                    <span>{formatTime(item.published_at)}</span>
                  </div>
                  <h3 className="text-base font-medium text-gray-900 mb-1.5 leading-snug">{title}</h3>
                  {item.zh_summary && (
                    <p className="text-sm text-gray-600 leading-relaxed mb-2">{item.zh_summary}</p>
                  )}
                  <div className="flex gap-3 text-xs">
                    <button
                      onClick={() => setDialog({ contentIds: [item.id], contentTitles: [title], adHocInput: null })}
                      className="text-gray-500 hover:text-gray-900 font-medium"
                    >
                      选中分析
                    </button>
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-gray-900">
                        查看原文 ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {contents.length === 0 && !loading && (
        <div className="text-center text-gray-400 text-sm py-12">暂无内容</div>
      )}

      {hasMore && (
        <div className="text-center mt-6">
          <button
            onClick={() => loadPage(offset)}
            disabled={loading}
            className="text-sm text-gray-500 hover:text-gray-900 disabled:opacity-50"
          >
            {loading ? '加载中…' : '加载更多'}
          </button>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white rounded-full shadow-lg px-5 py-3 flex items-center gap-4 text-sm">
          <span>已选 {selectedIds.size} 项</span>
          <button onClick={handleAnalyzeSelected} className="font-medium hover:underline">开始分析</button>
          <button onClick={() => setSelectedIds(new Set())} className="text-gray-400 hover:text-white">取消</button>
        </div>
      )}

      {dialog && (
        <EphemeralChatDialog
          contentIds={dialog.contentIds}
          contentTitles={dialog.contentTitles}
          adHocInput={dialog.adHocInput}
          onClose={closeDialog}
        />
      )}
    </div>
  )
}
