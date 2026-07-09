// Hacker News Style - 极简列表风格
export default function ContentCard({ item, onInterested, onNotInterested, index }) {
  const formatTime = (dateStr) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = Math.floor((now - date) / 1000 / 60 / 60)
    if (diff < 1) return '刚刚'
    if (diff < 24) return `${diff}h`
    return `${Math.floor(diff / 24)}d`
  }

  return (
    <div className="py-2 px-2 hover:bg-orange-50 transition-colors">
      {/* 单行标题和评分 */}
      <div className="flex items-start gap-2">
        <span className="text-gray-400 text-sm font-mono w-6 text-right flex-shrink-0">
          {index}.
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-900 hover:text-orange-600 font-medium text-sm leading-snug"
            >
              {item.title}
            </a>
            <span className="text-orange-600 font-medium text-xs flex-shrink-0">
              ({item.score})
            </span>
          </div>

          {/* 元信息 */}
          <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
            <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-medium">
              {item.category}
            </span>
            <span>|</span>
            <span>{item.source}</span>
            <span>|</span>
            <span>{formatTime(item.publishedAt)}</span>
          </div>

          {/* 摘要（可折叠）*/}
          <p className="text-xs text-gray-600 leading-relaxed mb-2">
            {item.summary.slice(0, 150)}...
          </p>

          {/* 操作链接 */}
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <button
              onClick={() => onInterested(item)}
              className="hover:text-orange-600 hover:underline"
            >
              👍 感兴趣
            </button>
            <button
              onClick={() => onNotInterested(item)}
              className="hover:text-gray-700 hover:underline"
            >
              隐藏
            </button>
            <button className="hover:text-gray-700 hover:underline">
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
