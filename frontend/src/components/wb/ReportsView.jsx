import { useState, useEffect } from 'react'
import { IconChart, IconBulb, IconBolt, IconExternal } from './Icons'
import { api } from './util'
import IndustryBrief from './IndustryBrief'

// 周报/月报（M3 洞察层收尾）：动向（升温/降温）+ 主题页更新 + 涌现建议 + 深度选题。
// 数据来自 /api/reports/latest?period=weekly|monthly；生成走 /api/reports/generate-period。
// 2026-07-16 可信化改版：每个板块都带真实溯源（文章/素材/主题页链接），跳走可返回。

// 文章引用列表（后端已把 contentIds 解析为 {id,title,url}）
function ArticleLinks({ articles }) {
  if (!articles?.length) return null
  return (
    <div style={{ margin: '4px 0 2px 18px' }}>
      {articles.map(a => (
        <div key={a.id} style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--body2)' }}>
          · {a.url
            ? <a href={a.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                {a.title || '(无标题)'} <IconExternal size={9} style={{ verticalAlign: '-1px' }} />
              </a>
            : (a.title || '(无标题)')}
        </div>
      ))}
    </div>
  )
}

// 素材卡片引用列表（点击跳素材库并高亮，可返回）
function NoteLinks({ notes, gotoNote }) {
  if (!notes?.length) return null
  return (
    <div style={{ margin: '4px 0 2px 18px' }}>
      {notes.map(n => (
        <div key={n.id} style={{ fontSize: 12.5, lineHeight: 1.7 }}>
          · <button className="wb-brief-link" style={{ padding: 0 }} onClick={() => gotoNote(n.id)}>
              素材：{n.title || '(未命名)'}
            </button>
        </div>
      ))}
    </div>
  )
}

export default function ReportsView({ setPage, viewIdea, showToast, loadTopics, setActiveTopic, setTopicView, gotoTopic, gotoNote }) {
  // 涌现建议 → 一键建页（自动回扫相关素材并生成初始综述，即"系统帮我发现主题"的入口）
  const createFromSuggestion = async (t) => {
    try {
      const json = await api('/api/topics', { method: 'POST', body: { name: t.name, description: t.why } })
      await loadTopics?.()
      showToast(`已建立主题页「${t.name}」${json.data.backfilled ? `，回扫到 ${json.data.backfilled} 条相关素材，AI 正在生成综述` : ''}`)
      setActiveTopic?.(json.data); setTopicView?.('page'); setPage('topics')
    } catch (err) { showToast(`建页失败：${err.message}`) }
  }
  const [period, setPeriod] = useState('week')
  const periodType = period === 'week' ? 'weekly' : 'monthly'
  const [reports, setReports] = useState({ weekly: null, monthly: null })
  const [generating, setGenerating] = useState(false)
  const [openTrend, setOpenTrend] = useState(null) // 展开的动向索引（看证据文章）

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

  // 涌现建议条目的溯源链接（文章/素材/主题页），三类混排
  const emergentRefs = (item) => (
    <>
      <ArticleLinks articles={item.articles} />
      <NoteLinks notes={item.notes} gotoNote={gotoNote} />
      {(item.topicIds || []).map(tid => (
        <div key={tid} style={{ margin: '2px 0 0 18px', fontSize: 12.5 }}>
          · <button className="wb-brief-link" style={{ padding: 0 }} onClick={() => gotoTopic(tid, { remember: true })}>查看相关主题页 →</button>
        </div>
      ))}
    </>
  )

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
        汇总本{unitCn}信息流动向与主题页演进，涌现新方向
        <button className="wb-brief-link" style={{ marginLeft: 10 }} disabled={generating} onClick={generate}>
          {generating ? '生成中…' : (report ? '重新生成' : `生成本${unitCn}报`)}
        </button>
      </div>

      {/* 行业全貌（阶段2）：复用 AI HOT，与下方"你的知识库演进"个人总结并存 */}
      <IndustryBrief period={periodType} />

      {!report && (
        <div className="wb-empty">
          还没有{unitCn}报。点上方「生成」：AI 会统计本{unitCn}主题升温/降温、回顾主题页修订，并给出涌现建议与深度选题。
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
          <div style={{ fontSize: 11.5, color: 'var(--sub2)', marginBottom: 6 }}>
            统计口径：关键词出现在多少篇内容里（本期 vs 上期，本地统计）。点每条可展开命中的文章。
          </div>
          {report.trends?.length
            ? report.trends.map((t, i) => {
              const open = openTrend === i
              const hasEvidence = (t.terms?.length || 0) + (t.articles?.length || 0) > 0
              return (
                <div key={i} className="wb-report-line">
                  <div style={{ cursor: hasEvidence ? 'pointer' : 'default' }} onClick={() => hasEvidence && setOpenTrend(open ? null : i)}>
                    <b style={{ color: t.direction === 'rising' ? '#a24b3f' : '#3d5a80' }}>{t.direction === 'rising' ? '↗ 升温' : '↘ 降温'}</b>
                    {' '}<b>{t.theme}</b> — {t.evidence}
                    {hasEvidence && <span style={{ color: 'var(--sub2)', marginLeft: 6, fontSize: 11.5 }}>{open ? '收起 ▴' : `证据（${t.articles?.length || 0} 篇）▾`}</span>}
                  </div>
                  {open && <>
                    {(t.terms || []).map((k, j) => (
                      <div key={j} style={{ margin: '4px 0 0 18px', fontSize: 12, color: 'var(--sub2)' }}>
                        关键词「{k.term}」：本期 {k.thisCount} 篇 / 上期 {k.prevCount} 篇
                      </div>
                    ))}
                    <ArticleLinks articles={t.articles} />
                  </>}
                </div>
              )
            })
            : <div className="wb-report-line">本{unitCn}信息流没有显著的升温/降温变化。</div>}
        </div>

        <div className="wb-card" style={{ padding: '16px 18px' }}>
          <div className="wb-report-section-title">主题更新</div>
          <div style={{ fontSize: 11.5, color: 'var(--sub2)', marginBottom: 6 }}>
            来自本{unitCn}各主题页的修订记录（素材收进时自动生成）。点主题名可查看该页综述、已收进素材与完整修订时间线。
          </div>
          {report.page_changes?.length
            ? report.page_changes.map((p, i) => (
              <div key={i} className="wb-report-line">
                「<button className="wb-brief-link" style={{ padding: 0, fontWeight: 600 }} onClick={() => gotoTopic(p.topicId, { remember: true })}>{p.topicName}</button>」
                {p.summary}{p.conflict && <span style={{ color: 'var(--amber)' }}> ⚡含矛盾点</span>}
              </div>
            ))
            : <div className="wb-report-line">本{unitCn}没有主题页修订。保存素材并在主题页「收进」后，这里会汇总每次演进。</div>}
        </div>

        <div className="wb-card" style={{ padding: '16px 18px', background: 'var(--brief-bg)', borderColor: 'rgba(61,90,128,.22)' }}>
          <div className="wb-report-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><IconBulb />涌现建议</div>
          <div style={{ fontSize: 11.5, color: 'var(--sub2)', marginBottom: 6 }}>
            AI 回顾本{unitCn}素材与主题页修订，找三类信号：值得新建的主题 / 跨主题关联 / 互相矛盾的论断。每条附支撑来源。
          </div>
          {(report.emergent?.newTopics || []).map((t, i) => (
            <div key={`n${i}`} className="wb-report-line">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1 }}>🌱 <b>建议新主题「{t.name}」</b>：{t.why}</span>
                <button className="wb-brief-link" style={{ flex: 'none' }} onClick={() => createFromSuggestion(t)}>建为主题 →</button>
              </div>
              {emergentRefs(t)}
            </div>
          ))}
          {(report.emergent?.links || []).map((l, i) => (
            <div key={`l${i}`} className="wb-report-line">🔗 {l.text}{emergentRefs(l)}</div>
          ))}
          {(report.emergent?.conflicts || []).map((c, i) => (
            <div key={`c${i}`} className="wb-report-line" style={{ color: 'var(--amber)' }}><IconBolt /> {c.text}{emergentRefs(c)}</div>
          ))}
          {!(report.emergent?.newTopics?.length || report.emergent?.links?.length || report.emergent?.conflicts?.length) && (
            <div className="wb-report-line">本{unitCn}暂无涌现发现（素材与主题页活动越多，AI 越能发现新方向）。</div>
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
