import { useState, useEffect } from 'react'
import { IconChart, IconBulb, IconBolt, IconExternal } from './Icons'
import { api } from './util'
import IndustryBrief from './IndustryBrief'

// 周报/月报（M3 洞察层收尾 · 2026-07-19 重构）：先我后外。
// 顺序：本期一句话 → ①我的主题演进 → ②涌现的新方向（AI提议·带算法解释）→ ③值得写的选题 → ④大盘动态 → 行业大事（收窄）。
// 数据来自 /api/reports/latest?period=weekly|monthly；生成走 /api/reports/generate-period。

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

// 可折叠的报告分区：标题行整条可点，收起后只留标题——周报信息量大，随手折叠少下滑
function SectionCard({ id, header, brief, collapsedSet, toggle, children }) {
  const open = !collapsedSet.has(id)
  return (
    <div className="wb-card" style={{ padding: '16px 18px', ...(brief ? { background: 'var(--brief-bg)', borderColor: 'rgba(61,90,128,.22)' } : null) }}>
      <button className="wb-report-sechead" onClick={() => toggle(id)}>
        <span className="wb-report-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>{header}</span>
        <span className="wb-report-caret">{open ? '收起 ▴' : '展开 ▾'}</span>
      </button>
      {open && children}
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
  // 各分区折叠状态（记本地）：周报信息量大，随手收起少下滑
  const [collapsedSet, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('wb-report-collapsed') || '[]')) } catch { return new Set() }
  })
  const toggle = (id) => setCollapsed(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id)
    localStorage.setItem('wb-report-collapsed', JSON.stringify([...s]))
    return s
  })

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

  const em = report?.emergent || {}
  const hasEmergent = (em.newTopics?.length || 0) + (em.links?.length || 0) + (em.conflicts?.length || 0) > 0

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
        你这{unitCn}的信息综合：主题演进 + 涌现的新方向
        <button className="wb-brief-link" style={{ marginLeft: 10 }} disabled={generating} onClick={generate}>
          {generating ? '生成中…' : (report ? '重新生成' : `生成本${unitCn}报`)}
        </button>
      </div>

      {!report && (
        <div className="wb-empty">
          还没有{unitCn}报。点上方「生成」：AI 会先看你的主题演进，再给涌现的新方向与深度选题，最后附一眼行业大事。
          <br />也可定时生成：<code>node src/services/sync-period-report.js {periodType}</code>
        </div>
      )}

      {report && <>
        {/* 导语 */}
        {report.summary && (
          <div className="wb-report-oneline">本{unitCn}一句话：<b>{report.summary}</b></div>
        )}

        {/* ① 我的主题这周变了啥（纯事实：changelog） */}
        <SectionCard id="mine" collapsedSet={collapsedSet} toggle={toggle}
          header={<>① 我的主题这{unitCn}变了啥{report.page_changes?.length ? <span className="wb-report-cnt">{report.page_changes.length} 处演进</span> : null}</>}>
          <div className="wb-report-explain">来自你主题页的同化/修订记录（收进素材时自动生成）——纯事实。点主题名看综述与完整时间线。</div>
          {report.page_changes?.length
            ? report.page_changes.map((p, i) => (
              <div key={i} className="wb-report-line">
                「<button className="wb-brief-link" style={{ padding: 0, fontWeight: 600 }} onClick={() => gotoTopic(p.topicId, { remember: true })}>{p.topicName}</button>」
                {p.summary}{p.conflict && <span style={{ color: 'var(--amber)' }}> ⚡含矛盾点</span>}
              </div>
            ))
            : <div className="wb-report-line" style={{ color: 'var(--sub2)' }}>本{unitCn}没有主题页修订。存素材并在主题页「收进」后，这里会汇总每次演进。</div>}
        </SectionCard>

        {/* ② 涌现的新方向（AI 提议 · 供你判断，每类带算法解释） */}
        <SectionCard id="emergent" brief collapsedSet={collapsedSet} toggle={toggle}
          header={<><IconBulb />② 涌现的新方向 <span className="wb-ai-tag">AI 提议 · 供你判断</span></>}>
          {em.newTopics?.length > 0 && <>
            <div className="wb-report-sublab">建议新建主题</div>
            <div className="wb-report-explain">怎么来的：AI 看到素材扎堆在某个你还没建的方向、且有热度，提议建页。</div>
            {em.newTopics.map((t, i) => (
              <div key={`n${i}`} className="wb-report-line">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1 }}>🌱 <b>「{t.name}」</b>：{t.why}</span>
                  <button className="wb-brief-link" style={{ flex: 'none' }} onClick={() => createFromSuggestion(t)}>建为主题 →</button>
                </div>
                {emergentRefs(t)}
              </div>
            ))}
          </>}
          {em.links?.length > 0 && <>
            <div className="wb-report-sublab">跨主题洞察</div>
            <div className="wb-report-explain">怎么来的：AI 通读你各主题的综述，找出两个主题之间的关联或因果。</div>
            {em.links.map((l, i) => (
              <div key={`l${i}`} className="wb-report-line">🔗 {l.text}{emergentRefs(l)}</div>
            ))}
          </>}
          {em.conflicts?.length > 0 && <>
            <div className="wb-report-sublab">观点冲突</div>
            <div className="wb-report-explain">怎么来的：AI 找出素材/主题间互相矛盾、值得你验证的论断。</div>
            {em.conflicts.map((c, i) => (
              <div key={`c${i}`} className="wb-report-line" style={{ color: 'var(--amber)' }}><IconBolt /> {c.text}{emergentRefs(c)}</div>
            ))}
          </>}
          {!hasEmergent && (
            <div className="wb-report-line" style={{ color: 'var(--sub2)' }}>本{unitCn}暂无涌现发现（素材与主题页活动越多，AI 越能发现新方向）。</div>
          )}
        </SectionCard>

        {/* ③ 值得写的选题 */}
        {report.ideas?.length > 0 && (
          <SectionCard id="ideas" collapsedSet={collapsedSet} toggle={toggle}
            header={<>③ 值得写的选题 <span className="wb-ai-tag">AI 提议</span><span className="wb-report-cnt">{report.ideas.length} 个</span></>}>
            <div className="wb-report-explain">怎么来的：结合你可能没注意到的行业热点 + 你素材厚/有立场的主题，出跨越单日热点的深度选题。</div>
            {report.ideas.map(idea => (
              <div key={idea.id} className="wb-report-line" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                💡 <span style={{ flex: 1 }}>{idea.title}</span>
                <button className="wb-brief-link" onClick={() => viewIdea(idea)}>查看 →</button>
              </div>
            ))}
          </SectionCard>
        )}

        {/* ④ 大盘动态（信息流关键词升降，本地统计） */}
        <SectionCard id="trends" collapsedSet={collapsedSet} toggle={toggle}
          header={<>④ 大盘动态 <span className="wb-report-cnt">外部信号</span></>}>
          <div className="wb-report-explain">你信息流里关键词本期 vs 上期的词频变化（本地统计）。点每条看命中的文章。</div>
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
            : <div className="wb-report-line" style={{ color: 'var(--sub2)' }}>本{unitCn}信息流没有显著的升温/降温变化。</div>}
        </SectionCard>

        {/* 行业大事（AI HOT 收窄成标题级，和资讯页去重，自身可折叠） */}
        <IndustryBrief period={periodType} compact limit={5} />
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
