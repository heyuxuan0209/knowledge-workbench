export default function ContentCard({ item, onInterested, onNotInterested }) {
  const getCategoryIcon = (category) => {
    const icons = {
      'industry': '🚀',
      'paper': '📄',
      'tip': '💡',
      'ai-products': '🛠️',
      'ai-models': '🤖'
    }
    return icons[category] || '📰'
  }

  const getCategoryColor = (category) => {
    const colors = {
      'industry': 'bg-blue-50 text-blue-700 border-blue-100',
      'paper': 'bg-purple-50 text-purple-700 border-purple-100',
      'tip': 'bg-green-50 text-green-700 border-green-100',
      'ai-products': 'bg-orange-50 text-orange-700 border-orange-100',
      'ai-models': 'bg-pink-50 text-pink-700 border-pink-100'
    }
    return colors[category] || 'bg-gray-50 text-gray-700 border-gray-100'
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 hover:border-gray-200 hover:shadow-sm transition-all">
      {/* 标题区域 */}
      <div className="mb-5">
        <div className="flex items-start gap-3 mb-3">
          <span className="text-2xl flex-shrink-0">{getCategoryIcon(item.category)}</span>
          <h3 className="text-lg font-semibold text-gray-900 leading-snug flex-1">
            {item.title}
          </h3>
        </div>
        
        <div className="flex items-center gap-3 text-sm text-gray-500 ml-11">
          <span className="font-medium">{item.source}</span>
          <span className="text-gray-300">•</span>
          <span className={`px-2.5 py-0.5 rounded-md text-xs font-medium border ${getCategoryColor(item.category)}`}>
            {item.category}
          </span>
          <span className="text-gray-300">•</span>
          <span className="font-medium">⭐ {item.score}</span>
        </div>
      </div>

      {/* 推荐理由 */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-5 ml-11">
        <p className="text-sm text-blue-800 font-medium">
          📌 为什么推荐给你：匹配您关注的话题
        </p>
      </div>

      {/* 摘要 */}
      <div className="mb-5 ml-11">
        <p className="text-gray-700 leading-relaxed text-[15px]">
          {item.summary}
        </p>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2 pt-5 border-t border-gray-50 ml-11">
        <button
          onClick={() => onInterested(item)}
          className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          👍 感兴趣
        </button>
        <button
          onClick={() => onNotInterested(item)}
          className="px-5 py-2.5 bg-gray-50 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors border border-gray-100"
        >
          👎 不感兴趣
        </button>
        <button
          onClick={() => window.open(item.url, '_blank')}
          className="px-5 py-2.5 bg-gray-50 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors border border-gray-100"
        >
          📖 查看原文
        </button>
        <button className="px-5 py-2.5 bg-gray-50 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors border border-gray-100">
          💾 保存
        </button>
      </div>
    </div>
  )
}
