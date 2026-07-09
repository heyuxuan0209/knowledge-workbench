import { useState, useEffect } from 'react'
import axios from 'axios'
import Sidebar from '../components/workspace/Sidebar'
import MainContent from '../components/workspace/MainContent'

export default function WorkspacePage({ onNavigateToWorkspaces }) {
  const [currentView, setCurrentView] = useState('inbox')
  const [items, setItems] = useState([])
  const [selectedItem, setSelectedItem] = useState(null)
  const [workspaces, setWorkspaces] = useState([])

  useEffect(() => {
    fetchItems()
    fetchWorkspaces()
  }, [])

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
      />

      <MainContent
        currentView={currentView}
        items={items}
        selectedItem={selectedItem}
        onItemSelect={setSelectedItem}
      />
    </div>
  )
}
