import { useState } from 'react'
import axios from 'axios'

export default function MaterialsPanel({ conversationId, materials, onRefresh }) {
  const [activeTab, setActiveTab] = useState('materials') // materials | outputs
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    setIsDragOver(false)

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))

      await axios.post(`/api/conversations/${conversationId}/materials`, {
        itemId: data.id
      })

      onRefresh()
    } catch (error) {
      console.error('Failed to add material:', error)
      if (error.response?.status === 409) {
        alert('该材料已添加')
      } else {
        alert('添加材料失败')
      }
    }
  }

  return (
    <div
      className={`w-96 border-l border-stone-200 bg-white flex flex-col ${isDragOver ? 'bg-blue-50' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Tab 切换 */}
      <div className="border-b border-stone-200 flex">
        <button
          onClick={() => setActiveTab('materials')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'materials'
              ? 'text-stone-900 border-b-2 border-stone-900'
              : 'text-stone-500 hover:text-stone-700'
          }`}
        >
          上下文材料
        </button>
        <button
          onClick={() => setActiveTab('outputs')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'outputs'
              ? 'text-stone-900 border-b-2 border-stone-900'
              : 'text-stone-500 hover:text-stone-700'
          }`}
        >
          产出结果
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'materials' ? (
          <MaterialsList materials={materials} onRefresh={onRefresh} onInsertMaterial={(material) => {
            window.dispatchEvent(new CustomEvent('insertMaterial', {
              detail: { material }
            }))
          }} />
        ) : (
          <OutputsList conversationId={conversationId} />
        )}
      </div>
    </div>
  )
}

function MaterialsList({ materials, onRefresh, onInsertMaterial }) {
  if (!materials || materials.length === 0) {
    return (
      <div className="text-center py-8 text-stone-400 text-sm">
        <svg className="w-12 h-12 mx-auto mb-3 text-stone-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="font-medium">暂无材料</p>
        <p className="mt-1">从文章列表拖拽文章到此处</p>
      </div>
    )
  }

  const formatTime = (dateStr) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = Math.floor((now - date) / 1000 / 60)
    if (diff < 1) return '刚刚'
    if (diff < 60) return `${diff}分钟前`
    const hours = Math.floor(diff / 60)
    if (hours < 24) return `${hours}小时前`
    const days = Math.floor(hours / 24)
    return `${days}天前`
  }

  return (
    <div className="space-y-3">
      {materials.map((material) => (
        <div
          key={material.id}
          onClick={() => onInsertMaterial?.(material)}
          className="p-3 border border-stone-200 rounded-lg hover:border-stone-300 hover:shadow-sm cursor-pointer transition-all group"
        >
          <h4 className="font-medium text-sm text-stone-900 mb-1 group-hover:text-blue-600">
            {material.title}
          </h4>
          {material.summary && (
            <p className="text-xs text-stone-600 line-clamp-2 mb-2">{material.summary}</p>
          )}
          <div className="flex items-center justify-between text-xs text-stone-400">
            <span>{material.source}</span>
            <span>{formatTime(material.added_at)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function OutputsList({ conversationId }) {
  return (
    <div className="text-center py-8 text-stone-400 text-sm">
      <p>产出功能开发中</p>
      <p className="mt-2">将展示结构化的分析结果</p>
    </div>
  )
}
