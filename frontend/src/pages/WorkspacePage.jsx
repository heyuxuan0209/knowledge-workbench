import { useState, useEffect } from 'react'
import axios from 'axios'
import Sidebar from '../components/workspace/Sidebar'
import MainContent from '../components/workspace/MainContent'

export default function WorkspacePage() {
  const [currentView, setCurrentView] = useState('inbox')
  const [items, setItems] = useState([])
  const [selectedItem, setSelectedItem] = useState(null)
  const [workspaces, setWorkspaces] = useState([])

  useEffect(() => {
    fetchItems()
    loadMockWorkspaces()
  }, [])

  const fetchItems = async () => {
    try {
      const response = await axios.get('/api/items?limit=50')
      setItems(response.data.data || [])
    } catch (error) {
      console.error('Failed to fetch items:', error)
    }
  }

  const loadMockWorkspaces = () => {
    setWorkspaces([
      { id: 1, name: 'Multi-agent研究' },
      { id: 2, name: '产品设计参考' }
    ])
  }

  return (
    <div className="h-screen bg-stone-50 flex">
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
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
