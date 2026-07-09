import { useState, useEffect } from 'react'
import axios from 'axios'
import ContentCard_Modern from '../components/ContentCard_Modern'
import ContentCard_Notion from '../components/ContentCard_Notion'
import ContentCard_HN from '../components/ContentCard_HN'
import NewUserTip from '../components/NewUserTip'
import TopicCreatedModal from '../components/TopicCreatedModal'

export default function HomePage({ userInterests, uiStyle = 'modern' }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showTip, setShowTip] = useState(true)
  const [totalCount, setTotalCount] = useState(0)
  const [showTopicModal, setShowTopicModal] = useState(false)
  const [createdTopic, setCreatedTopic] = useState(null)
  const [currentStyle, setCurrentStyle] = useState(uiStyle)
  const [showStyleMenu, setShowStyleMenu] = useState(false)

  // 选择对应的卡片组件
  const ContentCard = {
    'modern': ContentCard_Modern,
    'notion': ContentCard_Notion,
    'hackernews': ContentCard_HN
  }[currentStyle] || ContentCard_Modern

  useEffect(() => {
    fetchItems()
    const tipDismissed = localStorage.getItem('tip_dismissed')
    if (tipDismissed === 'true') {
      setShowTip(false)
    }
  }, [])

  const fetchItems = async () => {
    try {
      const response = await axios.get('/api/items?limit=20')
      setItems(response.data.data || [])
      setTotalCount(100)
    } catch (error) {
      console.error('Failed to fetch items:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleInterested = (item) => {
    setCreatedTopic({
      name: 'Multi-agent 架构与编排',
      relatedItems: [
        { title: item.title, similarity: '100%' },
        { title: 'Building multi-agent systems', similarity: '89%' },
        { title: 'Agent orchestration patterns', similarity: '85%' }
      ]
    })
    setShowTopicModal(true)
  }

  const handleNotInterested = (item) => {
    setItems(prev => prev.filter(i => i.id !== item.id))
  }

  const dismissTip = () => {
    setShowTip(false)
    localStorage.setItem('tip_dismissed', 'true')
  }

  const switchStyle = (newStyle) => {
    setCurrentStyle(newStyle)
    localStorage.setItem('ui_style', newStyle)
    setShowStyleMenu(false)
  }

  // 根据风格返回不同的容器样式
  const getContainerClass = () => {
    switch(currentStyle) {
      case 'modern':
        return 'min-h-screen bg-white'
      case 'notion':
        return 'min-h-screen' 
      case 'hackernews':
        return 'min-h-screen bg-white'
      default:
        return 'min-h-screen bg-gray-50'
    }
  }

  const getHeaderClass = () => {
    switch(currentStyle) {
      case 'modern':
        return 'bg-white border-b border-gray-100'
      case 'notion':
        return 'bg-white border-b border-gray-200'
      case 'hackernews':
        return 'bg-orange-50 border-b border-orange-200'
      default:
        return 'bg-white border-b border-gray-100'
    }
  }

  const styleNames = {
    'modern': 'Modern Minimal',
    'notion': 'Notion Style',
    'hackernews': 'Hacker News'
  }

  return (
    <div className={getContainerClass()} style={currentStyle === 'notion' ? { backgroundColor: '#f7f6f3' } : {}}>
      {/* Header */}
      <header className={`${getHeaderClass()} sticky top-0 z-10`}>
        <div className="max-w-4xl mx-auto px-6 py-5">
          <div className="flex justify-between items-center">
            <div>
              <h1 className={`text-2xl font-semibold ${currentStyle === 'hackernews' ? 'text-orange-600' : 'text-gray-900'}`}>
                {currentStyle === 'hackernews' ? 'AI Insight Hub' : '🎯 AI Insight Hub'}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                今日精选: <span className="font-medium text-gray-900">{items.length}条</span>
                {userInterests && userInterests.length > 0 && (
                  <span className="ml-3 text-blue-600">
                    {userInterests.slice(0, 2).join(', ')}
                  </span>
                )}
              </p>
            </div>
            <div className="relative">
              <button 
                onClick={() => setShowStyleMenu(!showStyleMenu)}
                className="text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-2"
              >
                <span className="text-xs text-gray-500">{styleNames[currentStyle]}</span>
                🎨
              </button>
              
              {showStyleMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-20">
                  <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase">切换风格</div>
                  <button
                    onClick={() => switchStyle('modern')}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${currentStyle === 'modern' ? 'text-blue-600 bg-blue-50' : 'text-gray-700'}`}
                  >
                    Modern Minimal
                    {currentStyle === 'modern' && <span className="ml-2">✓</span>}
                  </button>
                  <button
                    onClick={() => switchStyle('notion')}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${currentStyle === 'notion' ? 'text-blue-600 bg-blue-50' : 'text-gray-700'}`}
                  >
                    Notion Style
                    {currentStyle === 'notion' && <span className="ml-2">✓</span>}
                  </button>
                  <button
                    onClick={() => switchStyle('hackernews')}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${currentStyle === 'hackernews' ? 'text-blue-600 bg-blue-50' : 'text-gray-700'}`}
                  >
                    Hacker News
                    {currentStyle === 'hackernews' && <span className="ml-2">✓</span>}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {showTip && currentStyle !== 'hackernews' && <NewUserTip onDismiss={dismissTip} />}

        {loading ? (
          <div className="text-center py-20">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="text-gray-500 mt-4">加载中...</p>
          </div>
        ) : (
          <div className={currentStyle === 'hackernews' ? 'space-y-0' : 'space-y-6'}>
            {items.map((item, index) => (
              <ContentCard
                key={item.id}
                item={item}
                index={index + 1}
                onInterested={handleInterested}
                onNotInterested={handleNotInterested}
              />
            ))}
          </div>
        )}
      </main>

      {showTopicModal && createdTopic && (
        <TopicCreatedModal
          topic={createdTopic}
          onClose={() => setShowTopicModal(false)}
        />
      )}
    </div>
  )
}
