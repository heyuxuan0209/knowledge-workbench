import { useState, useEffect } from 'react'
import { IconChart, IconBulb, IconBolt } from './Icons'
import { api } from './util'

// 周报/月报（M3 洞察层收尾）：动向（升温/降温）+ 主题活页更新 + 涌现建议 + 深度选题。
// 数据来自 /api/reports/latest?period=weekly|monthly；生成走 /api/reports/generate-period。

export default function ReportsView({ setPage, viewIdea, showToast, loadTopics, setActiveTopic, setTopicView }) {
  // 涌现建议 → 一键建页（自动回扫相关素材并生成初始综述，即"系统帮我发现主题"的入口）
  const createFromSuggestion = async (t) => {
    try {
      const json = await api('/api/topics', { method: 'POST', body: { name: t.name, description: t.why } })
      await loadTopics?.()
      showToast(`已建立活页「${t.name}」${json.data.backfilled ? `，回扫到 ${json.data.backfilled} 条相关素材，AI 正在生成综述` : ''}`)
      setActiveTopic?.(json.data); setTopicView?.('page'); setPage('topics')
    } catch (err) { showToast(`建页失败：${err.message}`) }
  }
  const [period, setPeriod] = useState('week')
  const periodType = period === 'week' ? 'weekly' : 'monthly'
  const [reports, setReports] = useState({ weekly: null, monthly: null })
  const [generating, setGenerating] = useState(false)

  const load = async (pt) => {
    try {
      const json = await api(`/api/reports/latest?period=${pt}`)
      setReports(prev => ({ ...prev, [pt]: json.data }))
    } catch (err) { console.error(err) }
  }
  useEffect(() => { load('weekly'); load('monthly') }, [])

  const generate = async () => {
    setGenerating(true)
    showToast(`正在生成${period === 'week' ? '周报' : '月报'}（约 30 秒，调用 Deepseek）…`)
    try {
      const json = await api('/api/reports/generate-period', { method: 'POST', body: { period: periodType } })
      if (!json.success) throw new Error(json.error)
      setReports(prev => ({ ...prev, [periodType]: json.data }))
      showToast(`${period === 'week' ? '周报' : '月报'}已生成`)
    } catch (err) { showToast(`生成失败：${err.message}`) } finally { setGenerating(false) }
  }

  const report = reports[periodType]
  const unitCn = period === 'week' ? '周' : '月'
  const title = report
    ? `${unitCn}报 · ${report.period_key}`
    : (period === 'week' ? `周报 · ${weekLabel()}` : `月报 · ${monthLabel()}`)

  return (
    <>
      <button className="wb-back" onClick={() => setPage('feed')}>← 返回资讯</button>
      <div className="wb-report-head">
        <div className="wb-report-title"><IconChart size={17} />{title}</div>
        <div className="wb-seg-toggle">
          <button className={period === 'week' ? 'active' : ''} onClick={() => setPeriod('week')}>周报</button>
          <button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>月报</button>
        </div>
      </div>
      <div className="wb-page-sub">
        汇总本{unitCn}信息流动向与主题活页演进，涌现新方向
        <button className="wb-brief-link" style={{ marginLeft: 10 }} disabled={generating} onClick={generate}>
          {generating ? '生成中…' : (report ? '重新生成' : `生成本${unitCn}${unitCn === '周' ? '报' : '报'}`)}
        </button>
      </div>

      {!report && (
        <div className="wb-empty">
          还没有{unitCn}报。点上方「生成」：AI 会统计本{unitCn}主题升温/降温、回顾活页修订，并给出涌现建议与深度选题。
          <br />也可定时生成：<code>node src/services/sync-period-report.js {periodType}</code>
        </div>
      )}

      {report && <>
        {report.summary && (
          <div className="wb-card" style={{ padding: '16px 18px' }}>
            <div className="wb-report-line" style={{ fontSize: 13.5 }}>{report.summary}</div>
          </div>
        )}

        <div className="wb-card" style={{ padding: '16px 18px' }}>
          <div className="wb-report-section-title">本{unitCn}动向</div>
          {report.trends?.length
            ? report.trends.map((t, i) => (
              <div key={i} className="wb-report-line">
                <b style={{ color: t.direction === 'rising' ? '#a24b3f' : '#3d5a80' }}>{t.direction === 'rising' ? '↗ 升温' : '↘ 降温'}</b>
                {' '}<b>{t.theme}</b> — {t.evidence}
              </div>
            ))
            : <div className="wb-report-line">本{unitCn}信息流没有显著的升温/降温变化。</div>}
        </div>

        <div className="wb-card" style={{ padding: '16px 18px' }}>
          <div className="wb-report-section-title">主题更新</div>
          {report.page_changes?.length
            ? report.page_changes.map((p, i) => (
              <div key={i} className="wb-report-line">
                「<b>{p.topicName}</b>」{p.summary}{p.conflict && <span style={{ color: 'var(--amber)' }}> ⚡含矛盾点</span>}
              </div>
            ))
            : <div className="wb-report-line">本{unitCn}没有活页修订。保存素材并在主题页「并入」后，这里会汇总每次演进。</div>}
        </div>

        <div className="wb-card" style={{ padding: '16px 18px', background: 'var(--brief-bg)', borderColor: 'rgba(61,90,128,.22)' }}>
          <div className="wb-report-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><IconBulb />涌现建议</div>
          {(report.emergent?.newTopics || []).map((t, i) => (
            <div key={`n${i}`} className="wb-report-line" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>🌱 <b>建议新活页「{t.name}」</b>：{t.why}</span>
              <button className="wb-brief-link" style={{ flex: 'none' }} onClick={() => createFromSuggestion(t)}>建为主题 →</button>
            </div>
          ))}
          {(report.emergent?.links || []).map((l, i) => (
            <div key={`l${i}`} className="wb-report-line">🔗 {l}</div>
          ))}
          {(report.emergent?.conflicts || []).map((c, i) => (
            <div key={`c${i}`} className="wb-report-line" style={{ color: 'var(--amber)' }}><IconBolt /> {c}</div>
          ))}
          {!(report.emergent?.newTopics?.length || report.emergent?.links?.length || report.emergent?.conflicts?.length) && (
            <div className="wb-report-line">本{unitCn}暂无涌现发现（素材与活页活动越多，AI 越能发现新方向）。</div>
          )}
        </div>

        {report.ideas?.length > 0 && (
          <div className="wb-card" style={{ padding: '16px 18px' }}>
            <div className="wb-report-section-title">深度选题</div>
            {report.ideas.map(idea => (
              <div key={idea.id} className="wb-report-line" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                💡 <span style={{ flex: 1 }}>{idea.title}</span>
                <button className="wb-brief-link" onClick={() => viewIdea(idea)}>查看 →</button>
              </div>
            ))}
          </div>
        )}
      </>}
    </>
  )
}

function weekLabel() {
  const now = new Date()
  const week = Math.ceil(now.getDate() / 7)
  return `${now.getMonth() + 1} 月第 ${week} 周`
}
function monthLabel() {
  const now = new Date()
  return `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`
}
