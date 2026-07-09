import { useState } from 'react'

export default function MaterialsPanel({ conversationId, materials, onRefresh }) {
  const [activeTab, setActiveTab] = useState('materials') // materials | outputs

  return (
    <div className="w-96 border-l border-stone-200 bg-white flex flex-col">
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
          <MaterialsList materials={materials} onRefresh={onRefresh} />
        ) : (
          <OutputsList conversationId={conversationId} />
        )}
      </div>
    </div>
  )
}

function MaterialsList({ materials, onRefresh }) {
  if (!materials || materials.length === 0) {
    return (
      <div className="text-center py-8 text-stone-400 text-sm">
        <p>暂无材料</p>
        <p className="mt-2">从推送页添加文章到对话</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {materials.map((material) => (
        <div
          key={material.id}
          className="p-3 border border-stone-200 rounded-lg hover:border-stone-300 transition-colors"
        >
          <h4 className="font-medium text-sm text-stone-900 mb-1">{material.title}</h4>
          {material.summary && (
            <p className="text-xs text-stone-600 line-clamp-2">{material.summary}</p>
          )}
          <a
            href={material.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-stone-500 hover:text-stone-700 mt-2 inline-block"
          >
            查看原文 →
          </a>
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
