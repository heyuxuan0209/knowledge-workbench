import { useState } from 'react'

export default function ArticleDetail({ item, onBack }) {
  const [showOriginal, setShowOriginal] = useState(false)

  const formatTime = (dateStr) => {
    const date = new Date(dateStr)
    return date.toLocaleString('zh-CN', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getCategoryLabel = (category) => {
    const labels = {
      'industry': '行业动态',
      'paper': '论文',
      'tip': '技巧',
      'ai-models': 'AI 模型',
      'ai-products': 'AI 产品',
      'github': 'GitHub'
    }
    return labels[category] || category
  }

  // Mock tags - in production these would come from API
  const extractedTags = [
    '机器人', 'VLA', '多模态', '开源', 'Qwen2'
  ]

  // Mock recommendation reason - in production from API
  const recommendationReason = "这是一个重要的开源项目发布，涵盖视觉-语言-动作多模态技术，在机器人领域有突破性进展。"

  return (
    <div className="flex-1 bg-white overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-8">
        {/* Back Button */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-stone-600 hover:text-stone-900 mb-6 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          返回列表
        </button>

        {/* Source & Meta */}
        <div className="flex items-center gap-3 text-sm mb-4">
          <span className="font-medium text-stone-700">{item.source}</span>
          <span className="text-stone-400">·</span>
          <span className="text-stone-500">{formatTime(item.publishedAt)}</span>
          {item.selected && (
            <>
              <span className="text-stone-400">·</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-medium text-xs">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                精选 {item.score}
              </span>
            </>
          )}
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold text-stone-900 mb-6 leading-tight">
          {item.title}
        </h1>

        {/* Recommendation Reason - for selected items */}
        {item.selected && (
          <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-6">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <div>
                <div className="text-sm font-semibold text-orange-900 mb-1">推荐理由</div>
                <p className="text-sm text-orange-800 leading-relaxed">
                  {recommendationReason}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* AI Summary */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-900 mb-3">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            AI 摘要
          </div>
          <p className="text-sm text-blue-900 leading-relaxed">
            {item.summary}
          </p>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-6">
          <span className="px-3 py-1 bg-stone-100 text-stone-700 text-sm rounded-lg font-medium">
            {getCategoryLabel(item.category)}
          </span>
          {extractedTags.map((tag, idx) => (
            <span key={idx} className="px-3 py-1 bg-stone-50 border border-stone-200 text-stone-600 text-sm rounded-lg hover:bg-stone-100 cursor-pointer transition-colors">
              {tag}
            </span>
          ))}
        </div>

        {/* Language Toggle - only for foreign content */}
        {item.title_en && item.title_en !== item.title && (
          <div className="flex items-center gap-2 mb-6 p-3 bg-stone-50 rounded-lg">
            <span className="text-sm text-stone-600">正文语言：</span>
            <button
              onClick={() => setShowOriginal(false)}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                !showOriginal
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-stone-600 hover:bg-stone-100'
              }`}
            >
              中文译文
            </button>
            <button
              onClick={() => setShowOriginal(true)}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                showOriginal
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-stone-600 hover:bg-stone-100'
              }`}
            >
              English 原文
            </button>
          </div>
        )}

        {/* Main Content */}
        <div className="prose prose-stone max-w-none mb-8">
          <div className="text-base text-stone-700 leading-relaxed space-y-4">
            {showOriginal && item.title_en ? (
              <div>
                <p className="font-medium text-stone-500 text-sm mb-3">English Version:</p>
                <p>{item.summary}</p>
              </div>
            ) : (
              <div>
                {item.summary.split('\n').map((para, idx) => (
                  <p key={idx}>{para}</p>
                ))}
              </div>
            )}
            
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 text-sm text-stone-600 mt-6">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-stone-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <div className="font-medium text-stone-700 mb-1">获取完整内容</div>
                  <div className="text-xs">完整的富文本正文（含图片、代码块、表格）需要接入 AI HOT 详情页 API</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 pt-6 border-t border-stone-200">
          <button
            onClick={() => window.open(item.url, '_blank')}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            在 X 看原推 →
          </button>
          <button
            onClick={() => window.open(item.permalink, '_blank')}
            className="px-5 py-2.5 bg-stone-100 text-stone-700 text-sm font-medium rounded-lg hover:bg-stone-200 transition-colors"
          >
            在 AI HOT 查看
          </button>
          <button className="px-5 py-2.5 bg-stone-100 text-stone-700 text-sm font-medium rounded-lg hover:bg-stone-200 transition-colors">
            保存
          </button>
          <button className="px-5 py-2.5 bg-stone-100 text-stone-700 text-sm font-medium rounded-lg hover:bg-stone-200 transition-colors">
            加入工作区
          </button>
          <button className="px-5 py-2.5 bg-stone-100 text-stone-700 text-sm font-medium rounded-lg hover:bg-stone-200 transition-colors">
            导出 Markdown
          </button>
        </div>
      </div>
    </div>
  )
}
