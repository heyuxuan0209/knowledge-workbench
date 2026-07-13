import { useState, useEffect } from 'react'
import axios from 'axios'
import Sidebar from '../components/workspace/Sidebar'
import MainContent from '../components/workspace/MainContent'
import MaterialsPanel from '../components/workspace/MaterialsPanel'

export default function WorkspacePage({ onNavigateToWorkspaces }) {
  const [currentView, setCurrentView] = useState('inbox')
  const [items, setItems] = useState([])
  const [selectedItem, setSelectedItem] = useState(null)
  const [workspaces, setWorkspaces] = useState([])
  const [selectedConversation, setSelectedConversation] = useState(null)
  const [conversationData, setConversationData] = useState(null)

  useEffect(() => {
    fetchItems()
    fetchWorkspaces()
  }, [])

  useEffect(() => {
    if (selectedConversation) {
      fetchConversation()
    }
  }, [selectedConversation])

  const fetchItems = async () => {
    try {
      const response = await axios.get('/api/items?limit=50')
      setItems(response.data.data || [])
    } catch (error) {
      console.error('Failed to fetch items:', error)
    }
  }

  const fetchWorkspaces = async () => {
    try {
      const response = await axios.get('/api/workspaces')
      setWorkspaces(response.data.data || [])
    } catch (error) {
      console.error('Failed to fetch workspaces:', error)
    }
  }

  const fetchConversation = async () => {
    try {
      const response = await axios.get(`/api/conversations/${selectedConversation}`)
      setConversationData(response.data.data)
    } catch (error) {
      console.error('Failed to fetch conversation:', error)
    }
  }

  const handleViewChange = (view) => {
    if (view === 'workspace') {
      onNavigateToWorkspaces()
    } else {
      setCurrentView(view)
    }
  }

  return (
    <div className="h-screen bg-stone-50 flex">
      <Sidebar
        currentView={currentView}
        onViewChange={handleViewChange}
        workspaces={workspaces}
        onSelectConversation={setSelectedConversation}
        selectedConversation={selectedConversation}
      />

      <MainContent
        currentView={currentView}
        items={items}
        selectedItem={selectedItem}
        onItemSelect={setSelectedItem}
      />

      {selectedConversation && conversationData && (
        <MaterialsPanel
          conversationId={selectedConversation}
          materials={conversationData.materials || []}
          onRefresh={fetchConversation}
        />
      )}
    </div>
  )
}
