import { useState, useEffect } from 'react'
import { timeAgo, TYPE_LABEL, api, platformLabel } from './util'
import { IconExternal } from './Icons'
import { renderMarkdown } from './markdown'

// 站内阅读器（2026-07-16 用户反馈改版）：默认「精读稿」——与即时分析同模板的
// 结构化中文解读（讲述脉络/关键案例/表述/idea 钩子），不是逐字译文；
// 「原文译文」作为次级标签保留。首次生成走 全文获取+LLM（文章约 1 分钟、
// 视频转写分钟级），产物缓存后秒开。
function ReaderModal({ content, onClose, showToast, loadNotes }) {
  const [tab, setTab] = useState('interp') // 'interp' | 'raw'
  const [interp, setInterp] = useState({ loading: true, data: null, error: null })
  const [raw, setRaw] = useState({ loading: false, data: null, error: null })
  const [savedNote, setSavedNote] = useState(false)
  const [fullBusy, setFullBusy] = useState(false)

  // 「转写全程」：视频没读全时按需补全——绕过缓存转全程后重生成精读稿（可能几分钟，转完自动缓存）
  const transcribeFull = async () => {
    if (fullBusy) return
    setFullBusy(true)
    showToast?.('正在转写全程…（长视频要几分钟，可先关掉，转完自动缓存）')
    try {
      const j = await api(`/api/contents/${content.id}/interpretation?full=1`)
      setInterp({ loading: false, data: j.data, error: null })
      setRaw({ loading: false, data: null, error: null }) // 原文译文缓存也失效，切过去时重取
      showToast?.('已按全程重新精读')
    } catch (err) { showToast?.(`转写全程失败：${err.message}`) }
    setFullBusy(false)
  }

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
              {fullBusy ? (
                <div className="wb-warnbar" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="wb-pending"><i /><i /><i /></span>
                  正在转写全程并重生成精读稿…（长视频约几分钟，可先关掉，转完自动缓存）
                </div>
              ) : interp.data.truncated ? (
                <div className="wb-warnbar" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(169,121,31,.1)', borderColor: 'rgba(169,121,31,.3)' }}>
                  <span style={{ flex: 1 }}>⚠️ {interp.data.note || '这个视频没读全——精读只覆盖了前段'}</span>
                  <button className="wb-btn-primary" style={{ padding: '6px 13px', fontSize: 12, flex: 'none' }} onClick={transcribeFull}>转写全程 →</button>
                </div>
              ) : interp.data.note ? (
                <div className="wb-warnbar" style={{ marginBottom: 10 }}>{interp.data.note}</div>
              ) : null}
              {/* 渲染成干净排版，不露 markdown 符号（用户 2026-07-18 确认） */}
              <div className="wb-md" style={fullBusy ? { opacity: 0.5 } : undefined} dangerouslySetInnerHTML={{ __html: renderMarkdown(interp.data.text) }} />
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
  contents, report, stories, ghTrending, selectedItems, toggleSelect, followSource, followingIds,
  generateReport, generating, setPage, setNotesTab, syncing, syncAllSources,
  toggleStar, saveIdea, showToast, loadNotes, setReturnPage,
}) {
  const [expandedFocus, setExpandedFocus] = useState(null) // 默认全收起（UI 改造：第 1 条摊开挤掉后两条）
  const [readerContent, setReaderContent] = useState(null) // 站内全文阅读器
  const [ghStar, setGhStar] = useState({}) // GitHub 区块星标的本地覆盖（数据源在 ghTrending，父级不重载）
  const [mainTab, setMainTab] = useState('articles') // 'articles' | 'projects'（UI 改造：文章/AI项目分开）
  const [airHint, setAirHint] = useState(() => !localStorage.getItem('wb-seen-airead-hint')) // 「AI 精读」首次说明气泡
  const dismissAirHint = () => { localStorage.setItem('wb-seen-airead-hint', '1'); setAirHint(false) }

  // Feed 搜索 + 星标过滤（2026-07-16 反馈 #2：被新内容推下去的条目要找得回来）。
  // 与素材库同款：有筛选时走后端 SQL（不是只筛已加载的 30 条），无筛选回全局列表
  const [feedTab, setFeedTab] = useState('all') // 'all' | 'starred'
  const [feedQuery, setFeedQuery] = useState('')
  const [sortMode, setSortMode] = useState('latest') // 'latest' 最新 | 'hot' 最热 | 'followed' 关注优先
  const timeOf = (c) => new Date(`${(c.published_at || c.created_at || '').replace(' ', 'T')}Z`).getTime() || 0
  const sortContents = (list) => {
    const arr = [...(list || [])]
    if (sortMode === 'hot') return arr.sort((a, b) => (b.heat ?? b.external_score ?? 0) - (a.heat ?? a.external_score ?? 0) || timeOf(b) - timeOf(a))
    if (sortMode === 'followed') return arr.sort((a, b) => (Number(!!b.source_registered) - Number(!!a.source_registered)) || timeOf(b) - timeOf(a))
    return arr.sort((a, b) => timeOf(b) - timeOf(a)) // 最新：纯发布时间倒序（明确、可预期）
  }
  const [filtered, setFiltered] = useState(null)
  const [artCat, setArtCat] = useState(null)   // 文章分类 chip（2b）
  const [projCat, setProjCat] = useState(null)  // 项目分类 chip（2b）
  const [artCatCounts, setArtCatCounts] = useState({}) // 文章各类目计数（后端，全量）
  const [mustRead, setMustRead] = useState([]) // 今日必看（层1 双通道：行业大事 + 个人相关）
  const muteMustRead = async (m) => {
    setMustRead(prev => prev.filter(x => x.id !== m.id))
    try {
      await api('/api/must-read/mute', { method: 'POST', body: m.sourceId ? { sourceId: m.sourceId } : { contentId: m.id } })
      showToast?.('好的，以后少推这类')
    } catch { /* 静默 */ }
  }
  const hasFilter = feedTab === 'starred' || feedTab === 'followed' || Boolean(feedQuery.trim()) || Boolean(artCat)
  // 卡片密度：舒适（分诊卡）/ 紧凑（列表），记本地
  const [density, setDensity] = useState(() => localStorage.getItem('wb-feed-density') || 'cozy')
  const setDens = (d) => { localStorage.setItem('wb-feed-density', d); setDensity(d) }
  // 同步状态可感知（P0-7）：自动同步能力早已在，此前 UI 上没提过。undefined=加载中，null=从未同步
  const [lastSyncAt, setLastSyncAt] = useState(undefined)
  useEffect(() => {
    api('/api/contents/categories').then(j => setArtCatCounts(j.data || {})).catch(() => {})
    api('/api/must-read').then(j => setMustRead(j.data || [])).catch(() => {})
  }, [])
  // 上次同步时间：进页面拉一次；每次同步完成（syncing true→false）再拉一次刷新
  useEffect(() => {
    if (syncing) return
    api('/api/sync-status').then(j => setLastSyncAt(j.data?.lastSyncAt ?? null)).catch(() => {})
  }, [syncing])
  useEffect(() => {
    if (!hasFilter) { setFiltered(null); return }
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: '200' })
        if (feedQuery.trim()) params.set('q', feedQuery.trim())
        if (feedTab === 'starred') params.set('starred', '1')
        if (feedTab === 'followed') params.set('followed', '1')
        if (artCat) params.set('category', artCat)
        const json = await api(`/api/contents?${params}`)
        setFiltered((json.data || []).map(c => ({ ...c, tags: safeParseTags(c.tags) })))
      } catch (err) { console.error('feed filter:', err) }
    }, 250)
    return () => clearTimeout(t)
  }, [hasFilter, feedTab, feedQuery, artCat])

  const onStar = async (c) => {
    const starred = await toggleStar(c.id)
    if (starred === null) return
    setFiltered(prev => prev && (feedTab === 'starred' && !starred
      ? prev.filter(x => x.id !== c.id)
      : prev.map(x => x.id === c.id ? { ...x, starred } : x)))
  }

  const syncAgo = (iso) => {
    if (!iso) return null
    const t = new Date(/[zZ+]/.test(iso) ? iso : iso + 'Z').getTime()
    const h = Math.floor((Date.now() - t) / 3600000)
    if (h < 1) return '刚刚'
    if (h < 24) return `${h} 小时前`
    return `${Math.floor(h / 24)} 天前`
  }
  const today = new Date()
  const dateLabel = `${today.getMonth() + 1} 月 ${today.getDate()} 日`
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const staleReport = report && report.period_key !== todayKey // 显示的是往日报告（补跑未及时）
  const ideas = (report?.ideas || []).filter(i => i.status === 'suggested' || i.status === 'adopted')
  const selIds = new Set(selectedItems.map(x => x.id))
  // 项目分类（客户端，只 10 条）：计数 + 按 chip 筛选
  const projCounts = (ghTrending.repos || []).reduce((a, r) => { const k = r.category || '其他'; a[k] = (a[k] || 0) + 1; return a }, {})
  const shownRepos = projCat ? (ghTrending.repos || []).filter(r => (r.category || '其他') === projCat) : (ghTrending.repos || [])

  return (
    <>
      <div className="wb-brief">
        <div className="wb-brief-head">
          <div className="wb-brief-title">
            今日概览 · {report ? formatDate(report.period_key) : dateLabel}
            {staleReport && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--amber)', fontWeight: 500 }}>· 显示的是 {formatDate(report.period_key)} 的，点刷新出今天的</span>}
          </div>
          <div className="wb-brief-links">
            {report && (
              <button className="wb-brief-link" disabled={generating} onClick={generateReport}
                title="用最新同步的数据重新生成当天日报（Deepseek，约 ¥0.002）">
                {generating ? '刷新中…' : '↻ 刷新'}
              </button>
            )}
            <button className="wb-brief-link" onClick={() => setPage('reports')}>查看周报</button>
            <button className="wb-brief-link" onClick={() => setPage('reports')}>查看月报</button>
          </div>
        </div>

        {/* 一句话总结（露出日报导语，此前藏着；UI 改造 2a） */}
        {report?.summary && <div className="wb-lead">一句话总结：<b>{report.summary}</b></div>}

        {/* 层1 今日必看：双通道配额制（行业大事 + 个人相关），各带一句人话理由 · P1层4 */}
        {mustRead.length > 0 && (
          <div style={{ margin: '6px 0 14px' }}>
            <div className="wb-brief-label" title="每天先看这几条：既不漏行业大事，也贴合你近期在看的">今日必看 · 先看这几条</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {mustRead.map(m => {
                const industry = m.channel === 'industry'
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 11px', borderRadius: 8, background: 'var(--brief-bg)', borderLeft: `3px solid ${industry ? '#a9791f' : '#3d5a80'}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <a href={m.url} target="_blank" rel="noreferrer" style={{ fontFamily: 'var(--serif)', fontWeight: 600, fontSize: 13.5, color: 'var(--body)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</a>
                      <div style={{ fontSize: 11.5, color: industry ? '#8a6a1a' : 'var(--accent)', marginTop: 2 }}>{industry ? '📢 ' : '✨ '}{m.reason}</div>
                    </div>
                    <button title="不感兴趣：以后少推这个来源/这条（只过滤，不会拿去自动调权重）" onClick={() => muteMustRead(m)}
                      style={{ flex: 'none', border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 12, padding: '2px 4px', lineHeight: 1 }}>✕</button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 层2 今日热点：事件簇（bge-m3 聚类，主条按信任档），全宽 */}
        <div>
        <div className="wb-brief-label">今日热点 · 多个信息源都在说</div>
        <div className="wb-focus">
          {stories.length === 0 && (
            <div style={{ padding: '14px 13px', fontSize: 12.5, color: 'var(--faint)' }}>
              暂无焦点聚类 · 同步数据源后自动生成
            </div>
          )}
          {stories.map((s, i) => {
            const open = expandedFocus === i
            const members = s.members || []
            const primary = members[0]                       // 主条：后端已按信任档排序，第一条即官方优先
            const tierTag = TRUST_TAG[primary?.trust_tier]   // T1 官方一手 / T1.5 官方号；T2 不标
            const others = members.length - 1
            return (
              <div key={s.id} className="wb-focus-item">
                <div className="wb-focus-row" onClick={() => setExpandedFocus(open ? null : i)}>
                  <div className="wb-focus-num">{i + 1}</div>
                  <div className="wb-focus-title">
                    {s.headline}
                    {tierTag && <span className="wb-pill" style={{ marginLeft: 6, fontSize: 10, color: tierTag.fg, background: tierTag.bg, verticalAlign: '1px' }}>{tierTag.label}</span>}
                  </div>
                  <div className="wb-focus-count" title="这件事有几个来源在报道，展开看全部">{s.source_count} 源</div>
                  <div className="wb-focus-arrow">{open ? '▴' : '▾'}</div>
                </div>
                {open && (
                  <div className="wb-focus-detail">
                    {others > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--faint)', margin: '2px 0 6px' }}>
                        主源{TRUST_TAG[primary?.trust_tier] ? `（${TRUST_TAG[primary.trust_tier].label}）` : ''}在上，另有 {others} 个来源也报道了这件事：
                      </div>
                    )}
                    {members.map((m, mi) => (
                      <div key={m.id} className="wb-focus-src" style={mi === 0 ? { borderLeft: '2px solid var(--accent)', paddingLeft: 8 } : undefined}>
                        <div className="wb-focus-src-name">
                          {mi === 0 && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>主源 · </span>}
                          {m.source_display_name || m.source_app}
                          {TRUST_TAG[m.trust_tier] && <span className="wb-pill" style={{ marginLeft: 5, fontSize: 9.5, color: TRUST_TAG[m.trust_tier].fg, background: TRUST_TAG[m.trust_tier].bg }}>{TRUST_TAG[m.trust_tier].label}</span>}
                        </div>
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
        </div>

        {report ? (
          // 选题入口 + 行业动态跳转（行业动态不再在此重复列 item，只留一句+跳 AI HOT，去重）
          <div className="wb-ov-foot">
            <button className="wb-brief-link" onClick={() => { setReturnPage?.('feed'); setPage('inspirations') }}>
              选题建议 {ideas.length} 条 → 去灵感库
            </button>
            <a className="wb-brief-link" style={{ marginLeft: 'auto' }} href="https://aihot.virxact.com/daily" target="_blank" rel="noreferrer"
              title="AI HOT 已做好的完整日报（本期主线+分类），不重复造轮子">
              行业动态 · 看 AI HOT 完整日报 ↗
            </a>
          </div>
        ) : (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="wb-btn-primary" disabled={generating} onClick={generateReport}>
              {generating ? '生成中…' : '生成今日概览'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--sub2)' }}>基于聚类与你关注的信息源提炼焦点与选题（Deepseek，约 ¥0.002）</span>
          </div>
        )}
      </div>

      {/* 列表工具条：文章/AI项目 + （文章时）全部/收藏/搜索/计数/同步 合并成一条，贴住网格 */}
      <div className="wb-feedbar wb-list-toolbar">
        <div className="wb-seg-toggle" style={{ flexShrink: 0 }}>
          <button className={mainTab === 'articles' ? 'active' : ''} onClick={() => setMainTab('articles')}>文章</button>
          <button className={mainTab === 'projects' ? 'active' : ''} onClick={() => setMainTab('projects')}>
            AI 项目{ghTrending.repos.length ? `（${ghTrending.repos.length}）` : ''}
          </button>
        </div>
        {mainTab === 'articles' && (<>
          <span className="wb-tb-sep" />
          <div className="wb-seg-toggle" style={{ flexShrink: 0 }}>
            <button className={feedTab === 'all' ? 'active' : ''} onClick={() => setFeedTab('all')}>全部</button>
            <button className={feedTab === 'followed' ? 'active' : ''} onClick={() => setFeedTab('followed')} title="只看你关注的信源">关注</button>
            <button className={feedTab === 'starred' ? 'active' : ''} onClick={() => setFeedTab('starred')}>★ 收藏</button>
          </div>
          <input className="wb-feed-search" placeholder="搜索资讯（空格分隔多关键词）…"
            value={feedQuery} onChange={(e) => setFeedQuery(e.target.value)} />
          <select className="wb-filter-chip" style={{ flexShrink: 0 }} value={sortMode} onChange={(e) => setSortMode(e.target.value)}
            title="最新=按发布时间；最热=按热度分；关注优先=你关注的源排前面">
            <option value="latest">排序：最新</option>
            <option value="hot">排序：最热</option>
            <option value="followed">排序：关注优先</option>
          </select>
          <div className="wb-seg-toggle" style={{ flexShrink: 0 }} title="舒适=分诊卡；紧凑=列表，一屏扫更多">
            <button className={density === 'cozy' ? 'active' : ''} onClick={() => setDens('cozy')}>舒适</button>
            <button className={density === 'compact' ? 'active' : ''} onClick={() => setDens('compact')}>紧凑</button>
          </div>
          <span className="wb-feedbar-count">共 {(filtered ?? contents).length} 条{hasFilter ? '（筛选中）' : ''}</span>
          <button className="wb-brief-link" disabled={syncing} onClick={syncAllSources}
            title="同步全部信源：AI HOT + RSS 抓取 + B站/YouTube/GitHub 主动查询">
            {syncing ? '同步中…' : '↻ 同步'}
          </button>
        </>)}
      </div>

      {/* 同步状态一行（P0-7）：让"每天自动同步一直在跑"这件事被看见——不再让用户误以为要手动同步 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 2px 12px', fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.5 }}>
        <span aria-hidden="true">🔄</span>
        <span style={{ minWidth: 0 }}>
          {lastSyncAt === undefined
            ? '同步状态加载中…'
            : lastSyncAt
              ? <>上次同步 <b style={{ color: 'var(--sub2)', fontWeight: 600 }}>{syncAgo(lastSyncAt)}</b> · 每天 8:10 / 20:10 自动，离线超 12 小时自动补跑</>
              : '尚未同步 · 每天 8:10 / 20:10 会自动同步，离线超 12 小时自动补跑'}
        </span>
        <button className="wb-brief-link" disabled={syncing} style={{ flexShrink: 0 }} onClick={syncAllSources}
          title="不用等，立即手动同步一次全部信源">{syncing ? '同步中…' : '手动同步'}</button>
      </div>

      {mainTab === 'articles' && (<>
        {/* 分类 chips（2b）：只在无搜索/收藏筛选时出现，避免叠加混乱 */}
        {feedTab !== 'starred' && !feedQuery.trim() && (
          <CatChips cats={ART_CATS} counts={artCatCounts} active={artCat} onPick={setArtCat} defs={ART_DEFS} />
        )}

        {/* 「AI 精读」首次说明气泡 */}
        {airHint && (filtered ?? contents).length > 0 && (
          <div style={{ margin: '0 2px 12px', padding: '9px 13px', background: 'rgba(61,90,128,.07)', border: '1px solid rgba(61,90,128,.18)', borderRadius: 8, fontSize: 12.5, color: 'var(--body2)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>卡片上的「AI 精读」= 让 AI 帮你读懂这篇（出精读稿），不用啃原文。</span>
            <button className="wb-brief-link" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={dismissAirHint}>知道了</button>
          </div>
        )}

        {hasFilter && filtered?.length === 0 && (
          <div className="wb-empty">{feedTab === 'starred' && !feedQuery.trim() ? '还没有收藏。在卡片右上角点 ☆ 一键钉住，事后有用再升级为素材。' : '没有匹配的内容'}</div>
        )}

        <div className={density === 'compact' ? 'wb-feed-list' : 'wb-feed-grid'}>
          {sortContents(filtered ?? contents).map(c => {
            const checked = selIds.has(c.id)
            const followed = c.source_registered === 1 || c.source_registered === true
            const channel = { aihot: 'AI HOT', hackernews: 'Hacker News', rss: 'RSS', github_trending: 'GitHub Trending' }[c.source_app] || c.source_app
            const repoOwner = c.source_app === 'github_trending' ? (c.en_title || '').split('/')[0] : null
            const author = c.source_display_name || repoOwner || channel
            const canRead = Boolean(c.permalink) || (c.url && c.content_type !== 'tweet')
            const openRead = () => { dismissAirHint(); if (c.permalink) window.open(c.permalink, '_blank', 'noopener'); else setReaderContent(c) }
            const title = c.zh_title || c.en_title || '（无标题）'
            // 关注状态 → 小圆点（绿=已关注/灰=未关注），不再用满色 pill；分类降成尾巴小灰字
            const dot = <span className={`wb-fdot${followed ? ' f' : ''}`} title={followed ? '来自你关注的源' : '来自你没关注的源'} />
            const plat = platformLabel({ platform: c.source_platform, contentType: c.content_type, sourceApp: c.source_app }) // 来源类型标
            const meta = `${plat ? plat + ' · ' : ''}${author} · ${timeAgo(c.published_at)}${c.category ? ' · ' + c.category : ''}`
            const actions = (
              <div className="wb-fcard-act">
                {canRead && <button className="wb-btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} title="AI 帮你读懂这篇，出精读稿" onClick={openRead}>AI 精读</button>}
                <button className="wb-fcard-a" title="送入右侧一起解读/对话" onClick={() => toggleSelect(c)}>{checked ? '✓ 已选中' : '选中解读'}</button>
                <button className="wb-fcard-a" title="💡 收进灵感：以后能写（区别于 ★ 收藏＝以后再看）" onClick={() => saveIdea?.({ title, sourceKind: 'feed', sourceRef: c.url || null, supportingContentIds: [c.id] })}>💡</button>
                <button className={`wb-fcard-a${c.starred ? ' on' : ''}`} title={c.starred ? '取消收藏' : '★ 收藏：以后再看（区别于 💡 收进灵感＝以后能写）'} onClick={() => onStar(c)}>{c.starred ? '★' : '☆'}</button>
                {c.url && <a className="wb-fcard-a" href={c.url} target="_blank" rel="noreferrer" title="跳转原文" style={{ display: 'inline-flex', alignItems: 'center' }}><IconExternal /></a>}
                {!followed && c.source_id !== undefined && (
                  <button className="wb-fcard-a" disabled={followingIds?.has(c.id)} onClick={() => followSource(c.id)} title="关注这个作者/来源，以后自动追更">
                    {followingIds?.has(c.id) ? '识别中…' : '＋关注'}
                  </button>
                )}
              </div>
            )
            if (density === 'compact') return (
              <div key={c.id} className={`wb-frow${checked ? ' selected' : ''}`}>
                {dot}
                <span className="wb-frow-title" onClick={openRead} title={c.zh_summary ? `${title}\n\n${c.zh_summary}` : title}>{title}</span>
                {c.zh_summary && <span className="wb-frow-gist" title={c.zh_summary}>{c.zh_summary}</span>}
                <span className="wb-frow-meta">{meta}</span>
                {actions}
              </div>
            )
            return (
              <div key={c.id} className={`wb-fcard${checked ? ' selected' : ''}`}>
                <div className="wb-fcard-title" onClick={openRead} title="点击 AI 精读">{title}</div>
                {c.zh_summary && <div className="wb-fcard-gist">{c.zh_summary}</div>}
                <div className="wb-fcard-meta">{dot}<span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span></div>
                {actions}
              </div>
            )
          })}
        </div>
      </>)}

      {mainTab === 'projects' && (
        ghTrending.repos.length === 0
          ? <div className="wb-empty">暂无热门项目 · 同步后自动出现</div>
          : <>
            <div style={{ display: 'flex', alignItems: 'center', margin: '2px 2px 12px', fontSize: 11.5, color: 'var(--faint)' }}>
              {ghTrending.trend?.trend ? <span style={{ color: 'var(--sub)' }}>{ghTrending.trend.trend}</span> : <span>GitHub Trending · 每日 · 高星+热门双筛</span>}
              <span style={{ marginLeft: 'auto' }}>只显示当天榜；你收藏过的项目在「文章 › ★ 收藏」里</span>
            </div>
            <CatChips cats={REPO_CATS} counts={projCounts} active={projCat} onPick={setProjCat} defs={REPO_DEFS} />
            <div className="wb-feed-grid">
              {shownRepos.map(r => (
                <div key={r.id} className="wb-gcard">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                    <span style={{ color: 'var(--amber)', fontWeight: 600 }}>今日 +{Math.round(r.external_score)} 星</span>
                    {r.category && <span className="wb-cat">{r.category}</span>}
                    <button className={`wb-star${(ghStar[r.id] ?? r.starred) ? ' on' : ''}`} style={{ marginLeft: 'auto' }}
                      title="收藏（收藏后进「文章 › ★ 收藏」）"
                      onClick={async () => { const s = await toggleStar(r.id); if (s !== null) setGhStar(prev => ({ ...prev, [r.id]: s })) }}>
                      {(ghStar[r.id] ?? r.starred) ? '★' : '☆'}
                    </button>
                  </div>
                  <div className="wb-gcard-title">
                    <a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{r.zh_title}</a>
                  </div>
                  {r.zh_summary && <div className="wb-gcard-sum">{r.zh_summary}</div>}
                  <div className="wb-gcard-foot">
                    <button className="wb-btn-primary" style={{ padding: '4px 12px', fontSize: 12 }}
                      title="产品视角速览：解决什么问题 / 对我产品的启发 / 值不值得写" onClick={() => setReaderContent(r)}>AI 精读</button>
                    <a className="wb-btn-ghost" style={{ padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      href={r.url} target="_blank" rel="noreferrer">查看 <IconExternal /></a>
                  </div>
                </div>
              ))}
            </div>
          </>
      )}

      {readerContent && <ReaderModal content={readerContent} onClose={() => setReaderContent(null)} showToast={showToast} loadNotes={loadNotes} />}
    </>
  )
}

// 信任档小标（P1 层3/层2）：只标官方，KOL/媒体(T2)不标——避免满屏标签，官方一手是稀缺信号
const TRUST_TAG = {
  T1: { label: '官方一手', fg: '#3f7350', bg: 'rgba(63,115,80,.14)' },
  'T1.5': { label: '官方号', fg: '#3d5a80', bg: 'rgba(61,90,128,.12)' },
}

// 分类 chips（UI 改造 2b）——文章/项目各一套类目，只显示有内容的类目。
// defs：hover 说明每类是什么（与后端分类 prompt 同口径，2026-07-19）
const ART_CATS = ['模型', '产品', '行业', '观点', '其他']
const REPO_CATS = ['工具Agent', '模型', '应用', '基建', '其他']
const ART_DEFS = {
  模型: '模型本身：发布/更新、技术路线、训练方法、benchmark、研究',
  产品: '能用的工具/应用/SDK/Agent 工具、产品功能更新',
  行业: '生意与格局：融资/IPO/政策/法律/数据中心/公司动向/地缘',
  观点: '人的思考与做法：观点、经验、方法论、辩论、教程、评论',
  其他: '不属于以上四类',
}
const REPO_DEFS = {
  工具Agent: 'Agent 框架/CLI/开发者工具/自动化',
  模型: '模型权重/训练/推理相关的开源项目',
  应用: '面向具体场景的完整应用、示例合集、产品',
  基建: '底层设施：数据/向量库/部署/可观测/协议',
  其他: '不属于以上四类',
}

function CatChips({ cats, counts, active, onPick, defs = {} }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (!total) return null
  return (
    <div className="wb-topic-chips" style={{ marginBottom: 12 }}>
      <button className={`wb-topic-chip wb-chip-tip${!active ? ' active' : ''}`} data-tip="不筛，看全部"
        onClick={() => onPick(null)}>全部（{total}）</button>
      {cats.map(c => counts[c]
        ? <button key={c} className={`wb-topic-chip wb-chip-tip${active === c ? ' active' : ''}`} data-tip={defs[c] || c}
            onClick={() => onPick(active === c ? null : c)}>{c}（{counts[c]}）</button>
        : null)}
    </div>
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
