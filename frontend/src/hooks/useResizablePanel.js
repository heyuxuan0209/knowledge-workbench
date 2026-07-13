import { useRef, useState, useCallback, useEffect } from 'react'

// 复现原型 feed-v1.js 的 setupPanel：面板可拖拽调宽 + 拖到底自动折叠 + 窄条点击展开。
// 与原型的差异：原型直接操作 DOM style.width，这里用 React state 驱动宽度，
// 折叠态用条件渲染切换（由调用方根据 collapsed 决定渲染面板还是窄条）。
//
// side: 'left' | 'right' —— 决定拖拽方向（左栏向右拖变宽，右栏向左拖变宽）。
// 参数与原型一致：minWidth / maxWidth / defaultWidth。
export function useResizablePanel({ side, minWidth, maxWidth, defaultWidth }) {
  const [width, setWidth] = useState(defaultWidth)
  const [collapsed, setCollapsed] = useState(false)
  const dragState = useRef({ dragging: false, startX: 0, startWidth: 0 })

  const collapse = useCallback(() => setCollapsed(true), [])
  const expand = useCallback(() => setCollapsed(false), [])

  const onDragStart = useCallback((e) => {
    dragState.current = {
      dragging: true,
      startX: e.clientX,
      startWidth: width
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width])

  useEffect(() => {
    function onMouseMove(e) {
      const st = dragState.current
      if (!st.dragging) return
      // 左栏：鼠标右移变宽；右栏：鼠标左移变宽（与原型 delta 计算一致）
      const delta = side === 'left' ? (e.clientX - st.startX) : (st.startX - e.clientX)
      const newWidth = st.startWidth + delta

      // 拖得比 minWidth 还小 20px 视为「拖到底」，直接折叠（原型手感）
      if (newWidth < minWidth - 20) {
        st.dragging = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setCollapsed(true)
        return
      }
      setWidth(Math.min(maxWidth, Math.max(minWidth, newWidth)))
    }

    function onMouseUp() {
      if (dragState.current.dragging) {
        dragState.current.dragging = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [side, minWidth, maxWidth])

  return { width, collapsed, collapse, expand, onDragStart }
}
