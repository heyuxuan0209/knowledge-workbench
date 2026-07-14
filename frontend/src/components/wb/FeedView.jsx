import { useState } from 'react'
import { timeAgo, TYPE_LABEL } from './util'
import { IconTag, IconExternal, IconCaret } from './Icons'

// 资讯页：万能收口 + 今日简报（焦点=Story 聚类 / 选题=日报）+ 信息流。
// 视觉对齐原型 01-feed；数据全部来自后端 API。

export default function FeedView({
  contents, report, stories, selectedItems, toggleSelect, followSource, acquire,
  generateReport, generating, viewIdea, upgradeIdea, createFromIdea, setPage,
}) {
  const [acquireVal, setAcquireVal] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [expandedFocus, setExpandedFocus] = useState(0)
  const [ideasOpen, setIdeasOpen] = useState(false)

  const doAcquire = async () => {
    const v = acquireVal.trim()
    if (!v || ingesting) return
    setIngesting(true)
    const ok = await acquire(v)
    if (ok) setAcquireVal('')
    setIngesting(false)
  }

  const today = new Date()
  const dateLabel = `${today.getMonth() + 1} 月 ${today.getDate()} 日`
  const ideas = (report?.ideas || []).filter(i => i.status === 'suggested' || i.status === 'adopted')
  const selIds = new Set(selectedItems.map(x => x.id))

  return (
    <>
      <div className="wb-acquire">
        <input
          value={acquireVal}
          onChange={(e) => setAcquireVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') doAcquire() }}
          placeholder="粘贴链接 / 公众号文章 / YouTube… 开始分析"
        />
        <button className="wb-btn-primary" disabled={!acquireVal.trim() || ingesting} onClick={doAcquire}>
          {ingesting ? '抓取中…' : '分析'}
        </button>
      </div>

      <div className="wb-brief">
        <div className="wb-brief-head">
          <div className="wb-brief-title">今日简报 · {report ? formatDate(report.period_key) : dateLabel}</div>
          <div className="wb-brief-links">
            <button className="wb-brief-link" onClick={() => setPage('reports')}>查看周报</button>
            <button className="wb-brief-link" onClick={() => setPage('reports')}>查看月报</button>
          </div>
        </div>

        <div className="wb-brief-label">今日焦点 · 基于你的信息流聚类</div>
        <div className="wb-focus">
          {stories.length === 0 && (
            <div style={{ padding: '14px 13px', fontSize: 12.5, color: 'var(--faint)' }}>
              暂无焦点聚类 · 同步数据源后自动生成
            </div>
          )}
          {stories.map((s, i) => {
            const open = expandedFocus === i
            return (
              <div key={s.id} className="wb-focus-item">
                <div className="wb-focus-row" onClick={() => setExpandedFocus(open ? null : i)}>
                  <div className="wb-focus-num">{i + 1}</div>
                  <div className="wb-focus-title">{s.headline}</div>
                  <div className="wb-focus-count">{s.source_count} 源</div>
                  <div className="wb-focus-arrow">{open ? '▴' : '▾'}</div>
                </div>
                {open && (
                  <div className="wb-focus-detail">
                    {(s.members || []).map(m => (
                      <div key={m.id} className="wb-focus-src">
                        <div className="wb-focus-src-name">{m.source_display_name || m.source_app}</div>
                        <div className="wb-focus-src-meta">{TYPE_LABEL[m.content_type] || 'Article'} · {timeAgo(m.published_at)}</div>
                        <div className="wb-focus-src-note">{(m.zh_title || m.en_title || '').slice(0, 40)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {report ? (
          <>
            <button className="wb-ideas-toggle" onClick={() => setIdeasOpen(v => !v)}>
              <IconCaret style={{ transform: ideasOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
              选题建议（{ideas.length}）
            </button>
            {ideasOpen && ideas.map(idea => (
              <div key={idea.id} className="wb-idea-card">
                <div className="wb-idea-angle">{idea.title}</div>
                <div className="wb-idea-meta">角度：{idea.angle} · 时机：{idea.why_now}</div>
                <div className="wb-idea-stats">
                  素材：{(idea.supporting_content_ids || []).length} 条 · 共识/非共识：{idea.consensus.length}/{idea.non_consensus.length}
                </div>
                <div className="wb-idea-actions">
                  <button className="wb-btn-ghost" onClick={() => viewIdea(idea)}>查看详情</button>
                  <button className="wb-btn-ghost" onClick={() => upgradeIdea(idea)}>升级为 Topic</button>
                  <button className="wb-btn-outline" onClick={() => createFromIdea(idea, 'thread')}>直接创作 thread</button>
                </div>
              </div>
            ))}
          </>
        ) : (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="wb-btn-primary" disabled={generating} onClick={generateReport}>
              {generating ? '生成中…' : '生成今日简报'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--sub2)' }}>基于聚类与你关注的信息源提炼焦点与选题（Deepseek，约 ¥0.002）</span>
          </div>
        )}
      </div>

      <div className="wb-feedbar">
        <span>排序 <b>综合热度</b></span>
        <span className="wb-feedbar-sep">|</span>
        <span>过滤 <b>全部</b></span>
        <span className="wb-feedbar-count">共 {contents.length} 条</span>
      </div>

      {contents.map(c => {
        const checked = selIds.has(c.id)
        const followed = c.source_registered === 1 || c.source_registered === true
        const channel = { aihot: 'AI HOT', hackernews: 'Hacker News', rss: 'RSS', github_trending: 'GitHub Trending' }[c.source_app] || c.source_app
        // 作者：识别到的 Source 优先；GitHub 仓库显示 owner；否则显示渠道名
        const repoOwner = c.source_app === 'github_trending' ? (c.en_title || '').split('/')[0] : null
        const author = c.source_display_name || repoOwner || channel
        const platform = c.source_display_name
          ? `${c.source_platform}${c.source_handle && !c.source_handle.startsWith('http') ? ' · @' + c.source_handle : ''}`
          : (c.source_display_name === author ? '' : channel)
        return (
          <div key={c.id} className={`wb-fcard${checked ? ' selected' : ''}`}>
            <div className="wb-fcard-head">
              {followed
                ? <span className="wb-pill" style={{ color: '#3f7350', background: 'rgba(63,115,80,.12)' }}>已关注</span>
                : <span className="wb-pill" style={{ color: '#8a8478', background: 'rgba(33,31,26,.06)' }}>未标注</span>}
              <span className="wb-fcard-author">{author}</span>
              <span className="wb-fcard-platform">{platform}</span>
              <span className="wb-fcard-score">评分 <b>{Math.round(c.external_score || 0)}</b></span>
            </div>
            <div className="wb-fcard-title">{c.zh_title || c.en_title || '（无标题）'}</div>
            {c.zh_summary && <div className="wb-fcard-summary">{c.zh_summary}</div>}
            <div className="wb-fcard-chips">
              {(c.tags || []).map(t => <span key={t} className="wb-chip"><IconTag />{t}</span>)}
              <span className="wb-fcard-time">{TYPE_LABEL[c.content_type] || c.content_type} · {timeAgo(c.published_at)}</span>
            </div>
            <div className="wb-fcard-foot">
              <button className={`wb-btn-outline${checked ? ' checked' : ''}`} onClick={() => toggleSelect(c)}>
                {checked ? '✓ 已选中' : '选中分析'}
              </button>
              {c.url && (
                <a className="wb-btn-ghost" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  href={c.url} target="_blank" rel="noreferrer">
                  跳转原文 <IconExternal style={{ verticalAlign: '-1px' }} />
                </a>
              )}
              {!followed && c.source_id !== undefined && (
                <button className="wb-btn-ghost" onClick={() => followSource(c.id)}>＋ 加为信息源</button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

function formatDate(key) {
  if (!key) return ''
  const [, m, d] = key.split('-')
  return `${parseInt(m)} 月 ${parseInt(d)} 日`
}
