import { useState, useEffect } from 'react'
import axios from 'axios'

export default function WorkspaceListPage({ onSelectWorkspace }) {
  const [workspaces, setWorkspaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newWorkspaceDesc, setNewWorkspaceDesc] = useState('')

  useEffect(() => {
    fetchWorkspaces()
  }, [])

  const fetchWorkspaces = async () => {
    try {
      const response = await axios.get('/api/workspaces')
      setWorkspaces(response.data.data || [])
    } catch (error) {
      console.error('Failed to fetch workspaces:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return

    try {
      const response = await axios.post('/api/workspaces', {
        name: newWorkspaceName,
        description: newWorkspaceDesc
      })

      if (response.data.success) {
        await fetchWorkspaces()
        setShowCreateDialog(false)
        setNewWorkspaceName('')
        setNewWorkspaceDesc('')
      }
    } catch (error) {
      console.error('Failed to create workspace:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-stone-50">
        <div className="text-stone-500">加载中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold text-stone-900">工作区</h1>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="px-4 py-2 bg-stone-900 text-white rounded-lg hover:bg-stone-800 transition-colors"
          >
            创建工作区
          </button>
        </div>

        {workspaces.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-stone-500 mb-4">还没有工作区</p>
            <button
              onClick={() => setShowCreateDialog(true)}
              className="text-stone-900 hover:underline"
            >
              创建第一个工作区
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                onClick={() => onSelectWorkspace(workspace.id)}
                className="bg-white rounded-lg p-6 border border-stone-200 hover:border-stone-300 cursor-pointer transition-colors"
              >
                <h3 className="font-medium text-stone-900 mb-2">{workspace.name}</h3>
                {workspace.description && (
                  <p className="text-sm text-stone-600 mb-4">{workspace.description}</p>
                )}
                <div className="text-xs text-stone-500">
                  {workspace.conversation_count || 0} 个对话
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-stone-900 mb-4">创建工作区</h2>

            <div className="mb-4">
              <label className="block text-sm font-medium text-stone-700 mb-2">
                名称
              </label>
              <input
                type="text"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="例如：Multi-agent 研究"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-900"
                autoFocus
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-stone-700 mb-2">
                描述（可选）
              </label>
              <textarea
                value={newWorkspaceDesc}
                onChange={(e) => setNewWorkspaceDesc(e.target.value)}
                placeholder="简单描述这个工作区的用途"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-900 resize-none"
                rows={3}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreateDialog(false)
                  setNewWorkspaceName('')
                  setNewWorkspaceDesc('')
                }}
                className="flex-1 px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreateWorkspace}
                disabled={!newWorkspaceName.trim()}
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
