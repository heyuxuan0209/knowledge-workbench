import { useState, useEffect } from 'react'
import axios from 'axios'

export default function CostTracker() {
  const [stats, setStats] = useState({
    today: { tokens: 0, cost: 0 },
    month: { tokens: 0, cost: 0, limit: 100 }
  })

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const response = await axios.get('/api/stats/cost')
      setStats(response.data.data || stats)
    } catch (error) {
      console.error('Failed to fetch cost stats:', error)
    }
  }

  const percentage = (stats.month.cost / stats.month.limit) * 100
  const isWarning = percentage >= 80

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-4">
      <h3 className="text-sm font-medium text-stone-900 mb-3">成本统计</h3>

      {/* 今日 */}
      <div className="mb-4">
        <div className="text-xs text-stone-500 mb-1">今日</div>
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-stone-900">
            ¥{stats.today.cost.toFixed(2)}
          </span>
          <span className="text-xs text-stone-500">
            {stats.today.tokens.toLocaleString()} tokens
          </span>
        </div>
      </div>

      {/* 本月 */}
      <div>
        <div className="flex items-center justify-between text-xs text-stone-500 mb-1">
          <span>本月</span>
          <span>
            ¥{stats.month.cost.toFixed(2)} / ¥{stats.month.limit}
          </span>
        </div>
        <div className="w-full bg-stone-100 rounded-full h-2 mb-2">
          <div
            className={`h-2 rounded-full transition-all ${
              isWarning ? 'bg-orange-500' : 'bg-blue-500'
            }`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
        {isWarning && (
          <div className="text-xs text-orange-600">
            ⚠️ 已使用 {percentage.toFixed(0)}%，接近预算上限
          </div>
        )}
      </div>
    </div>
  )
}
