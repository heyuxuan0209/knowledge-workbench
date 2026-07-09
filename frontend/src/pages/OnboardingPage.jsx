import { useState } from 'react'

const INTEREST_OPTIONS = [
  'Agent / 多智能体',
  '开源模型',
  'AI 产品 / 应用',
  '提示词工程',
  '成本优化 / API定价',
  'AI 编码工具',
  'RAG / 知识库',
  '多模态（图像/视频/音频）',
  'Fine-tuning / 模型训练',
  'AI 安全 / 对齐',
  '向量数据库',
  'LLM 推理加速',
  'AI 创业 / 商业模式',
  '行业动态 / 政策'
]

export default function OnboardingPage({ onComplete, onSkip }) {
  const [selectedInterests, setSelectedInterests] = useState([])
  const [customKeywords, setCustomKeywords] = useState('')

  const toggleInterest = (interest) => {
    setSelectedInterests(prev => 
      prev.includes(interest) 
        ? prev.filter(i => i !== interest)
        : [...prev, interest]
    )
  }

  const handleNext = () => {
    const interests = [...selectedInterests]
    if (customKeywords.trim()) {
      interests.push(...customKeywords.split(',').map(k => k.trim()).filter(Boolean))
    }
    onComplete(interests)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full">
        {/* 欢迎卡片 */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                🎯 欢迎使用 AI Insight Hub
              </h1>
              <p className="text-gray-600">
                我们从 AI HOT 每天获取 100+ 条 AI 资讯<br/>
                先告诉我你关注哪些方向，我帮你筛选出最相关的 15-20 条
              </p>
            </div>
            <button
              onClick={onSkip}
              className="text-gray-500 hover:text-gray-700 text-sm"
            >
              跳过引导
            </button>
          </div>
        </div>

        {/* 兴趣选择卡片 */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">
            选择你感兴趣的领域（多选，至少3个）：
          </h2>

          <div className="grid grid-cols-2 gap-4 mb-6">
            {INTEREST_OPTIONS.map((interest) => (
              <button
                key={interest}
                onClick={() => toggleInterest(interest)}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  selectedInterests.includes(interest)
                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                <span className="mr-2">
                  {selectedInterests.includes(interest) ? '☑' : '☐'}
                </span>
                {interest}
              </button>
            ))}
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              或者直接输入关键词：
            </label>
            <input
              type="text"
              value={customKeywords}
              onChange={(e) => setCustomKeywords(e.target.value)}
              placeholder="例如：workflow, langchain, claude code..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <button
            onClick={handleNext}
            disabled={selectedInterests.length < 3 && !customKeywords.trim()}
            className={`w-full py-4 rounded-lg font-semibold text-white transition-all ${
              selectedInterests.length >= 3 || customKeywords.trim()
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            下一步：看看今天有什么 →
          </button>

          {selectedInterests.length < 3 && !customKeywords.trim() && (
            <p className="text-sm text-red-500 mt-2 text-center">
              请至少选择 3 个感兴趣的领域
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
