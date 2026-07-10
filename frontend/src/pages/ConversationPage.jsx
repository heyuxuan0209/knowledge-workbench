import { useState, useEffect } from 'react'
import axios from 'axios'
import ChatInterface from '../components/workspace/ChatInterface'
import MaterialsPanel from '../components/workspace/MaterialsPanel'

export default function ConversationPage({ workspaceId, conversationId, onBack }) {
  const [conversation, setConversation] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (conversationId) {
      fetchConversation()
    }
  }, [conversationId])

  const fetchConversation = async () => {
    try {
      const response = await axios.get(`/api/conversations/${conversationId}`)
      setConversation(response.data.data)
    } catch (error) {
      console.error('Failed to fetch conversation:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = () => {
    fetchConversation()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-stone-50">
        <div className="text-stone-500">加载中...</div>
      </div>
    )
  }

  if (!conversation) {
    return (
      <div className="flex items-center justify-center h-screen bg-stone-50">
        <div className="text-stone-500">对话不存在</div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-stone-50 flex">
      {/* 左侧：对话界面 */}
      <div className="flex-1 flex flex-col">
        {/* 顶部导航 */}
        <div className="h-16 border-b border-stone-200 bg-white px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="text-stone-600 hover:text-stone-900"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-lg font-medium text-stone-900">{conversation.title}</h1>
          </div>

          <div className="flex items-center gap-2 text-xs text-stone-500">
            <span>{conversation.stats.total_tokens || 0} tokens</span>
            <span>·</span>
            <span>¥{(conversation.stats.total_cost || 0).toFixed(4)}</span>
          </div>
        </div>

        {/* 对话区域 */}
        <ChatInterface
          conversationId={conversationId}
          messages={conversation.messages}
          provider={conversation.llm_provider}
          onRefresh={handleRefresh}
        />
      </div>

      {/* 右侧：材料和产出面板 */}
      <MaterialsPanel
        conversationId={conversationId}
        materials={conversation.materials}
        onRefresh={handleRefresh}
        onInsertMaterial={(material) => {
          // 通过自定义事件通知 ChatInterface
          window.dispatchEvent(new CustomEvent('insertMaterial', {
            detail: { material }
          }))
        }}
      />
    </div>
  )
}
