import { useState } from 'react'

const STYLES = [
  {
    id: 'modern',
    name: 'Modern Minimal',
    description: '简约现代，大留白，专注内容本身',
    features: ['纯白背景', '极细边框', '大字号标题', '充足留白'],
    recommended: true
  },
  {
    id: 'notion',
    name: 'Notion Style',
    description: '仿 Notion 风格，灰色背景，卡片式设计',
    features: ['浅灰背景', '圆角卡片', '柔和阴影', 'emoji 图标']
  },
  {
    id: 'hackernews',
    name: 'Hacker News',
    description: '极简列表式，信息密度最高',
    features: ['纯文本风格', '橙色强调', '单行显示', '评论数统计']
  }
]

export default function StyleSelectorPage({ onSelect }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-8">
      <div className="max-w-5xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            选择你喜欢的界面风格
          </h1>
          <p className="text-gray-600 text-lg">
            我们提供 3 种设计风格，选择最适合你的阅读习惯
          </p>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {STYLES.map((style) => (
            <div
              key={style.id}
              onClick={() => onSelect(style.id)}
              className="bg-white rounded-2xl p-6 cursor-pointer hover:shadow-2xl hover:scale-105 transition-all border-2 border-transparent hover:border-blue-500"
            >
              {style.recommended && (
                <div className="inline-block px-3 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full mb-4">
                  推荐
                </div>
              )}
              
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                {style.name}
              </h3>
              
              <p className="text-gray-600 text-sm mb-4">
                {style.description}
              </p>

              <div className="space-y-2">
                {style.features.map((feature, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                    <span className="text-blue-500">✓</span>
                    <span>{feature}</span>
                  </div>
                ))}
              </div>

              <button className="w-full mt-6 py-3 bg-gray-100 hover:bg-blue-600 hover:text-white text-gray-700 font-semibold rounded-lg transition-all">
                选择此风格
              </button>
            </div>
          ))}
        </div>

        <div className="text-center mt-8">
          <button
            onClick={() => onSelect('modern')}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            暂时跳过，使用默认风格
          </button>
        </div>
      </div>
    </div>
  )
}
