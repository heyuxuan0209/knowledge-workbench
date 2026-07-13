import { useState, useEffect } from 'react'
import axios from 'axios'

export default function Sidebar({
  currentView,
  onViewChange,
  workspaces,
  onSelectConversation,
  selectedConversation
}) {
  const [expandedWorkspace, setExpandedWorkspace] = useState(null)
  const [conversations, setConversations] = useState([])

  useEffect(() => {
    if (expandedWorkspace) {
      fetchConversations(expandedWorkspace)
    }
  }, [expandedWorkspace])

  const fetchConversations = async (workspaceId) => {
    try {
      const response = await axios.get(`/api/workspaces/${workspaceId}`)
      setConversations(response.data.data.conversations || [])
    } catch (error) {
      console.error('Failed to fetch conversations:', error)
    }
  }

  const handleWorkspaceClick = (workspaceId) => {
    if (expandedWorkspace === workspaceId) {
      setExpandedWorkspace(null)
      setConversations([])
    } else {
      setExpandedWorkspace(workspaceId)
    }
  }

  return (
    <div className="w-64 border-r border-stone-200 bg-white flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-stone-200">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-blue-500 rounded flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-stone-900">AI Insight Hub</span>
        </div>
      </div>

      {/* Main Navigation */}
      <div className="p-2 border-b border-stone-200">
        <NavItem
          active={currentView === 'inbox'}
          onClick={() => onViewChange('inbox')}
          icon={<InboxIcon />}
          label="精选"
          count={18}
        />
        <NavItem
          active={currentView === 'topics'}
          onClick={() => onViewChange('topics')}
          icon={<TopicsIcon />}
          label="主题"
          count={3}
        />
        <NavItem
          active={currentView === 'workspace'}
          onClick={() => onViewChange('workspace')}
          icon={<WorkspaceIcon />}
          label="工作区"
        />
        <NavItem
          active={currentView === 'graph'}
          onClick={() => onViewChange('graph')}
          icon={<GraphIcon />}
          label="知识图谱"
        />
      </div>

      {/* Workspaces with Conversations */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="text-xs font-medium text-stone-500 px-3 py-2">工作区对话</div>
        {workspaces.map(workspace => (
          <div key={workspace.id} className="mb-1">
            <button
              onClick={() => handleWorkspaceClick(workspace.id)}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 rounded"
            >
              <span className="truncate">{workspace.name}</span>
              <svg
                className={`w-4 h-4 transition-transform ${expandedWorkspace === workspace.id ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {expandedWorkspace === workspace.id && (
              <div className="ml-3 mt-1 space-y-1">
                {conversations.map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => onSelectConversation(conv.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors ${
                      selectedConversation === conv.id
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    <div className="truncate">{conv.title}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Resources */}
      <div className="p-2 border-t border-stone-200">
        <div className="text-xs font-medium text-stone-500 px-3 py-2">资源</div>
        <button className="w-full text-left px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50 rounded">
          已保存
        </button>
        <button className="w-full text-left px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50 rounded">
          GitHub
        </button>
      </div>
    </div>
  )
}

function NavItem({ active, onClick, icon, label, count }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg mb-1 text-sm transition-colors ${
        active
          ? 'bg-blue-50 text-blue-700'
          : 'text-stone-700 hover:bg-stone-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={active ? 'text-blue-600' : 'text-stone-500'}>{icon}</span>
        <span className="font-medium">{label}</span>
      </div>
      {count && (
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          active ? 'bg-blue-100 text-blue-700' : 'bg-stone-100 text-stone-600'
        }`}>
          {count}
        </span>
      )}
    </button>
  )
}

function InboxIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  )
}

function TopicsIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
    </svg>
  )
}

function WorkspaceIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  )
}

function GraphIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )
}
