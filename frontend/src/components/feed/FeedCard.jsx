// Feed 卡片：忠实复用原型 feed-v1.js renderCard 的结构与 class（样式来自 styles/feed.css）。
// 字段映射沿用原型约定：API 的 source_display_name/source_platform/source_handle
// （SQL JOIN 出的列名）在 FeedPage 里已映射为 display_name/platform/handle。

const CONTENT_TYPE_LABEL = {
  article: 'Article', video: 'Video', tweet: 'X (Twitter)',
  paper: 'Paper', repo: 'GitHub', text: 'Text'
}

function timeAgo(isoString) {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return '刚刚'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function FeedCard({ item, selected, onToggleSelect, onFollowSource }) {
  const hasAuthor = Boolean(item.display_name)

  return (
    <div
      className={`feed-card${selected ? ' selected' : ''}`}
      onClick={(e) => {
        // 点操作按钮/原文链接不触发选中（与原型 bindCardEvents 一致）
        if (e.target.closest('.btn-topic, .btn-follow, .card-link')) return
        onToggleSelect(item.id)
      }}
    >
      <div className="card-header">
        {hasAuthor ? (
          <div className="card-author">
            {item.source_registered
              ? <span className="authority-tag high">已关注</span>
              : <span className="authority-tag unrated">未标注可信度</span>}
            <span className="author-name">{item.display_name}</span>
            <span className="author-handle">{item.platform} · @{item.handle}</span>
          </div>
        ) : (
          <div className="card-author">
            <span className="no-author">来源：媒体转载，未识别到具体作者</span>
          </div>
        )}
        <span className="card-score">评分 {item.external_score}</span>
      </div>

      <h3 className="card-title">{item.zh_title || item.en_title || '（无标题）'}</h3>
      {item.zh_summary && <div className="card-summary">{item.zh_summary}</div>}

      <div className="card-meta">
        <span className="type-badge">{CONTENT_TYPE_LABEL[item.content_type] || item.content_type}</span>
        <span>·</span>
        <span>{timeAgo(item.published_at)}</span>
      </div>

      <div className="card-actions">
        <button className={`btn-select${selected ? ' active' : ''}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
          <span>选中分析</span>
        </button>
        {!item.source_registered && (
          <button className="btn-topic btn-follow" onClick={() => onFollowSource?.(item.id)}>
            ＋ 加为信息源
          </button>
        )}
        {item.url && (
          <a className="btn-topic card-link" href={item.url} target="_blank" rel="noreferrer">跳转原文</a>
        )}
      </div>
    </div>
  )
}
