import { useState } from 'react'
import { IconChart, IconBulb } from './Icons'

// 周报/月报（视觉对齐原型 07-reports，由资讯页入口进入）。
// 周/月报的「主题更新 · 涌现建议」依赖活页 changelog（M3）；当前展示结构与说明。

export default function ReportsView({ setPage, report }) {
  const [period, setPeriod] = useState('week')
  const title = period === 'week' ? `周报 · ${weekLabel()}` : `月报 · ${monthLabel()}`

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
      <div className="wb-page-sub">定时生成 · 汇总近期主题更新，给出趋势与新选题</div>

      <div className="wb-card" style={{ padding: '16px 18px' }}>
        <div className="wb-report-section-title">本{period === 'week' ? '周' : '月'}动向</div>
        <div className="wb-report-line">
          {report
            ? <>今日焦点与选题见 <button className="wb-brief-link" style={{ fontSize: 13 }} onClick={() => setPage('feed')}>资讯页 · 今日简报</button>；跨周趋势（↗升温 / ↘降温）将基于聚类历史统计生成（M3）。</>
            : <>↗ 升温 / ↘ 降温 趋势基于你信息流的聚类历史统计，将在 M3 上线。</>}
        </div>
      </div>

      <div className="wb-card" style={{ padding: '16px 18px' }}>
        <div className="wb-report-section-title">主题更新</div>
        <div className="wb-report-line">
          主题活页（AI 维护的综述 + 修订记录）是 M3 能力；上线后这里汇总本{period === 'week' ? '周' : '月'}各活页的修订与新增矛盾点。
        </div>
      </div>

      <div className="wb-card" style={{ padding: '16px 18px', background: 'var(--brief-bg)', borderColor: 'rgba(61,90,128,.22)' }}>
        <div className="wb-report-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><IconBulb />涌现建议</div>
        <div className="wb-report-line">
          新建主题建议 · 矛盾预警 · 新选题——由 AI 回顾本{period === 'week' ? '周' : '月'}同化记录后涌现（与活页同引擎，M3）。
        </div>
      </div>
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
