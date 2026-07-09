// Notion Style - Notion 风格
export default function ContentCard({ item, onInterested, onNotInterested }) {
  const getCategoryEmoji = (category) => {
    const map = {
      'industry': '🚀', 'paper': '📄', 'tip': '💡',
      'ai-products': '🛠️', 'ai-models': '🤖'
    }
    return map[category] || '📰'
  }

  const formatTime = (dateStr) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = Math.floor((now - date) / 1000 / 60 / 60)
    if (diff < 1) return '刚刚'
    if (diff < 24) return `${diff}小时前`
    return `${Math.floor(diff / 24)}天前`
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md hover:border-gray-300 transition-all">
      {/* 标题带 emoji */}
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl flex-shrink-0">{getCategoryEmoji(item.category)}</span>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-gray-900 mb-2 leading-snug">
            {item.title}
          </h3>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="px-2 py-0.5 bg-gray-100 rounded">{item.category}</span>
            <span>⭐ {item.score}</span>
            <span>·</span>
            <span>{item.source}</span>
            <span>·</span>
            <span>{formatTime(item.publishedAt)}</span>
          </div>
        </div>
      </div>

      {/* 推荐理由 */}
      <div className="bg-blue-50 border-l-3 border-blue-400 px-3 py-2 mb-3 text-sm text-blue-800">
        💡 推荐理由：匹配您关注的话题
      </div>

      {/* 摘要 */}
      <p className="text-sm text-gray-700 leading-relaxed mb-4">
        {item.summary}
      </p>

      {/* 按钮组 */}
      <div className="flex gap-2">
        <button
          onClick={() => onInterested(item)}
          className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          👍 感兴趣
        </button>
        <button
          onClick={() => window.open(item.url, '_blank')}
          className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded hover:bg-gray-200 transition-colors"
        >
          📖 原文
        </button>
        <button className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded hover:bg-gray-200 transition-colors">
          💾
        </button>
        <button
          onClick={() => onNotInterested(item)}
          className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded hover:bg-gray-200 transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
