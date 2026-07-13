import { useState, useEffect } from 'react'
import axios from 'axios'

export default function WorkspaceDetailPage({ workspaceId, onBack, onSelectConversation }) {
  const [workspace, setWorkspace] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newConvTitle, setNewConvTitle] = useState('')
  const [llmProvider, setLlmProvider] = useState('deepseek')

  useEffect(() => {
    fetchWorkspace()
  }, [workspaceId])

  const fetchWorkspace = async () => {
    try {
      const response = await axios.get(`/api/workspaces/${workspaceId}`)
      setWorkspace(response.data.data)
    } catch (error) {
      console.error('Failed to fetch workspace:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateConversation = async () => {
    if (!newConvTitle.trim()) return

    try {
      const response = await axios.post('/api/conversations', {
        workspaceId,
        title: newConvTitle,
        llmProvider
      })

      if (response.data.success) {
        await fetchWorkspace()
        setShowCreateDialog(false)
        setNewConvTitle('')

        // 自动打开新创建的对话
        onSelectConversation(response.data.data.id)
      }
    } catch (error) {
      console.error('Failed to create conversation:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-stone-50">
        <div className="text-stone-500">加载中...</div>
      </div>
    )
  }

  if (!workspace) {
    return (
      <div className="flex items-center justify-center h-screen bg-stone-50">
        <div className="text-stone-500">工作区不存在</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 p-8">
      <div className="max-w-4xl mx-auto">
        {/* 头部 */}
        <div className="mb-8">
          <button
            onClick={onBack}
            className="text-stone-600 hover:text-stone-900 mb-4 flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            返回
          </button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-stone-900">{workspace.name}</h1>
              {workspace.description && (
                <p className="text-stone-600 mt-2">{workspace.description}</p>
              )}
            </div>
            <button
              onClick={() => setShowCreateDialog(true)}
              className="px-4 py-2 bg-stone-900 text-white rounded-lg hover:bg-stone-800 transition-colors"
            >
              新建对话
            </button>
          </div>
        </div>

        {/* 对话列表 */}
        {!workspace.conversations || workspace.conversations.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-stone-500 mb-4">还没有对话</p>
            <button
              onClick={() => setShowCreateDialog(true)}
              className="text-stone-900 hover:underline"
            >
              创建第一个对话
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {workspace.conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className="bg-white rounded-lg p-4 border border-stone-200 hover:border-stone-300 cursor-pointer transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-medium text-stone-900 mb-1">{conv.title}</h3>
                    <div className="flex items-center gap-4 text-xs text-stone-500">
                      <span>{conv.message_count || 0} 条消息</span>
                      <span>{conv.total_tokens || 0} tokens</span>
                      <span>¥{(conv.total_cost || 0).toFixed(4)}</span>
                      <span className="capitalize">{conv.llm_provider}</span>
                    </div>
                  </div>
                  <div className="text-xs text-stone-400">
                    {new Date(conv.updated_at).toLocaleDateString('zh-CN')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 创建对话对话框 */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-stone-900 mb-4">新建对话</h2>

            <div className="mb-4">
              <label className="block text-sm font-medium text-stone-700 mb-2">
                对话主题
              </label>
              <input
                type="text"
                value={newConvTitle}
                onChange={(e) => setNewConvTitle(e.target.value)}
                placeholder="例如：总结最新 AI 趋势"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-900"
                autoFocus
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-stone-700 mb-2">
                LLM 提供商
              </label>
              <select
                value={llmProvider}
                onChange={(e) => setLlmProvider(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-900"
              >
                <option value="deepseek">Deepseek（¥1/M tokens）</option>
                <option value="claude" disabled>Claude（开发中）</option>
              </select>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreateDialog(false)
                  setNewConvTitle('')
                }}
                className="flex-1 px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreateConversation}
                disabled={!newConvTitle.trim()}
                className="flex-1 px-4 py-2 bg-stone-900 text-white rounded-lg hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
