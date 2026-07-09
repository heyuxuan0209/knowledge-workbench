import { useState } from 'react'
import ArticleDetail from './ArticleDetail'
import SearchBar from './SearchBar'

export default function MainContent({ 
  currentView, 
  items, 
  selectedItem,
  onItemSelect
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filteredItems, setFilteredItems] = useState(items)

  const formatTime = (dateStr) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = Math.floor((now - date) / 1000 / 60 / 60)
    if (diff < 1) return '刚刚'
    if (diff < 24) return `${diff}小时前`
    const days = Math.floor(diff / 24)
    return `${days}天前`
  }

  const getCategoryLabel = (category) => {
    const labels = {
      'industry': '行业',
      'paper': '论文',
      'tip': '技巧',
      'ai-models': 'AI模型',
      'ai-products': 'AI产品',
      'github': 'GitHub'
    }
    return labels[category] || category
  }

  const handleSearch = (query) => {
    setSearchQuery(query)
    if (!query.trim()) {
      setFilteredItems(items)
      return
    }
    
    const lowerQuery = query.toLowerCase()
    const filtered = items.filter(item => 
      item.title.toLowerCase().includes(lowerQuery) ||
      item.summary.toLowerCase().includes(lowerQuery) ||
      item.source.toLowerCase().includes(lowerQuery)
    )
    setFilteredItems(filtered)
  }

  // Update filtered items when items prop changes
  if (filteredItems.length === 0 && items.length > 0 && !searchQuery) {
    setFilteredItems(items)
  }

  // 文章详情视图
  if (selectedItem) {
    return <ArticleDetail item={selectedItem} onBack={() => onItemSelect(null)} />
  }

  const displayItems = searchQuery ? filteredItems : items

  // 列表视图
  return (
    <div className="flex-1 bg-stone-50 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Header with Search */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-stone-900">今日精选</h2>
            <div className="flex gap-2">
              <select className="px-3 py-1.5 bg-white border border-stone-300 rounded-lg text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option>全部分类</option>
                <option>行业动态</option>
                <option>AI 模型</option>
                <option>论文</option>
                <option>GitHub</option>
              </select>
              <select className="px-3 py-1.5 bg-white border border-stone-300 rounded-lg text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option>按时间</option>
                <option>按评分</option>
              </select>
            </div>
          </div>
          
          <SearchBar onSearch={handleSearch} />
          
          {searchQuery && (
            <div className="mt-3 text-sm text-stone-600">
              找到 {displayItems.length} 条结果
            </div>
          )}
        </div>

        {/* Content Cards */}
        <div className="space-y-4">
          {displayItems.slice(0, 20).map(item => (
            <div
              key={item.id}
              onClick={() => onItemSelect(item)}
              className="bg-white border border-stone-200 rounded-xl p-5 hover:border-stone-300 hover:shadow-md cursor-pointer transition-all group"
            >
              <div className="flex gap-4">
                <div className="flex-1 min-w-0">
                  {/* Title */}
                  <h3 className="text-base font-semibold text-stone-900 mb-2 leading-snug group-hover:text-blue-600 transition-colors">
                    {item.title}
                  </h3>
                  
                  {/* Summary */}
                  <p className="text-sm text-stone-600 leading-relaxed line-clamp-2 mb-3">
                    {item.summary}
                  </p>
                  
                  {/* Meta */}
                  <div className="flex items-center flex-wrap gap-2 text-xs">
                    <span className="font-medium text-stone-700">{item.source}</span>
                    <span className="text-stone-400">·</span>
                    <span className="text-stone-500">{formatTime(item.publishedAt)}</span>
                    <span className="text-stone-400">·</span>
                    <span className="px-2 py-0.5 bg-stone-100 text-stone-700 rounded-md">
                      {getCategoryLabel(item.category)}
                    </span>
                    {item.selected && (
                      <>
                        <span className="text-stone-400">·</span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 rounded-md font-medium">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                          精选
                        </span>
                      </>
                    )}
                  </div>
                </div>
                
                {/* Score Badge */}
                <div className="flex-shrink-0">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">{item.score}</div>
                      <div className="text-xs text-blue-500">分</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
