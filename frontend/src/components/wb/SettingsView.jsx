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
const TARGET_LABELS = { zh_title: '中文标题', zh_summary: '中文摘要', zh_body: '中文正文', relevance: '相关性判断' }

const ACTION_GUIDE = {
  unknown: {
    title: '先确认是否已经产出，不要立即重试',
    body: '请求已发给供应商，但 KW 没收到完整回包。打开下方内容检查翻译或摘要是否已经落库；只有确认没有结果时才重试，避免重复付费。',
  },
  failed: {
    title: '解决明确原因后再重试',
    body: '这次调用确定没有成功。余额不足时先充值，限流时稍后再试，参数或内容审核错误则需先修正输入或程序。',
  },
  blocked: {
    title: '查看今日哪个任务消耗过多',
    body: '请求在发出前就被 KW 的每日额度拦下，这次不会产生模型费用。正常用量可等第二天恢复；若某类任务次数异常，应先排查重复循环。',
  },
  reserved: {
    title: '等待调用完成',
    body: '这次调用还在进行中。超过 10 分钟仍未收口时，账本会根据请求是否已发出，自动转成明确失败或结果不确定。',
  },
}

export default function SettingsView() {
  const [ledger, setLedger] = useState(undefined)
  const [error, setError] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showReviewed, setShowReviewed] = useState(false)

  const loadLedger = () => {
    api('/api/stats/llm-calls?days=30&limit=12')
      .then(json => setLedger(json.data))
      .catch(err => { setError(err.message); setLedger(null) })
  }

  useEffect(loadLedger, [])

  const openDetail = async id => {
    setDetailLoading(true)
    try {
      const json = await api(`/api/stats/llm-calls/${id}`)
      setDetail(json.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setDetailLoading(false)
    }
  }

  const markReviewed = async reviewed => {
    if (!detail) return
    const json = await api(`/api/stats/llm-calls/${detail.id}/review`, {
      method: 'POST', body: { reviewed },
    })
    setDetail(json.data)
    loadLedger()
    if (reviewed && !showReviewed) setDetail(null)
  }

  const today = ledger?.today || {}
  const period = ledger?.period || {}
  const recentProblems = (ledger?.recent || []).filter(item => showReviewed || !item.reviewed_at).slice(0, 8)

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

          {(ledger.recent || []).length > 0 && <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0 7px' }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>待处理异常</div>
              {(ledger.recent || []).some(item => item.reviewed_at) && <button type="button" onClick={() => setShowReviewed(value => !value)} style={{ border: 0, background: 'none', color: 'var(--accent)', fontSize: 11.5, cursor: 'pointer' }}>
                {showReviewed ? '隐藏已处理' : '显示已处理'}
              </button>}
            </div>
            {recentProblems.length === 0 && <div style={{ color: 'var(--faint)', fontSize: 12.5, padding: '8px 0' }}>异常都已确认处理。</div>}
            {recentProblems.map(item => {
              const status = STATUS[item.status] || { label: item.status, color: 'var(--sub2)' }
              return <button type="button" key={item.id} onClick={() => openDetail(item.id)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '90px 1fr 110px 20px', gap: 10, padding: '9px 0', border: 0, borderTop: '1px solid var(--line08)', background: 'none', textAlign: 'left', fontSize: 12, cursor: 'pointer', opacity: item.reviewed_at ? 0.55 : 1 }}>
                <span style={{ color: status.color, fontWeight: 600 }}>{status.label}</span>
                <span>{purposeName(item.purpose)}{item.context_count ? ` · 关联 ${item.context_count} 条内容` : ''}{item.reviewed_at ? ' · 已处理' : ''}</span>
                <span style={{ color: 'var(--faint)', textAlign: 'right' }}>{new Date(item.started_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span style={{ color: 'var(--faint)', textAlign: 'right' }}>›</span>
              </button>
            })}
          </>}
        </>}
      </div>

      {detailLoading && <div style={{ position: 'fixed', right: 24, bottom: 24, padding: '10px 14px', borderRadius: 8, background: 'var(--ink)', color: 'white', zIndex: 110 }}>正在读取调用详情…</div>}
      {detail && (() => {
        const status = STATUS[detail.status] || { label: detail.status, color: 'var(--sub2)' }
        const guide = ACTION_GUIDE[detail.status] || ACTION_GUIDE.failed
        return <div onClick={() => setDetail(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,.18)', zIndex: 120, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={event => event.stopPropagation()} style={{ width: 'min(520px,92vw)', height: '100%', background: 'var(--surface)', borderLeft: '1px solid var(--line10)', boxShadow: '-12px 0 40px rgba(0,0,0,.08)', padding: '24px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11.5, color: status.color, fontWeight: 700 }}>{status.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{purposeName(detail.purpose)}</div>
              </div>
              <button type="button" onClick={() => setDetail(null)} style={{ border: 0, background: 'none', fontSize: 24, color: 'var(--faint)', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ marginTop: 20, padding: '14px 15px', borderRadius: 10, background: 'rgba(169,121,31,.08)', border: '1px solid rgba(169,121,31,.18)' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{guide.title}</div>
              <div style={{ marginTop: 6, color: 'var(--sub)', fontSize: 12.5, lineHeight: 1.7 }}>{guide.body}</div>
            </div>

            <div style={{ marginTop: 20, fontSize: 12, fontWeight: 700 }}>这次牵涉的内容</div>
            {(detail.contexts || []).length === 0
              ? <div style={{ color: 'var(--faint)', fontSize: 12.5, padding: '10px 0' }}>这次调用没有业务内容引用，只能根据时间和任务类型排查。</div>
              : <div style={{ marginTop: 6 }}>{detail.contexts.map((context, index) => <div key={`${context.id || context.label}-${index}`} style={{ padding: '10px 0', borderTop: '1px solid var(--line08)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{context.label}</div>
                    {context.id && <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3 }}>{context.id}</div>}
                    {context.target && <div style={{ fontSize: 11, marginTop: 5, color: context.result_present === false ? '#a24b3f' : context.result_present === true ? '#3f7350' : 'var(--sub2)' }}>
                      目标：{TARGET_LABELS[context.target] || context.target}
                      {context.result_present === true ? ' · KW 中已找到结果' : context.result_present === false ? ' · KW 中尚未找到结果' : ''}
                    </div>}
                    {context.result_preview && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4, lineHeight: 1.5 }}>{context.result_preview}</div>}
                  </div>
                  {context.url && <a href={context.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 12, whiteSpace: 'nowrap' }}>查看来源 ↗</a>}
                </div>)}</div>}

            <div style={{ marginTop: 20, fontSize: 12, fontWeight: 700 }}>调用事实</div>
            <div style={{ marginTop: 7, display: 'grid', gridTemplateColumns: '105px 1fr', gap: '7px 10px', fontSize: 12, lineHeight: 1.5 }}>
              <span style={{ color: 'var(--faint)' }}>时间</span><span>{new Date(detail.started_at).toLocaleString('zh-CN')}</span>
              <span style={{ color: 'var(--faint)' }}>模型</span><span>{detail.provider} / {detail.model}</span>
              <span style={{ color: 'var(--faint)' }}>Token</span><span>{detail.total_tokens || 0}{detail.token_source === 'estimated' ? '（估算）' : ''}</span>
              <span style={{ color: 'var(--faint)' }}>估算金额</span><span>{money(detail.cost_yuan_estimate)}</span>
              <span style={{ color: 'var(--faint)' }}>错误类型</span><span>{detail.error_kind || '—'}</span>
              <span style={{ color: 'var(--faint)' }}>错误摘要</span><span style={{ wordBreak: 'break-word' }}>{detail.error_message || '—'}</span>
              <span style={{ color: 'var(--faint)' }}>凭证 ID</span><span style={{ wordBreak: 'break-all' }}>{detail.id}</span>
            </div>

            <button type="button" onClick={() => markReviewed(!detail.reviewed_at)} style={{ marginTop: 24, width: '100%', border: '1px solid var(--accent)', borderRadius: 9, background: detail.reviewed_at ? 'transparent' : 'var(--accent)', color: detail.reviewed_at ? 'var(--accent)' : 'white', padding: '10px 14px', fontWeight: 600, cursor: 'pointer' }}>
              {detail.reviewed_at ? '重新打开处理' : '我已确认，从待处理移除'}
            </button>
          </div>
        </div>
      })()}
    </>
  )
}
