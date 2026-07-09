// Modern Minimal - 简约现代风格
export default function ContentCard({ item, onInterested, onNotInterested }) {
  const formatTime = (dateStr) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = Math.floor((now - date) / 1000 / 60 / 60)
    if (diff < 1) return '刚刚'
    if (diff < 24) return `${diff}小时前`
    return `${Math.floor(diff / 24)}天前`
  }

  return (
    <article className="group border-b border-gray-100 py-8 px-0 hover:bg-gray-50/50 transition-all -mx-6 px-6">
      {/* 元信息 */}
      <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
        <span className="font-medium text-gray-900">{item.source}</span>
        <span>•</span>
        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded font-medium">
          {item.category}
        </span>
        <span>•</span>
        <span>⭐ {item.score}</span>
        <span>•</span>
        <span>{formatTime(item.publishedAt)}</span>
      </div>

      {/* 标题 */}
      <h3 className="text-xl font-semibold text-gray-900 mb-3 leading-tight group-hover:text-blue-600 transition-colors">
        {item.title}
      </h3>

      {/* 摘要 */}
      <p className="text-gray-600 leading-relaxed mb-4 text-[15px]">
        {item.summary}
      </p>

      {/* 操作栏 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onInterested(item)}
          className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
        >
          感兴趣
        </button>
        <button
          onClick={() => onNotInterested(item)}
          className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
        >
          不感兴趣
        </button>
        <button
          onClick={() => window.open(item.url, '_blank')}
          className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
        >
          查看原文 ↗
        </button>
        <div className="flex-1" />
        <button className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors">
          保存
        </button>
      </div>
    </article>
  )
}
