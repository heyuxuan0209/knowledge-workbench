import { useEffect, useState } from 'react'
import { api } from './util'

const ROWS = [
  { label: '内容理解模型', value: 'DeepSeek + Qwen（按任务分级）' },
  { label: '日报生成时间', value: '每天 8:10 同步后生成' },
  { label: '信源同步频率', value: '每天 8:10 + 漏跑补偿' },
]

const PURPOSE_LABELS = {
  'translation': '翻译', 'translation-retry': '翻译重试',
  'feed-relevance': '资讯相关性筛选', 'feed-summary': '资讯摘要', 'feed-summary-retry': '资讯摘要重试',
  'daily-brief': '日报', 'story-split-review': '事件拆分复核',
  'ephemeral-analysis': '即时分析', 'workspace-chat': '工作区对话', 'api-chat': '接口对话',
  'draft-generation': '写稿', 'content-analysis': '内容解读', 'interpretation': '精读稿',
  'typeset': '公众号排版', 'tracking-topics': '主题追踪', 'topic-pages': '主题页',
  'content-classify': '内容分类', 'topic-suggestions': '选题建议', 'note-title': '素材标题',
  'keyword-extraction': '关键词提取',
  'report-generation': '日报', 'period-report': '周期报告', 'thread-generation': 'Thread 生成',
  'sync-github-trending': 'GitHub Trending', 'unspecified': '未标注任务',
}

const STATUS = {
  succeeded: { label: '成功', color: '#3f7350' },
  failed: { label: '明确失败', color: '#a24b3f' },
  unknown: { label: '结果不确定', color: '#a9791f' },
  blocked: { label: '已拦截', color: '#706b60' },
  reserved: { label: '进行中', color: '#3d5a80' },
}

const money = value => `¥${Number(value || 0).toFixed(4)}`
const purposeName = purpose => PURPOSE_LABELS[purpose] || purpose

export default function SettingsView() {
  const [ledger, setLedger] = useState(undefined)
  const [error, setError] = useState(null)

  useEffect(() => {
    api('/api/stats/llm-calls?days=30&limit=12')
      .then(json => setLedger(json.data))
      .catch(err => { setError(err.message); setLedger(null) })
  }, [])

  const today = ledger?.today || {}
  const period = ledger?.period || {}
  const recentProblems = (ledger?.recent || []).filter(item => item.status !== 'succeeded').slice(0, 6)

  return (
    <>
      <div className="wb-page-title" style={{ fontFamily: 'var(--serif)' }}>设置</div>
      <div className="wb-page-sub">模型、信源同步、日报/周报/月报的生成时间</div>
      {ROWS.map(r => (
        <div key={r.label} className="wb-setting-row">
          <span className="wb-setting-label">{r.label}</span>
          <span className="wb-setting-value">{r.value}</span>
        </div>
      ))}

      <div className="wb-card" style={{ marginTop: 22, padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 5 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>AI 花费账单</div>
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>金额按 token 单价估算，不是供应商最终账单</span>
        </div>
        {ledger === undefined && <div style={{ color: 'var(--faint)', padding: '16px 0' }}>正在读取调用记录…</div>}
        {error && <div className="wb-error">账单读取失败：{error}</div>}
        {ledger && <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10, margin: '14px 0 18px' }}>
            {[
              ['今日调用', today.calls || 0],
              ['成功', today.succeeded || 0],
              ['失败／不确定', (today.failed || 0) + (today.unknown || 0)],
              ['今日估算', money(today.cost_yuan_estimate)],
            ].map(([label, value]) => <div key={label} style={{ border: '1px solid var(--line10)', borderRadius: 9, padding: '11px 12px', background: 'var(--surface)' }}>
              <div style={{ color: 'var(--faint)', fontSize: 11 }}>{label}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 3 }}>{value}</div>
            </div>)}
          </div>

          <div style={{ color: 'var(--sub2)', fontSize: 11.5, margin: '-7px 0 17px' }}>
            近 {period.days || 30} 天共 {period.calls || 0} 次 · {period.total_tokens || 0} tokens · 估算 {money(period.cost_yuan_estimate)}
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 7 }}>今天花在哪</div>
          {(ledger.byPurpose || []).length === 0
            ? <div style={{ color: 'var(--faint)', fontSize: 12.5 }}>账本从本次上线后开始记录，暂时还没有调用。</div>
            : <div>{ledger.byPurpose.map(row => <div key={row.purpose} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 100px', gap: 10, alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--line08)', fontSize: 12.5 }}>
                <b>{purposeName(row.purpose)}</b>
                <span>{row.calls} 次</span>
                <span>{row.total_tokens || 0} tokens</span>
                <span style={{ textAlign: 'right' }}>{money(row.cost_yuan_estimate)}</span>
              </div>)}</div>}

          {recentProblems.length > 0 && <>
            <div style={{ fontSize: 12, fontWeight: 700, margin: '18px 0 7px' }}>最近需要留意</div>
            {recentProblems.map(item => {
              const status = STATUS[item.status] || { label: item.status, color: 'var(--sub2)' }
              return <div key={item.id} title={item.error_message || ''} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 100px', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line08)', fontSize: 12 }}>
                <span style={{ color: status.color, fontWeight: 600 }}>{status.label}</span>
                <span>{purposeName(item.purpose)}</span>
                <span style={{ color: 'var(--faint)', textAlign: 'right' }}>{new Date(item.started_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            })}
          </>}
        </>}
      </div>
    </>
  )
}
