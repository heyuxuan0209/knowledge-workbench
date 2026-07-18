import { useState, useEffect } from 'react'
import { api, timeAgo } from './util'
import { IconExternal } from './Icons'

// 行业面（VISION-V4 阶段2）：报告/简报里的"行业全貌"——复用 AI HOT 精选，不重新生成。
// 每条链到 AI HOT 全文解读页，顶部一键跳转 AI HOT 站点看完整日/周/月榜。
const PERIOD_CN = { daily: '日', weekly: '周', monthly: '月' }

export default function IndustryBrief({ period = 'daily' }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    let alive = true
    api(`/api/industry-brief?period=${period}`).then(j => { if (alive) setData(j.data) }).catch(() => {})
    return () => { alive = false }
  }, [period])

  if (!data || !data.items?.length) return null

  return (
    <div className="wb-brief" style={{ background: 'var(--surface)', borderColor: 'var(--line10)' }}>
      <div className="wb-brief-head" style={{ marginBottom: 8 }}>
        <div className="wb-brief-title" style={{ fontSize: 15 }}>🌐 行业动态</div>
        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--faint)' }}>AI HOT 精选 · 按热度取前 {data.items.length} 条</span>
        <a className="wb-brief-link" style={{ marginLeft: 'auto' }} href={data.jumpUrl} target="_blank" rel="noreferrer"
          title="到 AI HOT 看完整日/周/月报（本期主线+主题聚类的编辑综合，他们已做好，我们不重复造轮子）">
          看 AI HOT 完整{PERIOD_CN[period]}报 <IconExternal size={10} style={{ verticalAlign: '-1px' }} />
        </a>
      </div>
      <div className="wb-focus">
        {data.items.map((it, i) => (
          <div key={it.id} className="wb-focus-item">
            <div className="wb-focus-row" style={{ alignItems: 'flex-start', cursor: 'default' }}>
              <div className="wb-focus-num">{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <a href={it.link} target="_blank" rel="noreferrer"
                  style={{ fontSize: 13.5, fontWeight: 600, color: 'inherit', textDecoration: 'none', lineHeight: 1.4 }}>
                  {it.title} <IconExternal size={9} style={{ verticalAlign: '-1px', opacity: 0.6 }} />
                </a>
                {it.summary && <div style={{ fontSize: 12, color: 'var(--sub)', lineHeight: 1.5, marginTop: 2 }}>{it.summary}</div>}
                {it.publishedAt && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>{timeAgo(it.publishedAt)}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
