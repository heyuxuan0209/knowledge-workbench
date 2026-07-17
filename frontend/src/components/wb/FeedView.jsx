import { useState, useEffect } from 'react'
import { timeAgo, TYPE_LABEL, api } from './util'
import { IconTag, IconExternal } from './Icons'

// 站内阅读器（2026-07-16 用户反馈改版）：默认「精读稿」——与即时分析同模板的
// 结构化中文解读（讲述脉络/关键案例/表述/idea 钩子），不是逐字译文；
// 「原文译文」作为次级标签保留。首次生成走 全文获取+LLM（文章约 1 分钟、
// 视频转写分钟级），产物缓存后秒开。
function ReaderModal({ content, onClose, showToast, loadNotes }) {
  const [tab, setTab] = useState('interp') // 'interp' | 'raw'
  const [interp, setInterp] = useState({ loading: true, data: null, error: null })
  const [raw, setRaw] = useState({ loading: false, data: null, error: null })
  const [savedNote, setSavedNote] = useState(false)

  // 存为素材（2026-07-16 反馈：GitHub 项目/文章都要能进素材库）——
  // 把精读稿/速览存成素材卡，来源回链本内容，走保存即同化的既有管道
  const saveAsNote = async () => {
    if (!interp.data?.text || savedNote) return
    try {
      await api('/api/notes', {
        method: 'POST',
        body: {
          excerpt: interp.data.text, noteType: 'excerpt',
          contentId: content.id,
          sourceTitle: (content.zh_title || content.en_title || '').slice(0, 120) || null,
          sourceUrl: content.url || null,
        },
      })
      setSavedNote(true)
      showToast?.('已存入素材库（AI 会自动匹配主题）')
      loadNotes?.()
    } catch (err) { showToast?.(`保存失败：${err.message}`) }
  }

  useEffect(() => {
    let alive = true
    api(`/api/contents/${content.id}/interpretation`)
      .then(j => { if (alive) setInterp({ loading: false, data: j.data, error: null }) })
      .catch(err => { if (alive) setInterp({ loading: false, data: null, error: err.message }) })
    return () => { alive = false }
  }, [content.id])

  useEffect(() => {
    if (tab !== 'raw' || raw.data || raw.loading) return
    setRaw({ loading: true, data: null, error: null })
    api(`/api/contents/${content.id}/fulltext`)
      .then(j => setRaw({ loading: false, data: j.data, error: null }))
      .catch(err => setRaw({ loading: false, data: null, error: err.message }))
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const isRepo = content.content_type === 'repo' || content.source_app === 'github_trending'
  const loadingHint = content.content_type === 'video'
    ? '正在提取字幕/转写并生成精读稿…（视频首次可能要几分钟，之后秒开）'
    : isRepo
      ? '正在抓取 README 并生成中文速览…（首次约 1 分钟，之后秒开）'
      : '正在获取全文并生成精读稿…（首次约 1 分钟，之后秒开）'

  return (
    <div className="wb-modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wb-modal" style={{ maxWidth: 720, maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}>
        <div className="wb-modal-head">
          <div className="wb-modal-title" style={{ fontFamily: 'var(--serif)' }}>{content.zh_title || content.en_title}</div>
          <div className="wb-seg-toggle" style={{ marginLeft: 'auto', marginRight: 10 }}>
            <button className={tab === 'interp' ? 'active' : ''} onClick={() => setTab('interp')}>{isRepo ? '中文速览' : '精读稿'}</button>
            <button className={tab === 'raw' ? 'active' : ''} onClick={() => setTab('raw')}>{isRepo ? 'README 译文' : '原文译文'}</button>
          </div>
          <button className="wb-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '4px 2px' }}>
          {tab === 'interp' && <>
            {interp.loading && <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--sub2)', fontSize: 13 }}>{loadingHint}</div>}
            {interp.error && <div className="wb-warnbar">生成失败：{interp.error}</div>}
            {interp.data && <>
              {interp.data.note && <div className="wb-warnbar" style={{ marginBottom: 10 }}>{interp.data.note}</div>}
              <div style={{ fontSize: 14, lineHeight: 1.85, color: 'var(--body2)', whiteSpace: 'pre-wrap' }}>{interp.data.text}</div>
            </>}
          </>}
          {tab === 'raw' && <>
            {raw.loading && <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--sub2)', fontSize: 13 }}>正在获取原文译文…</div>}
            {raw.error && <div className="wb-warnbar">获取失败：{raw.error}</div>}
            {raw.data && <>
              {raw.data.enTitle && raw.data.enTitle !== raw.data.title && (
                <div style={{ fontSize: 12.5, color: 'var(--sub2)', marginBottom: 10 }}>原题：{raw.data.enTitle}</div>
              )}
              {raw.data.note && <div className="wb-warnbar" style={{ marginBottom: 10 }}>{raw.data.note}</div>}
              <div style={{ fontSize: 14, lineHeight: 1.85, color: 'var(--body2)', whiteSpace: 'pre-wrap' }}>{raw.data.body || '（未获取到正文）'}</div>
            </>}
          </>}
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--line08)', display: 'flex', gap: 12, alignItems: 'center' }}>
            {interp.data?.text && (
              <button className="wb-btn-outline" disabled={savedNote} onClick={saveAsNote}>
                {savedNote ? '✓ 已存入素材库' : '存为素材'}
              </button>
            )}
            {content.url && <a className="wb-brief-link" href={content.url} target="_blank" rel="noreferrer">跳转原文 ↗</a>}
          </div>
        </div>
      </div>
    </div>
  )
}

// 资讯页：万能收口 + 今日简报（焦点=Story 聚类 / 选题=日报）+ 信息流。
// 视觉对齐原型 01-feed；数据全部来自后端 API。

export default function FeedView({
  contents, report, stories, ghTrending, selectedItems, toggleSelect, followSource, followingIds, acquire,
  generateReport, generating, setPage, setNotesTab, syncing, syncAllSources,
  toggleStar, showToast, loadNotes,
}) {
  const [acquireVal, setAcquireVal] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [expandedFocus, setExpandedFocus] = useState(0)
  const [readerContent, setReaderContent] = useState(null) // 站内全文阅读器
  const [ghStar, setGhStar] = useState({}) // GitHub 区块星标的本地覆盖（数据源在 ghTrending，父级不重载）

  // Feed 搜索 + 星标过滤（2026-07-16 反馈 #2：被新内容推下去的条目要找得回来）。
  // 与素材库同款：有筛选时走后端 SQL（不是只筛已加载的 30 条），无筛选回全局列表
  const [feedTab, setFeedTab] = useState('all') // 'all' | 'starred'
  const [feedQuery, setFeedQuery] = useState('')
  const [filtered, setFiltered] = useState(null)
  const hasFilter = feedTab === 'starred' || Boolean(feedQuery.trim())
  useEffect(() => {
    if (!hasFilter) { setFiltered(null); return }
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: '200' })
        if (feedQuery.trim()) params.set('q', feedQuery.trim())
        if (feedTab === 'starred') params.set('starred', '1')
        const json = await api(`/api/contents?${params}`)
        setFiltered((json.data || []).map(c => ({ ...c, tags: safeParseTags(c.tags) })))
      } catch (err) { console.error('feed filter:', err) }
    }, 250)
    return () => clearTimeout(t)
  }, [hasFilter, feedTab, feedQuery])

  const onStar = async (c) => {
    const starred = await toggleStar(c.id)
    if (starred === null) return
    setFiltered(prev => prev && (feedTab === 'starred' && !starred
      ? prev.filter(x => x.id !== c.id)
      : prev.map(x => x.id === c.id ? { ...x, starred } : x)))
  }

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
                        <div className="wb-focus-src-note">
                          {m.url
                            ? <a href={m.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}
                                onMouseOver={(e) => e.target.style.textDecoration = 'underline'}
                                onMouseOut={(e) => e.target.style.textDecoration = 'none'}>
                                {(m.zh_title || m.en_title || '').slice(0, 40)} <IconExternal size={9} style={{ verticalAlign: '-1px' }} />
                              </a>
                            : (m.zh_title || m.en_title || '').slice(0, 40)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {report ? (
          // 选题建议已迁入素材库（2026-07-16 反馈：折叠在简报里被遮挡没意义），这里只留入口
          <button className="wb-ideas-toggle" onClick={() => { setNotesTab?.('ideas'); setPage('notes') }}>
            📌 选题建议 {ideas.length} 条 → 去素材库查看（含支撑素材聚合）
          </button>
        ) : (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="wb-btn-primary" disabled={generating} onClick={generateReport}>
              {generating ? '生成中…' : '生成今日简报'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--sub2)' }}>基于聚类与你关注的信息源提炼焦点与选题（Deepseek，约 ¥0.002）</span>
          </div>
        )}
      </div>

      {ghTrending.repos.length > 0 && (
        <div className="wb-brief" style={{ background: 'var(--surface)', borderColor: 'var(--line10)' }}>
          <div className="wb-brief-head" style={{ marginBottom: 8 }}>
            <div className="wb-brief-title" style={{ fontSize: 15 }}>热门 AI 项目</div>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--faint)' }}>GitHub Trending · 每日 · 高星+热门双筛</span>
          </div>
          {ghTrending.trend?.trend && (
            <div className="wb-brief-label" style={{ marginBottom: 10 }}>📈 {ghTrending.trend.trend}</div>
          )}
          <div className="wb-focus">
            {ghTrending.repos.map(r => (
              <div key={r.id} className="wb-focus-item">
                <div className="wb-focus-row" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4 }}>
                      <a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{r.zh_title}</a>
                    </div>
                    {r.zh_summary && <div style={{ fontSize: 12.5, color: 'var(--sub)', lineHeight: 1.5, marginTop: 3 }}>{r.zh_summary}</div>}
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      ⭐ 今日 +{Math.round(r.external_score)}
                      <button className={`wb-star${(ghStar[r.id] ?? r.starred) ? ' on' : ''}`} style={{ marginLeft: 4 }}
                        title="星标收藏（星标列表里也能看到 GitHub 项目）"
                        onClick={async () => { const s = await toggleStar(r.id); if (s !== null) setGhStar(prev => ({ ...prev, [r.id]: s })) }}>
                        {(ghStar[r.id] ?? r.starred) ? '★' : '☆'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                      <button className="wb-brief-link" style={{ fontSize: 11 }}
                        title="产品视角速览：解决什么问题 / 对我产品的启发 / 值不值得写（首次约 1 分钟）"
                        onClick={() => setReaderContent(r)}>中文速览</button>
                      <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
                        查看 <IconExternal size={9} style={{ verticalAlign: '-1px' }} />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="wb-feedbar">
        <div className="wb-seg-toggle" style={{ flexShrink: 0 }}>
          <button className={feedTab === 'all' ? 'active' : ''} onClick={() => setFeedTab('all')}>全部</button>
          <button className={feedTab === 'starred' ? 'active' : ''} onClick={() => setFeedTab('starred')}>★ 星标</button>
        </div>
        <input className="wb-feed-search" placeholder="搜索资讯（空格分隔多关键词）…"
          value={feedQuery} onChange={(e) => setFeedQuery(e.target.value)} />
        <button className="wb-brief-link" disabled={syncing} onClick={syncAllSources}
          title="同步全部信源：AI HOT + RSS 抓取 + B站/YouTube/GitHub 主动查询">
          {syncing ? '同步中…' : '↻ 同步信源'}
        </button>
        <span className="wb-feedbar-count">共 {(filtered ?? contents).length} 条{hasFilter ? '（筛选中）' : ''}</span>
      </div>

      {hasFilter && filtered?.length === 0 && (
        <div className="wb-empty">{feedTab === 'starred' && !feedQuery.trim() ? '还没有星标内容。在卡片右上角点 ☆ 一键钉住，事后有用再升级为素材。' : '没有匹配的内容'}</div>
      )}

      {(filtered ?? contents).map(c => {
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
              {c.heat != null && <span className="wb-fcard-score">热度 <b>{c.heat}</b></span>}
              <button className={`wb-star${c.starred ? ' on' : ''}`} title={c.starred ? '取消星标' : '星标：一键钉住，事后找得回（不用进素材库）'}
                onClick={() => onStar(c)}>{c.starred ? '★' : '☆'}</button>
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
              {c.permalink && (
                <a className="wb-btn-ghost" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  href={c.permalink} target="_blank" rel="noreferrer">
                  全文解读 <IconExternal style={{ verticalAlign: '-1px' }} />
                </a>
              )}
              {!c.permalink && c.url && c.content_type !== 'tweet' && (
                <button className="wb-btn-ghost" title="结构化精读稿（与即时分析同款）+ 原文译文，首次生成约 1 分钟"
                  onClick={() => setReaderContent(c)}>精读</button>
              )}
              {c.url && (
                <a className="wb-btn-ghost" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  href={c.url} target="_blank" rel="noreferrer">
                  跳转原文 <IconExternal style={{ verticalAlign: '-1px' }} />
                </a>
              )}
              {!followed && c.source_id !== undefined && (
                <button className="wb-btn-ghost" disabled={followingIds?.has(c.id)} onClick={() => followSource(c.id)}>
                  {followingIds?.has(c.id) ? '识别中…' : '＋ 加为信息源'}
                </button>
              )}
            </div>
          </div>
        )
      })}

      {readerContent && <ReaderModal content={readerContent} onClose={() => setReaderContent(null)} showToast={showToast} loadNotes={loadNotes} />}
    </>
  )
}

function safeParseTags(s) {
  if (Array.isArray(s)) return s
  try { return JSON.parse(s || '[]') } catch { return [] }
}

function formatDate(key) {
  if (!key) return ''
  const [, m, d] = key.split('-')
  return `${parseInt(m)} 月 ${parseInt(d)} 日`
}
