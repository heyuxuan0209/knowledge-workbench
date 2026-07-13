import { useState, useEffect, useCallback } from 'react'
import { useResizablePanel } from '../hooks/useResizablePanel'
import FeedCard from '../components/feed/FeedCard'
import AiPanel from '../components/feed/AiPanel'
import '../styles/feed.css'

// Feed 主页（移植自 prototype/feed-v1.html）：三栏布局 = 左侧导航 + 中间 Feed 流 + 右侧 AI 面板。
// 左右两栏可拖拽调宽、拖到底折叠为窄条（useResizablePanel）。
// 数据来自 GET /api/contents；即兴对话走 AiPanel 内的 SSE。
//
// 简化范围（与原型一致）：近期焦点是占位（依赖 Story 聚类，Phase 3）；Topics/Saved 是导航占位。

export default function FeedPage() {
  const [contents, setContents] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [pasteInput, setPasteInput] = useState('')
  const [adHocContent, setAdHocContent] = useState(null)
  const [ingesting, setIngesting] = useState(false)

  const sidebar = useResizablePanel({ side: 'left', minWidth: 160, maxWidth: 320, defaultWidth: 192 })
  const aiPanel = useResizablePanel({ side: 'right', minWidth: 240, maxWidth: 480, defaultWidth: 320 })

  const loadFeed = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/contents?limit=30')
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'API returned success:false')
      // 字段映射：SQL JOIN 出的 source_* 列名 → FeedCard 期望的 display_name/platform/handle
      setContents((json.data || []).map(item => ({
        ...item,
        display_name: item.source_display_name,
        platform: item.source_platform,
        handle: item.source_handle
      })))
    } catch (err) {
      console.error('Failed to fetch contents:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadFeed() }, [loadFeed])

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    // 选中 Feed 内容时清掉 adHoc，两种入口互斥（避免上下文混淆）
    setAdHocContent(null)
  }

  const handleAnalyzePaste = async () => {
    const input = pasteInput.trim()
    if (!input || ingesting) return
    setIngesting(true)
    try {
      const res = await fetch('/api/content/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input })
      })
      const json = await res.json()
      if (!json.success) {
        alert(`摄入失败：${json.data?.fetchError || json.error || '未知错误'}`)
        return
      }
      // 摄入成功 → 作为 adHoc 内容交给 AiPanel（清掉 Feed 选中，两入口互斥）
      setSelectedIds(new Set())
      setAdHocContent(json.data)
      setPasteInput('')
    } catch (err) {
      alert(`请求失败：${err.message}`)
    } finally {
      setIngesting(false)
    }
  }

  const selectedItems = contents.filter(c => selectedIds.has(c.id))

  return (
    <div className="layout">
      {/* 左侧导航 */}
      {!sidebar.collapsed && (
        <>
          <aside className="sidebar" style={{ width: sidebar.width }}>
            <button className="rail-toggle-btn sidebar-collapse-btn" onClick={sidebar.collapse} title="折叠导航">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <div className="sidebar-content">
              <div className="logo">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                </svg>
                <span className="logo-text">Research</span>
              </div>
              <nav className="nav">
                <a href="#" className="nav-item active">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                  </svg>
                  <span>Feed</span>
                </a>
                <a href="#" className="nav-item">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>Topics</span>
                  <span className="badge">0</span>
                </a>
                <a href="#" className="nav-item">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
                  </svg>
                  <span>Saved</span>
                </a>
              </nav>
              <div className="nav-footer">
                <a href="#" className="nav-item">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" /><path d="M12 1v6m0 6v6m9-9h-6m-6 0H3" />
                  </svg>
                  <span>Settings</span>
                </a>
              </div>
            </div>
          </aside>
          <div className="drag-handle" onMouseDown={sidebar.onDragStart} />
        </>
      )}
      {sidebar.collapsed && (
        <button className="rail-strip left-rail visible" onClick={sidebar.expand} title="展开导航">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}

      {/* 主内容区 */}
      <main className="main">
        <div className="main-header">
          <div className="paste-bar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <input
              type="text"
              value={pasteInput}
              onChange={(e) => setPasteInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAnalyzePaste() }}
              placeholder="粘贴链接/文本开始分析..."
            />
            <button className="btn-analyze" disabled={!pasteInput.trim() || ingesting} onClick={handleAnalyzePaste}>
              {ingesting ? '分析中...' : '分析'}
            </button>
          </div>
        </div>

        <div className="main-content">
          <section className="focus-section">
            <div className="focus-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z" />
              </svg>
              <span>近期焦点</span>
              <span className="focus-status">尚未上线 · 依赖 Story 聚类（见 docs/WIREFRAMES.md）</span>
            </div>
          </section>

          <div className="feed-toolbar">
            <span className="toolbar-label">排序:</span>
            <select className="sort-select"><option>综合热度</option><option>最新</option></select>
            <span className="toolbar-label">过滤:</span>
            <select className="filter-select"><option>全部</option></select>
            <span className="feed-count">
              {loading ? '加载中...' : `共 ${contents.length} 条 · 实时来自 GET /api/contents`}
            </span>
          </div>

          <div className="feed-list">
            {loading ? (
              <div className="loading">加载中...</div>
            ) : contents.length === 0 ? (
              <div className="loading">暂无内容，请先运行数据同步（sync-aihot / sync-rss / sync-hackernews）</div>
            ) : (
              contents.map(item => (
                <FeedCard
                  key={item.id}
                  item={item}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={toggleSelect}
                />
              ))
            )}
          </div>
        </div>
      </main>

      {/* 右侧 AI 面板 */}
      {aiPanel.collapsed && (
        <button className="rail-strip right-rail visible" onClick={aiPanel.expand} title="展开 Quick Analysis 面板">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {(selectedIds.size > 0) && <span className="rail-badge">{selectedIds.size}</span>}
        </button>
      )}
      {!aiPanel.collapsed && (
        <>
          <div className="drag-handle" onMouseDown={aiPanel.onDragStart} />
          <aside className="ai-panel" style={{ width: aiPanel.width }}>
            <button className="rail-toggle-btn ai-panel-collapse-btn" onClick={aiPanel.collapse} title="折叠面板">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
            <AiPanel
              selectedItems={selectedItems}
              adHocContent={adHocContent}
              onClearAdHoc={() => setAdHocContent(null)}
            />
          </aside>
        </>
      )}
    </div>
  )
}
