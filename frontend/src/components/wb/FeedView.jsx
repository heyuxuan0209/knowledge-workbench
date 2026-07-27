import { useState, useEffect } from 'react'
import { timeAgo, TYPE_LABEL, api, platformLabel } from './util'
import { IconExternal, IconPin, IconTarget, IconFlame, IconMedal, IconStar, IconCheck, IconPlusTrack, IconBookOpen, IconBulb, IconChevronRight, IconWarn, IconMegaphone, IconSparkle, IconRefresh, IconX, IconCirclePlus } from './Icons'
import '../../styles/feed-final.css'
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
                  <span style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconWarn size={13} /> {interp.data.note || '这个视频没读全——精读只覆盖了前段'}</span>
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
  toggleStar, saveIdea, showToast, loadNotes, setReturnPage, gotoNote, gotoTracking,
}) {
  // 资讯卡「追踪这个话题」（P3 收尾④）：从这条内容起一个追踪主题（用户确认话题名；查重命中则去看已有）
  const trackFromContent = async (c) => {
    const guess = (c.zh_title || c.en_title || '').replace(/[：:，,。].*$/, '').slice(0, 20)
    const name = window.prompt('追踪哪个话题/实体？（AI 会每天把「以它为主角」的资讯归进来）', guess)
    if (!name?.trim()) return
    try {
      const j = await api('/api/tracking-topics', { method: 'POST', body: { name: name.trim(), aliases: [name.trim()] } })
      if (j.data?.duplicate) { showToast?.(`已在追踪《${j.data.duplicate.name}》`, { label: '去看', onClick: () => gotoTracking?.(j.data.duplicate.id) }); return }
      showToast?.(`已追踪《${name.trim()}》，AI 正在收录归线（约 1-2 分钟）…`, j.data?.id ? { label: '去看', onClick: () => gotoTracking?.(j.data.id) } : null)
    } catch (e) { showToast?.('追踪失败：' + e.message) }
  }
  const [expandedFocus, setExpandedFocus] = useState(null) // 默认全收起（UI 改造：第 1 条摊开挤掉后两条）
  const [readerContent, setReaderContent] = useState(null) // 站内全文阅读器
  const [ghStar, setGhStar] = useState({}) // GitHub 区块星标的本地覆盖（数据源在 ghTrending，父级不重载）
  const [mainTab, setMainTab] = useState('articles') // 'articles' | 'projects'（UI 改造：文章/AI项目分开）
  const [airHint, setAirHint] = useState(() => !localStorage.getItem('wb-seen-airead-hint')) // 「AI 精读」首次说明气泡
  // 今日概览可收起（用户反馈：别占着首页屏幕）——默认收起、只留一句话总结，展开态记住
  const [briefOpen, setBriefOpen] = useState(() => localStorage.getItem('wb-brief-open') === '1')
  const toggleBrief = () => setBriefOpen(o => { const n = !o; localStorage.setItem('wb-brief-open', n ? '1' : '0'); return n })
  const dismissAirHint = () => { localStorage.setItem('wb-seen-airead-hint', '1'); setAirHint(false) }

  // Feed 搜索 + 星标过滤（2026-07-16 反馈 #2：被新内容推下去的条目要找得回来）。
  // 与素材库同款：有筛选时走后端 SQL（不是只筛已加载的 30 条），无筛选回全局列表
  const [feedTab, setFeedTab] = useState('all') // 'all' | 'starred'
  const [feedQuery, setFeedQuery] = useState('')
  // ADR-045：一手优先(新默认，记住) / 最新 / 最热；「关注优先」退役（被组2吸收）
  const [sortMode, setSortMode] = useState(() => localStorage.getItem('wb-feed-sort') || 'firsthand')
  const setSort = (m) => { localStorage.setItem('wb-feed-sort', m); setSortMode(m) }
  const timeOf = (c) => new Date(`${(c.published_at || c.created_at || '').replace(' ', 'T')}Z`).getTime() || 0
  const sortContents = (list) => {
    const arr = [...(list || [])]
    if (sortMode === 'hot') return arr.sort((a, b) => (b.heat ?? b.external_score ?? 0) - (a.heat ?? a.external_score ?? 0) || timeOf(b) - timeOf(a))
    return arr.sort((a, b) => timeOf(b) - timeOf(a)) // 最新/一手优先(扁平回退)：时间倒序
  }
  // 一手优先分组（ADR-045①）：桶互斥级联——官方一手 > 关注 > 精选/热点主条 > 其他
  const bucketOf = (c) => {
    if (c.trust_tier === 'T1' || c.trust_tier === 'T1.5') return 1      // 官方 blog + 官方号/员工号（即使被关注也进组1）
    if (c.source_registered) return 2                                    // 你关注的人
    if (c.story_source_count || c.source_app === 'aihot') return 3       // 事件簇主条 + AI HOT 精选
    return 4
  }
  const groupContents = (list) => {
    const g = { 1: [], 2: [], 3: [], 4: [] }
    for (const c of (list || [])) g[bucketOf(c)].push(c)
    for (const k of [1, 2, 3, 4]) g[k].sort((a, b) => timeOf(b) - timeOf(a)) // 组内纯时间倒序
    return g
  }
  const [filtered, setFiltered] = useState(null)
  const [artCat, setArtCat] = useState(null)   // 文章分类 chip（2b）
  const [projCat, setProjCat] = useState(null)  // 项目分类 chip（2b）
  const [artCatCounts, setArtCatCounts] = useState({}) // 文章各类目计数（后端，全量）
  const [mustRead, setMustRead] = useState([]) // 今日必看（层1 双通道：行业大事 + 个人相关）
  // §八：站内先读——点必看/热点条 → 拉 content 开精读阅读器（复用「AI 精读」同一 ReaderModal），原文降为次级
  const openReaderById = async (id) => {
    if (!id) return
    try { const j = await api(`/api/contents/${id}`); if (j.data) { dismissAirHint(); setReaderContent(j.data) } else showToast?.('这条内容已不在库里') }
    catch (e) { showToast?.('打开失败：' + e.message) }
  }
  // 点推荐依据《XX》：content→站内精读；note→跳素材卡
  const openAnchor = (a) => { if (!a) return; a.kind === 'note' ? gotoNote?.(a.id) : openReaderById(a.id) }
  const muteMustRead = async (m) => {
    setMustRead(prev => prev.filter(x => x.id !== m.id))
    try {
      await api('/api/must-read/mute', { method: 'POST', body: m.sourceId ? { sourceId: m.sourceId } : { contentId: m.id } })
      showToast?.('好的，以后少推这类')
    } catch { /* 静默 */ }
  }
  const hasFilter = feedTab === 'starred' || feedTab === 'followed' || Boolean(feedQuery.trim()) || Boolean(artCat)
  const [otherOpen, setOtherOpen] = useState(false)   // 组4「其他」默认折叠
  // 第三刀·精选优先（「全部」视图顶部）：可解释信号排序 + 显式 mute，每条带「为什么入选」
  const [curated, setCurated] = useState([])
  const [showAll, setShowAll] = useState(false)         // 「查看全部」展开完整分组列表
  const [curMenu, setCurMenu] = useState(null)          // 哪条打开 × 反馈细选菜单
  const [storyMem, setStoryMem] = useState({})          // 需求3：contentId → 事件簇成员（点「N 源同报」展开看哪些源）
  const [topicCards, setTopicCards] = useState([])      // 需求2：真·多源事件簇话题卡（综合总结 + 折叠各源）
  const [openTopic, setOpenTopic] = useState({})        // 话题卡「N 源报道」展开态
  const loadTopicCards = () => api('/api/feed/topic-cards').then(j => setTopicCards(j.data || [])).catch(() => {})
  // ⚙调精选面板：源/主题白黑名单管理（显式过滤、可撤销、不猜口味）
  const [cfgOpen, setCfgOpen] = useState(false)
  const [cfg, setCfg] = useState(null)
  const loadCfg = () => api('/api/feed/curate-config').then(j => setCfg(j.data)).catch(() => {})
  const openConfig = () => { setCfgOpen(true); loadCfg() }
  const toggleMute = async (body) => {
    try { await api('/api/feed/curate-mute', { method: 'POST', body }); loadCfg(); loadCurated() } catch { /* */ }
  }
  const toggleStoryMem = async (id) => {
    if (storyMem[id]) { setStoryMem(p => { const n = { ...p }; delete n[id]; return n }); return }
    setStoryMem(p => ({ ...p, [id]: 'loading' }))
    try { const j = await api(`/api/feed/story-members?contentId=${id}`); setStoryMem(p => ({ ...p, [id]: j.data || [] })) }
    catch { setStoryMem(p => { const n = { ...p }; delete n[id]; return n }) }
  }
  // 可点徽章（「N 源同报」才可点开看源；「官方一手」不可点）
  const badgeEl = (c, badge) => !badge ? null : (badge.cls === 'cl'
    ? <span className={`fg-badge ${badge.cls}`} style={{ cursor: 'pointer' }} title="点看是哪几个源" onClick={() => toggleStoryMem(c.id)}>{badge.t} {storyMem[c.id] ? '▴' : '▾'}</span>
    : <span className={`fg-badge ${badge.cls}`}>{badge.t}</span>)
  // 事件簇成员展开区（点徽章后卡内列出各源+标题+原文）
  const storyExpand = (c) => {
    const m = storyMem[c.id]; if (!m) return null
    if (m === 'loading') return <div className="cf-members"><span style={{ color: 'var(--faint)' }}>加载中…</span></div>
    return (
      <div className="cf-members">
        <div className="cf-mh">这件事 {m.length} 个源在报：</div>
        {m.map(x => (
          <div key={x.id} className="cf-mrow">
            <span className="cf-msrc">{(x.tier === 'T1' || x.tier === 'T1.5') ? '★ ' : ''}{x.src}</span>
            <span className="cf-mt" onClick={() => openReaderById(x.id)} title="站内精读">{x.title}</span>
            {x.url && <a href={x.url} target="_blank" rel="noreferrer" title="原文" style={{ color: 'var(--faint)', flexShrink: 0 }}><IconExternal size={11} /></a>}
          </div>
        ))}
      </div>
    )
  }
  const loadCurated = () => api('/api/feed/curated?limit=12').then(j => setCurated(j.data || [])).catch(() => {})
  // × 负反馈（不看这条 / 少推源 / 这类主题少推）：本地移除 + 落库 mute（显式过滤、可撤销、不调权重）
  const curateMute = async (body, msg) => {
    setCurMenu(null)
    setCurated(prev => prev.filter(x => x.id !== body.contentId
      && !(body.sourceId && x.sourceId === body.sourceId)
      && !(body.category && x.category === body.category)))
    try { await api('/api/feed/curate-mute', { method: 'POST', body }); showToast?.(msg) } catch { /* 静默 */ }
  }
  const starCurated = async (id) => { try { await api(`/api/contents/${id}/star`, { method: 'POST' }); showToast?.('已收藏') } catch { /* */ } }
  // ADR-045 终版：新到分界（last_visit 落库）+ ★挂账催办 + 逐组「之前的」折叠 + 动作留痕
  const [lastVisit, setLastVisit] = useState(undefined) // 上次来的时间（进页面时取 prevVisit，同时把 now 落库）
  const [openOld, setOpenOld] = useState({})            // 各组「之前的 ▸」展开态
  const [feedMarks, setFeedMarks] = useState({})        // 行内动作留痕小标：id→'read'|'star'|'idea'
  const [iouStars, setIouStars] = useState([])          // ★挂账（「以后再看」）待清单，按挂账时间升序
  // 同步状态可感知（P0-7）：自动同步能力早已在，此前 UI 上没提过。undefined=加载中，null=从未同步
  const [lastSyncAt, setLastSyncAt] = useState(undefined)
  useEffect(() => {
    api('/api/contents/categories').then(j => setArtCatCounts(j.data || {})).catch(() => {})
    api('/api/must-read').then(j => setMustRead(j.data || [])).catch(() => {})
    // 进页面：把这次来访落库，返回的 prevVisit 就是「上次来」的分界线（新到=晚于它）
    api('/api/feed/visit', { method: 'POST' }).then(j => setLastVisit(j.data?.prevVisit ?? null)).catch(() => setLastVisit(null))
    loadIouStars()
    loadCurated()
    loadTopicCards()
  }, [])
  // ★挂账清单：全库星标（不止已加载的），按挂账时间升序（挂得越久越靠前催办）
  const loadIouStars = () => api('/api/contents?starred=1&limit=100')
    .then(j => setIouStars((j.data || []).filter(c => c.starred).sort((a, b) => (a.starred_at || '').localeCompare(b.starred_at || ''))))
    .catch(() => {})
  const daysSince = (iso) => {
    if (!iso) return 0
    const t = new Date(/[zZ+]/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z').getTime()
    return Math.max(0, Math.floor((Date.now() - t) / 864e5))
  }
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

  // 统一紧凑行（ADR-045④，像素级 .fg-row）：time | 来源 | 标题(hover 全摘要) | 徽章 | 动作(hover)。点标题=站内精读。
  const hmOf = (c) => {
    const raw = (c.published_at || c.created_at || '').replace(' ', 'T')
    const d = new Date(/[zZ+]/.test(raw) ? raw : raw + 'Z'); if (isNaN(d)) return ''
    const now = new Date()
    return d.toDateString() === now.toDateString() ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getMonth() + 1}/${d.getDate()}`
  }

  // 统一动作条（版B·图标+文字 chip）：精选卡片 + 列表卡片共用，风格一致。
  // c 兼容两种形态——完整 content（有 zh_title/permalink）和精选 item（有 title），字段兜底取。
  const actionBar = (c, extra = null) => {
    const cc = { ...c, id: c.id, zh_title: c.zh_title || c.en_title || c.title || '', url: c.url }
    const title = cc.zh_title
    const checked = selIds.has(c.id)
    const openRead = () => { dismissAirHint(); if (c.permalink) window.open(c.permalink, '_blank', 'noopener'); else openReaderById(c.id) }
    return (
      <div className="abar">
        <button className="abtn2 pri" onClick={openRead} title="站内精读（读中文）"><IconBookOpen size={12} /> 精读</button>
        <button className={`abtn2${checked ? ' on' : ''}`} onClick={() => toggleSelect(cc)} title="加入批量解读"><IconCirclePlus size={12} /> {checked ? '已选中' : '选中解读'}</button>
        <button className="abtn2" onClick={async () => { const s = await toggleStar(c.id); showToast?.(s ? '已收藏' : '已取消收藏') }} title="收藏"><IconStar size={12} /> 收藏</button>
        <button className="abtn2" onClick={() => saveIdea?.({ title, sourceKind: 'feed', sourceRef: cc.url || null, supportingContentIds: [c.id] })} title="收进灵感库"><IconBulb size={12} /> 提灵感</button>
        <button className="abtn2" onClick={() => trackFromContent(cc)} title="发起追踪"><IconPlusTrack size={12} /> 追踪</button>
        {cc.url && <a className="abtn2" href={cc.url} target="_blank" rel="noreferrer" title="跳转原文"><IconExternal size={12} /> 原文</a>}
        {extra}
      </div>
    )
  }
  const renderRow = (c) => {
    const checked = selIds.has(c.id)
    const followed = c.source_registered === 1 || c.source_registered === true
    const channel = { aihot: 'AI HOT', hackernews: 'Hacker News', rss: 'RSS', github_trending: 'GitHub Trending' }[c.source_app] || c.source_app
    const author = c.source_display_name || (c.source_app === 'github_trending' ? (c.en_title || '').split('/')[0] : null) || channel
    const title = c.zh_title || c.en_title || '（无标题）'
    const canRead = Boolean(c.permalink) || (c.url && c.content_type !== 'tweet')
    const openRead = () => { dismissAirHint(); if (c.permalink) window.open(c.permalink, '_blank', 'noopener'); else setReaderContent(c) }
    const unread = c.user_read_status !== 'read'
    const badge = c.story_source_count > 1 ? { t: `${c.story_source_count} 源同报`, cls: 'cl' } : ((c.trust_tier === 'T1' || c.trust_tier === 'T1.5') ? { t: '官方一手', cls: 'of' } : null)
    return (
      <div key={c.id} className={`fg-row ${unread ? 'unread' : 'read'}${checked ? ' sel' : ''}`}>
        <span className="tm">{hmOf(c)}</span>
        <span className="src" title={author}>{author}</span>
        <span className="tt" onClick={openRead} title={c.zh_summary ? `${title}\n\n${c.zh_summary}` : title}>{title}</span>
        {badge && <span className={`fg-badge ${badge.cls}`}>{badge.t}</span>}
        <div className="fg-acts">
          {canRead && <button className="read" onClick={openRead} title="站内精读（读中文）">精读</button>}
          <button className="a" title={checked ? '已选中' : '选中解读'} onClick={() => toggleSelect(c)}>{checked ? <IconCheck size={13} /> : <IconCirclePlus size={13} />}</button>
          <button className="a" title="收进灵感" onClick={() => saveIdea?.({ title, sourceKind: 'feed', sourceRef: c.url || null, supportingContentIds: [c.id] })}><IconBulb size={13} /></button>
          <button className="a" title="追踪这个话题" onClick={() => trackFromContent(c)}><IconPlusTrack size={13} /></button>
          <button className="a" title={c.starred ? '取消收藏' : '收藏'} onClick={() => onStar(c)}><IconStar size={13} fill={!!c.starred} /></button>
          {c.url && <a className="a" href={c.url} target="_blank" rel="noreferrer" title="跳转原文" style={{ display: 'inline-flex', alignItems: 'center' }}><IconExternal /></a>}
          {!followed && c.source_id !== undefined && <button className="a" disabled={followingIds?.has(c.id)} title="关注这个来源，以后自动追更" onClick={() => followSource(c.id)}>{followingIds?.has(c.id) ? '…' : '＋关注'}</button>}
        </div>
      </div>
    )
  }

  // 新到分界：上次来访之后的算「新到」，之前的算「来过=已读」自动划线（ADR-045①）
  const lvTime = lastVisit ? (new Date(/[zZ+]/.test(lastVisit) ? lastVisit : lastVisit.replace(' ', 'T') + 'Z').getTime() || 0) : 0
  // 交接单 Fix1：用「入库时间 created_at」判来过，不用发布时间——新登记的博客历史文章发布日期很老，
  // 但刚入库、用户从没见过，按发布时间会被误判「已读」划掉。created_at<=上次来=真来过；> 就是这次才入库=真新到。
  // 注意 created_at 有两种格式：DB datetime('now') 的 "YYYY-MM-DD HH:MM:SS" 和 RSS 的 ISO(带 Z)——
  // 必须都能解析（早前版本对 ISO 又补一个 Z → 双 Z → Invalid Date → 0 → 全被判已读）。
  const parseTs = (s) => { s = s || ''; return new Date(/[zZ+]/.test(s) ? s : s.replace(' ', 'T') + 'Z').getTime() || 0 }
  const ingestOf = (c) => parseTs(c.created_at || c.published_at)
  const isSeen = (c) => lvTime > 0 && ingestOf(c) <= lvTime
  const visitLabel = (iso) => {
    const d = new Date(/[zZ+]/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z'); if (isNaN(d)) return ''
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const now = new Date(); const dd = new Date(now); dd.setDate(now.getDate() - 1)
    if (d.toDateString() === now.toDateString()) return `今天 ${hm}`
    if (d.toDateString() === dd.toDateString()) return `昨天 ${hm}`
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
  }
  const dropStar = async (s) => { await toggleStar(s.id); loadIouStars(); showToast?.('好，放它走了（已取消收藏）') }

  // ADR-045 终版紧凑行：time | 来源 | 标题(hover 行下展开摘要) | 徽章 | 留痕小标 | hover 四动作。
  // 四动作：精读 / 以后再看(★挂账) / 提灵感 / 发起追踪；动作后留痕小标。零点击零打勾。
  // 列表卡片（分类 tab / 最新 / 最热用）：与精选卡片同款卡片式 + 统一动作条（版B），风格一致、清楚
  const renderCard = (c) => {
    const channel = { aihot: 'AI HOT', hackernews: 'Hacker News', rss: 'RSS', github_trending: 'GitHub Trending' }[c.source_app] || c.source_app
    const author = c.source_display_name || (c.source_app === 'github_trending' ? (c.en_title || '').split('/')[0] : null) || channel
    const title = c.zh_title || c.en_title || '（无标题）'
    const summary = c.zh_summary || c.en_summary || ''
    const badge = c.story_source_count > 1 ? { t: `${c.story_source_count} 源同报`, cls: 'cl' } : ((c.trust_tier === 'T1' || c.trust_tier === 'T1.5') ? { t: '官方一手', cls: 'of' } : null)
    return (
      <div key={c.id} className="cf-card">
        <div className="cf-m"><span className="cf-src">{author}</span>·<span>{hmOf(c)}</span>{badge && <span style={{ marginLeft: 6 }}>{badgeEl(c, badge)}</span>}</div>
        <div className="cf-t" onClick={() => openReaderById(c.id)} title="点开站内精读（读中文）">{title}</div>
        {summary && <div className="cf-s">{summary.slice(0, 220)}</div>}
        {storyExpand(c)}
        {actionBar(c)}
      </div>
    )
  }

  const ffRenderRow = (c) => {
    const channel = { aihot: 'AI HOT', hackernews: 'Hacker News', rss: 'RSS', github_trending: 'GitHub Trending' }[c.source_app] || c.source_app
    const author = c.source_display_name || (c.source_app === 'github_trending' ? (c.en_title || '').split('/')[0] : null) || channel
    const title = c.zh_title || c.en_title || '（无标题）'
    const summary = c.zh_summary || c.en_summary || ''
    const mark = feedMarks[c.id]
    const struck = mark === 'read' || (isSeen(c) && !mark)
    // 徽章与扁平 renderRow 保持一致（同一 fg-badge 口径：源同报=amber cl / 官方一手=accent of）
    const badge = c.story_source_count > 1 ? { t: `${c.story_source_count} 源同报`, cls: 'cl' } : ((c.trust_tier === 'T1' || c.trust_tier === 'T1.5') ? { t: '官方一手', cls: 'of' } : null)
    const openRead = () => { dismissAirHint(); if (c.permalink) window.open(c.permalink, '_blank', 'noopener'); else setReaderContent(c); setFeedMarks(m => ({ ...m, [c.id]: 'read' })) }
    const laterRead = async () => { if (!c.starred) await toggleStar(c.id); setFeedMarks(m => ({ ...m, [c.id]: 'star' })); loadIouStars(); showToast?.('挂进「以后再看」，回头会催你') }
    const toIdea = () => { saveIdea?.({ title, sourceKind: 'feed', sourceRef: c.url || null, supportingContentIds: [c.id] }); setFeedMarks(m => ({ ...m, [c.id]: 'idea' })) }
    return (
      <div key={c.id} className={`ff-row${struck ? ' read' : ''}`}>
        <div className="l1">
          <span className="tm">{hmOf(c)}</span>
          <span className="src" title={author}>{author}</span>
          <span className="tt" onClick={openRead} title={summary ? `${title}\n\n${summary}` : title}>{title}</span>
          {badge && <span className={`fg-badge ${badge.cls}`}>{badge.t}</span>}
          {mark === 'read' && <span className="ff-mark read"><IconCheck size={11} /> 精读过</span>}
          {mark === 'star' && <span className="ff-mark star"><IconStar size={11} /> 以后再看</span>}
          {mark === 'idea' && <span className="ff-mark idea"><IconBulb size={11} /> 已提灵感</span>}
          <div className="acts">
            <button className="ff-abtn pri" onClick={openRead} title="站内精读（读中文，原文在阅读器里）"><IconBookOpen size={12} /> 精读</button>
            <button className="ff-abtn" onClick={laterRead} title="挂进「以后再看」，回头催你读"><IconStar size={12} /> 以后再看</button>
            <button className="ff-abtn" onClick={toIdea} title="收进灵感库"><IconBulb size={12} /> 提灵感</button>
            <button className="ff-abtn" onClick={() => trackFromContent(c)} title="以它为主角起一个追踪主题"><IconPlusTrack size={12} /> 发起追踪</button>
          </div>
        </div>
        {summary && <div className="sum">{summary.slice(0, 220)}</div>}
      </div>
    )
  }

  return (
    <>
      <div className="wb-brief">
        <div className="wb-brief-head">
          <div className="wb-brief-title" onClick={toggleBrief} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} title={briefOpen ? '收起今日概览' : '展开今日概览（必看/热点/选题）'}>
            <IconChevronRight size={13} style={{ transform: briefOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s', flexShrink: 0 }} />
            今日概览 · {report ? formatDate(report.period_key) : dateLabel}
            {!briefOpen && report && <span style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 400 }}>· 点开看必看/热点/选题</span>}
            {staleReport && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--amber)', fontWeight: 500 }}>· 显示的是 {formatDate(report.period_key)} 的，点刷新出今天的</span>}
          </div>
          <div className="wb-brief-links">
            {report && briefOpen && (
              <button className="wb-brief-link" disabled={generating} onClick={generateReport}
                title="用最新同步的数据重新生成当天日报（Deepseek，约 ¥0.002）">
                {generating ? '刷新中…' : '↻ 刷新'}
              </button>
            )}
            {briefOpen && <><button className="wb-brief-link" onClick={() => setPage('reports')}>查看周报</button>
            <button className="wb-brief-link" onClick={() => setPage('reports')}>查看月报</button></>}
          </div>
        </div>

        {/* 一句话总结（露出日报导语；收起态也保留，作为概览的精华一行） */}
        {report?.summary && <div className="wb-lead" style={briefOpen ? undefined : { marginBottom: 0 }}>一句话总结：<b>{report.summary}</b></div>}

        {briefOpen && <>{/* 展开区：必看 / 热点 / 选题入口 */}

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
                      <span onClick={() => openReaderById(m.id)} title="点开站内精读（读中文，原文在阅读器里）"
                        style={{ fontFamily: 'var(--serif)', fontWeight: 600, fontSize: 13.5, color: 'var(--body)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                        onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'} onMouseOut={e => e.currentTarget.style.color = 'var(--body)'}>{m.title}</span>
                      <div style={{ fontSize: 11.5, color: industry ? '#8a6a1a' : 'var(--accent)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ display: 'inline-flex', flexShrink: 0 }}>{industry ? <IconMegaphone size={12} /> : <IconSparkle size={12} />}</span>
                        {m.anchor
                          ? <>贴合你近期在看的<span onClick={() => openAnchor(m.anchor)} title={m.anchor.kind === 'note' ? '打开这条素材卡' : '打开这条的站内精读'} style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}>《{(m.anchor.title || '').slice(0, 16)}》</span></>
                          : m.reason}
                      </div>
                    </div>
                    <button title="不感兴趣：以后少推这个来源/这条（只过滤，不会拿去自动调权重）" onClick={() => muteMustRead(m)}
                      style={{ flex: 'none', border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', padding: '2px 4px', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}><IconX size={12} /></button>
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
                          <span onClick={() => openReaderById(m.id)} title="站内精读（读中文）" style={{ cursor: 'pointer' }}
                            onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}>
                            {(m.zh_title || m.en_title || '').slice(0, 40)}
                          </span>
                          {m.url && <a href={m.url} target="_blank" rel="noreferrer" title="跳转原文" style={{ color: 'var(--faint)', marginLeft: 6 }} onClick={e => e.stopPropagation()}><IconExternal size={9} style={{ verticalAlign: '-1px' }} /></a>}
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
        </>}
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
            <button className={feedTab === 'starred' ? 'active' : ''} onClick={() => setFeedTab('starred')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><IconStar size={12} /> 收藏</button>
          </div>
          <input className="wb-feed-search" placeholder="搜索资讯（空格分隔多关键词）…"
            value={feedQuery} onChange={(e) => setFeedQuery(e.target.value)} />
          <select className="wb-filter-chip" style={{ flexShrink: 0 }} value={sortMode} onChange={(e) => setSort(e.target.value)}
            title="一手优先=按原料价值分组（官方一手→你关注的人→精选热点→其他）；最新=按发布时间；最热=按热度分">
            <option value="firsthand">排序：一手优先</option>
            <option value="latest">排序：最新</option>
            <option value="hot">排序：最热</option>
          </select>
          <span className="wb-feedbar-count">共 {(filtered ?? contents).length} 条{hasFilter ? '（筛选中）' : ''}</span>
          <button className="wb-brief-link" disabled={syncing} onClick={syncAllSources}
            title="同步全部信源：AI HOT + RSS 抓取 + B站/YouTube/GitHub 主动查询">
            {syncing ? '同步中…' : '↻ 同步'}
          </button>
        </>)}
      </div>

      {/* 同步状态一行（P0-7）：让"每天自动同步一直在跑"这件事被看见——不再让用户误以为要手动同步 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 2px 12px', fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.5 }}>
        <span aria-hidden="true" style={{ display: 'inline-flex', flexShrink: 0 }}><IconRefresh size={12} /></span>
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
          <div className="wb-empty">{feedTab === 'starred' && !feedQuery.trim() ? '还没有收藏。在卡片右上角点收藏一键钉住，事后有用再升级为素材。' : '没有匹配的内容'}</div>
        )}

        {/* 第三刀·精选优先：只在「全部」视图（无筛选无分类）顶部；分类 tab 点进去=纯完整列表（方案甲） */}
        {!hasFilter && curated.length > 0 && (<>
          <div className="cf-recipe">
            <span>本轮精选：<b>你登记的一手源新作</b> · <b>今日多源大事</b> · 官方发布 —— 逻辑透明、每条标了为什么入选，随时可调</span>
            <button className="gear" onClick={openConfig}>⚙ 调精选</button>
          </div>
          <div className="cf-secttl">本轮 AI 精选 <span className="cf-n">{curated.length}</span></div>
          {curated.map(c => (
            <div key={c.id} className="cf-card">
              <button className="cf-x" title="不感兴趣" onClick={() => setCurMenu(curMenu === c.id ? null : c.id)}><IconX size={14} /></button>
              {curMenu === c.id && (
                <div className="cf-menu">
                  <div className="cf-mt">这条不太对？告诉我不要什么：</div>
                  <button onClick={() => curateMute({ contentId: c.id }, '好，不看这条了')}>✕ 不看这条</button>
                  {c.sourceId && <button onClick={() => curateMute({ sourceId: c.sourceId }, `以后少推「${c.src}」`)}>↓ 少推「{c.src}」</button>}
                  {c.category && <button onClick={() => curateMute({ category: c.category }, `以后少推「${c.category}」类`)}>⊘ 少推「{c.category}」这类</button>}
                </div>
              )}
              <div className="cf-m"><span className="cf-src">{c.src}</span>·<span>{c.pub}</span></div>
              <div className="cf-t" onClick={() => openReaderById(c.id)}>{c.title}</div>
              {c.summary && <div className="cf-s">{c.summary}</div>}
              <div className="cf-f">
                {badgeEl(c, c.badge)}
                <span className="cf-why">入选：{c.why}</span>
              </div>
              {storyExpand(c)}
              {actionBar(c)}
            </div>
          ))}
          <div className="cf-seeall" onClick={() => setShowAll(s => !s)}>{showAll ? '▲ 收起，回到精选' : '▽ 查看全部（完整分组：官方一手 / 你登记的源 / 精选热点）'}</div>
        </>)}

        {/* ADR-045 终版：一手优先=四组分层 + 新到分界 + ★挂账催办；最新/最热=扁平紧凑行。像素级复刻 feed-final-mock。 */}
        {/* 精选优先（方案甲）：「全部」视图默认只给精选，点「查看全部」才展开完整列表；有筛选/分类直接列表 */}
        {(!hasFilter && !showAll) ? null : (<>
          {/* 需求2·话题卡：今日多源大事合并 + AI 综合总结（只在全部视图的「查看全部」里） */}
          {!hasFilter && topicCards.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="tc-secttl">今日多源大事 <span className="cf-n">{topicCards.length}</span><span className="hint">同一件事多源报道·已合并去重</span></div>
              {topicCards.map(tc => (
                <div key={tc.id} className="tc-card">
                  <div className="tc-h" style={{ cursor: 'pointer' }} onClick={() => tc.members[0] && openReaderById(tc.members[0].id)}>{tc.headline}</div>
                  {tc.digest && <div className="tc-d">{tc.digest}</div>}
                  <span className="tc-src" onClick={() => setOpenTopic(o => ({ ...o, [tc.id]: !o[tc.id] }))}>{tc.sourceCount} 个源报道了这件事 {openTopic[tc.id] ? '▴' : '▾'}</span>
                  {openTopic[tc.id] && (
                    <div className="tc-members">
                      {tc.members.map(m => (
                        <div key={m.id} className="cf-mrow">
                          <span className="cf-msrc">{(m.tier === 'T1' || m.tier === 'T1.5') ? '★ ' : ''}{m.src}</span>
                          <span className="cf-mt" onClick={() => openReaderById(m.id)} title="站内精读">{m.title}</span>
                          {m.url && <a href={m.url} target="_blank" rel="noreferrer" style={{ color: 'var(--faint)', flexShrink: 0 }}><IconExternal size={11} /></a>}
                        </div>
                      ))}
                    </div>
                  )}
                  {tc.members[0] && actionBar(tc.members[0])}
                </div>
              ))}
            </div>
          )}
          {sortMode === 'firsthand' && !hasFilter ? (() => {
            const topicIds = new Set(topicCards.flatMap(tc => tc.members.map(m => m.id)))
            const src = (filtered ?? contents).filter(c => !topicIds.has(c.id))
            const groups = groupContents(src)
          const GH = {
            1: { icon: <IconPin />, t: '官方一手', cls: 'g1', what: '官方 blog + 官方号/员工号' },
            2: { icon: <IconTarget />, t: '你登记的一手信源', cls: 'g2', what: '你主动登记关注的博客 / X / YouTube / 播客' },
            3: { icon: <IconFlame />, t: '精选与热点', cls: 'g3', what: 'AI HOT 精选 + 事件簇主条（已去重）' },
          }
          const newOf = (k) => groups[k].filter(c => !isSeen(c)).length
          const totalNew = newOf(1) + newOf(2) + newOf(3) + groups[4].filter(c => !isSeen(c)).length
          return <>
            {/* 状态行：上次来 X · 之后新到 N 条 */}
            <div className="ff-status">
              {lastVisit
                ? <><span>上次来 <b>{visitLabel(lastVisit)}</b> · 之后新到 <b>{totalNew}</b> 条</span><span className="dim">一手 {newOf(1)} · 关注 {newOf(2)} · 精选 {newOf(3)}</span></>
                : <span>首次到访 · 共 <b>{src.length}</b> 条，先从「官方一手」开始</span>}
            </div>
            {/* ★挂账催办（只做「以后再看」，含挂账天数 + 现在读/放它走；原≥3天催办已作废） */}
            {iouStars.length > 0 && (
              <div className="ff-iou">
                <IconStar fill size={13} />
                <span>你挂的「以后再看」还有 <b>{iouStars.length} 条</b>：
                  {iouStars.slice(0, 3).map((s, i) => { const d = daysSince(s.starred_at); return (
                    <span key={s.id}>{i > 0 && ' · '}<a className={d >= 7 ? 'late' : ''} onClick={() => openReaderById(s.id)} title="现在就读这条">「{(s.zh_title || s.en_title || '').slice(0, 14)}」{d >= 7 ? '已挂' : '挂'} {d} 天</a></span>
                  ) })}
                  {iouStars.length > 3 && ` 等 ${iouStars.length} 条`}
                  {' —— '}<a onClick={() => openReaderById(iouStars[0].id)}>现在读</a>{' 或 '}<a onClick={() => dropStar(iouStars[0])}>放它走</a>
                </span>
              </div>
            )}
            {/* 三组分层：每组新到在前，「之前的」折叠 */}
            {[1, 2, 3].map(k => {
              if (!groups[k].length) return null
              const news = groups[k].filter(c => !isSeen(c))
              const olds = groups[k].filter(isSeen)
              const g = GH[k]
              return (
                <div key={k} className={`ff-grp ${g.cls}`}>
                  <div className="ff-ghead">
                    <span className="gt">{g.icon}{g.t}</span>
                    {news.length ? <span className="gnew">新 {news.length}</span> : <span className="gnone">无新</span>}
                    <span className="gwhat">{g.what}</span>
                  </div>
                  {news.map(ffRenderRow)}
                  {olds.length > 0 && <>
                    <div className="ff-oldbar" onClick={() => setOpenOld(o => ({ ...o, [k]: !o[k] }))}>{openOld[k] ? '▾' : '▸'} 之前的 {olds.length} 条{openOld[k] ? '' : '（来过的，已划掉）'}</div>
                    {openOld[k] && <div className="ff-oldlist">{olds.map(ffRenderRow)}</div>}
                  </>}
                </div>
              )
            })}
            {/* 组4 其他：默认折叠 */}
            {groups[4].length > 0 && (
              <div className="ff-g4head" onClick={() => setOtherOpen(o => !o)}>
                {otherOpen ? '▾' : '▶'} 其他 · {groups[4].length} 条（GitHub trending / 二手报道）—— 想逛再点开
              </div>
            )}
            {otherOpen && groups[4].length > 0 && <div className="ff-grp" style={{ marginTop: 4 }}>{groups[4].map(ffRenderRow)}</div>}
            <div className="ff-note">按「原料价值」分层：官方一手 › 你关注的人 › 精选热点 › 其他 · 来过的自动划掉，新到的排在每组最前</div>
          </>
          })() : (
            <div className="wb-feed-list">{sortContents(filtered ?? contents).map(renderCard)}</div>
          )}
        </>)}
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
                    <button className={`wb-star${(ghStar[r.id] ?? r.starred) ? ' on' : ''}`} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }}
                      title="收藏（收藏后进「文章 › 收藏」）"
                      onClick={async () => { const s = await toggleStar(r.id); if (s !== null) setGhStar(prev => ({ ...prev, [r.id]: s })) }}>
                      <IconStar size={14} fill={!!(ghStar[r.id] ?? r.starred)} />
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

      {cfgOpen && (
        <div className="wb-modal-mask" onClick={(e) => { if (e.target === e.currentTarget) setCfgOpen(false) }}>
          <div className="wb-modal" style={{ maxWidth: 480 }}>
            <div className="wb-modal-head">
              <div className="wb-modal-title">⚙ 调精选 · 你说了算</div>
              <button className="wb-modal-close" style={{ marginLeft: 'auto' }} onClick={() => setCfgOpen(false)}>×</button>
            </div>
            {!cfg ? <div style={{ padding: 20, color: 'var(--sub2)', textAlign: 'center' }}>加载中…</div> : (
              <div style={{ overflowY: 'auto' }}>
                <div className="cfg-grp">必进精选的源（点掉 = 不必进精选）</div>
                <div>{cfg.sources.map(s => <span key={s.id} className={`cfg-chip ${s.muted ? 'mute' : 'on'}`} onClick={() => toggleMute({ sourceId: s.id, on: !s.muted })}>{s.name}</span>)}</div>
                <div className="cfg-grp">重点看 / 屏蔽的主题（划掉 = 少推这类）</div>
                <div>{cfg.categories.map(c => <span key={c.name} className={`cfg-chip ${c.muted ? 'mute' : 'on'}`} onClick={() => toggleMute({ category: c.name, on: !c.muted })}>{c.name}</span>)}</div>
                {cfg.mutedSources.filter(m => !cfg.sources.find(s => s.id === m.id)).length > 0 && (<>
                  <div className="cfg-grp">被你少推的其他源（点 = 恢复）</div>
                  <div>{cfg.mutedSources.filter(m => !cfg.sources.find(s => s.id === m.id)).map(m => <span key={m.id} className="cfg-chip mute" onClick={() => toggleMute({ sourceId: m.id, on: false })}>{m.name}</span>)}</div>
                </>)}
                <div className="cfg-note">点亮 = 进精选，划掉 = 少推。所有反馈可撤销——精选是你的过滤器，不是猜你口味的算法。改完精选即时更新。</div>
              </div>
            )}
          </div>
        </div>
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
