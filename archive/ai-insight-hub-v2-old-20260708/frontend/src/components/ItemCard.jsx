export function ItemCard({ item, onFeedback }) {
  const [expanded, setExpanded] = React.useState(false);

  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffHours = Math.floor((now - date) / (1000 * 60 * 60));

    if (diffHours < 1) return '刚刚';
    if (diffHours < 24) return `${diffHours} 小时前`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} 天前`;
    return date.toLocaleDateString('zh-CN');
  };

  const getCategoryColor = (category) => {
    const colors = {
      'tip': 'bg-blue-100 text-blue-800',
      'ai-products': 'bg-purple-100 text-purple-800',
      'industry': 'bg-green-100 text-green-800',
      'ai-models': 'bg-yellow-100 text-yellow-800',
      'default': 'bg-gray-100 text-gray-800'
    };
    return colors[category] || colors.default;
  };

  // 生成推荐理由
  const getRecommendReason = () => {
    const reasons = [];
    const titleLower = item.title.toLowerCase();
    const summaryLower = (item.summary || '').toLowerCase();

    if (titleLower.includes('agent') || summaryLower.includes('agent')) {
      reasons.push('智能体');
    }
    if (titleLower.includes('product') || summaryLower.includes('product')) {
      reasons.push('产品');
    }
    if (titleLower.includes('startup') || summaryLower.includes('startup')) {
      reasons.push('创业');
    }
    if (titleLower.includes('cost') || summaryLower.includes('成本')) {
      reasons.push('成本优化');
    }

    if (reasons.length > 0) {
      return `因为你关注：${reasons.join('、')}`;
    }
    return `AI HOT 精选内容`;
  };

  return (
    <div className="border border-gray-200 rounded-lg p-5 hover:shadow-md transition-shadow bg-white mb-4">
      {/* 推荐理由 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-orange-600 font-medium bg-orange-50 px-2 py-1 rounded">
          ⭐ {getRecommendReason()}
        </span>
        <span className="text-xs text-gray-500">
          {formatTime(item.pub_date)}
        </span>
      </div>

      {/* 标题 */}
      <h3 className="text-lg font-bold mb-2 text-gray-900 leading-snug hover:text-blue-600 cursor-pointer"
          onClick={() => setExpanded(!expanded)}>
        {item.title}
      </h3>

      {/* 标签栏 */}
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded">
          {item.source}
        </span>
        <span className={`px-2 py-1 rounded ${getCategoryColor(item.category)}`}>
          {item.category}
        </span>
        <span className="px-2 py-1 bg-orange-50 text-orange-700 rounded flex items-center gap-1">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
          </svg>
          {item.score || 'N/A'}
        </span>
        {item.relevance_score > 0 && (
          <span className="px-2 py-1 bg-green-50 text-green-700 rounded">
            相关度 {item.relevance_score}
          </span>
        )}
      </div>

      {/* 摘要 */}
      <div className={`text-gray-700 text-sm leading-relaxed mb-4 ${expanded ? '' : 'line-clamp-3'}`}>
        {item.summary || '暂无摘要'}
      </div>

      {/* 展开/收起按钮 */}
      {item.summary && item.summary.length > 150 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-blue-600 text-sm mb-3 hover:underline"
        >
          {expanded ? '收起 ↑' : '展开查看完整内容 ↓'}
        </button>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-2 flex-wrap pt-3 border-t border-gray-100">
        <button
          onClick={() => onFeedback(item.id, 'approve')}
          className="px-3 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition-colors flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z"/>
          </svg>
          有用
        </button>

        <button
          onClick={() => onFeedback(item.id, 'save')}
          className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V6h5a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h5v5.586l-1.293-1.293zM9 4a1 1 0 012 0v2H9V4z"/>
          </svg>
          保存到 Obsidian
        </button>

        <button
          onClick={() => onFeedback(item.id, 'skip')}
          className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
        >
          ⏭️ 跳过
        </button>

        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
          </svg>
          查看原文
        </a>
      </div>
    </div>
  );
}
