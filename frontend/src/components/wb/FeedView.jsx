import { useState, useEffect, useRef } from 'react'
import { timeAgo, TYPE_LABEL, api } from './util'
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
              {/* 渲染成干净排版，不露 markdown 符号（用户 2026-07-18 确认） */}
              <div className="wb-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(interp.data.text) }} />
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
  contents, report, stories, ghTrending, selectedItems, toggleSelect, followSource, followingIds, acquire, uploadFile,
  generateReport, generating, setPage, setNotesTab, syncing, syncAllSources,
  toggleStar, showToast, loadNotes, setReturnPage,
}) {
  const [acquireVal, setAcquireVal] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [uploading, setUploading] = useState(null) // 上传/转写进度 { status, kind, filename, elapsedSec, error }
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const onFileChosen = async (file) => {
    if (!file || !uploadFile) return
    const isAudio = /\.(mp3|m4a|wav|aac|ogg|opus|flac)$/i.test(file.name) || (file.type || '').startsWith('audio')
    setUploading({ status: 'processing', kind: isAudio ? 'audio' : 'file', filename: file.name, elapsedSec: 0 })
    const ok = await uploadFile(file, (job) => setUploading(job))
    if (ok) setUploading(null) // 完成→已进右栏解读，收起进度条
  }
  const [expandedFocus, setExpandedFocus] = useState(null) // 默认全收起（UI 改造：第 1 条摊开挤掉后两条）
  const [readerContent, setReaderContent] = useState(null) // 站内全文阅读器
  const [ghStar, setGhStar] = useState({}) // GitHub 区块星标的本地覆盖（数据源在 ghTrending，父级不重载）
  const [mainTab, setMainTab] = useState('articles') // 'articles' | 'projects'（UI 改造：文章/AI项目分开）
  const [airHint, setAirHint] = useState(() => !localStorage.getItem('wb-seen-airead-hint')) // 「AI 精读」首次说明气泡
  const dismissAirHint = () => { localStorage.setItem('wb-seen-airead-hint', '1'); setAirHint(false) }
  const [leadOpen, setLeadOpen] = useState(() => localStorage.getItem('wb-ov-lead-collapsed') !== '1') // 概览两栏领起句可折叠
  const toggleLead = () => setLeadOpen(o => { localStorage.setItem('wb-ov-lead-collapsed', o ? '1' : '0'); return !o })

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
  const [recs, setRecs] = useState([]) // 为你推荐（后端向量匹配主题，读缓存）
  const hasFilter = feedTab === 'starred' || Boolean(feedQuery.trim()) || Boolean(artCat)
  useEffect(() => {
    api('/api/contents/categories').then(j => setArtCatCounts(j.data || {})).catch(() => {})
    api('/api/recommendations').then(j => setRecs(j.data || [])).catch(() => {})
  }, [])
  useEffect(() => {
    if (!hasFilter) { setFiltered(null); return }
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: '200' })
        if (feedQuery.trim()) params.set('q', feedQuery.trim())
        if (feedTab === 'starred') params.set('starred', '1')
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
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const staleReport = report && report.period_key !== todayKey // 显示的是往日报告（补跑未及时）
  const ideas = (report?.ideas || []).filter(i => i.status === 'suggested' || i.status === 'adopted')
  const selIds = new Set(selectedItems.map(x => x.id))
  // 项目分类（客户端，只 10 条）：计数 + 按 chip 筛选
  const projCounts = (ghTrending.repos || []).reduce((a, r) => { const k = r.category || '其他'; a[k] = (a[k] || 0) + 1; return a }, {})
  const shownRepos = projCat ? (ghTrending.repos || []).filter(r => (r.category || '其他') === projCat) : (ghTrending.repos || [])

  return (
    <>
      {/* Hero 即时分析（方案 A）：粘链接/文字 + 上传音频/PDF + 拖拽，黄金路径第①步入口 */}
      <div className={`wb-hero${dragOver ? ' dragover' : ''}`}
        onDragOver={(e) => { if (uploadFile) { e.preventDefault(); setDragOver(true) } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFileChosen(f) }}>
        <div className="wb-hero-t">把任何链接 / 会议纪要 / 音频 / PDF 丢进来，AI 帮你读懂并存成素材</div>
        <div className="wb-hero-d">从「信息」到「你的认知」的入口——出精读稿 → 一键存为素材</div>
        {uploading ? (
          <div className="wb-uploading">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{uploading.kind === 'audio' ? '音频' : '文档'}：{uploading.filename}</span>
              <span className="wb-hero-d" style={{ marginLeft: 'auto', marginBottom: 0 }}>{uploading.status === 'error' ? '' : '本地处理 · 不上传云端'}</span>
            </div>
            {uploading.status === 'error'
              ? <div className="wb-warnbar" style={{ marginTop: 8 }}>处理失败：{uploading.error}
                  <button className="wb-brief-link" style={{ marginLeft: 8 }} onClick={() => setUploading(null)}>关闭</button></div>
              : <>
                  <div className="wb-progress"><i /></div>
                  <div className="wb-hero-d" style={{ marginBottom: 0 }}>
                    {uploading.kind === 'audio' ? `正在本地转写全程…已 ${uploading.elapsedSec || 0}s · 会议音频需要几分钟，完成后自动进入解读，你可以先去干别的` : '正在抽取文字…'}
                  </div>
                </>}
          </div>
        ) : (
          <>
            <div className="wb-hero-row">
              <input type="file" ref={fileInputRef} style={{ display: 'none' }}
                accept="audio/*,.pdf,.md,.markdown,.txt,.docx,.mp3,.m4a,.wav,.aac,.ogg"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChosen(f); e.target.value = '' }} />
              <button className="wb-hero-clip" title="上传音频 / PDF（也可把文件拖到这里）"
                onClick={() => fileInputRef.current?.click()}>＋</button>
              <input
                value={acquireVal}
                onChange={(e) => setAcquireVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doAcquire() }}
                placeholder="粘贴链接，或直接粘贴大段文字（会议纪要…）"
              />
              <button className="wb-btn-primary" disabled={!acquireVal.trim() || ingesting} onClick={doAcquire}>
                {ingesting ? '抓取中…' : '读懂它 →'}
              </button>
            </div>
            <div className="wb-hero-d" style={{ marginTop: 9, marginBottom: 0 }}>
              支持：网页 / 公众号 / YouTube / 小宇宙 / B站 链接 · 会议纪要等大段文字 · 上传 音频（转全程）/ PDF / Markdown / Word · 也可把文件拖到这里
            </div>
          </>
        )}
      </div>

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

        {recs.length > 0 && (leadOpen ? (
          <div className="wb-ov-lead">
            左边是<b>今天多个信息源都在说的热点</b>，右边是<b>按你关注的主题挑给你的</b>——一个看大盘、一个看你自己。
            <button className="wb-ov-lead-x" title="收起说明" onClick={toggleLead}>收起 ▴</button>
          </div>
        ) : (
          <button className="wb-ov-lead-toggle" onClick={toggleLead}>两栏有啥区别？▾</button>
        ))}
        <div className={recs.length ? 'wb-ov-cols' : ''}>
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
        </div>
        {recs.length > 0 && (
          <div>
            <div className="wb-brief-label">为你精选 · 命中你关注的主题</div>
            {recs.map(r => (
              <div key={r.id} className="wb-rec">
                <div className="wb-rec-t"><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></div>
                <div className="wb-rec-why">{r.reason}</div>
              </div>
            ))}
          </div>
        )}
        </div>

        {report ? (
          // 选题入口 + 行业动态跳转（行业动态不再在此重复列 item，只留一句+跳 AI HOT，去重）
          <div className="wb-ov-foot">
            <button className="wb-brief-link" onClick={() => { setReturnPage?.('feed'); setNotesTab?.('ideas'); setPage('notes') }}>
              选题建议 {ideas.length} 条 → 去素材库
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
          <span className="wb-feedbar-count">共 {(filtered ?? contents).length} 条{hasFilter ? '（筛选中）' : ''}</span>
          <button className="wb-brief-link" disabled={syncing} onClick={syncAllSources}
            title="同步全部信源：AI HOT + RSS 抓取 + B站/YouTube/GitHub 主动查询">
            {syncing ? '同步中…' : '↻ 同步'}
          </button>
        </>)}
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

        <div className="wb-feed-grid">
          {sortContents(filtered ?? contents).map(c => {
            const checked = selIds.has(c.id)
            const followed = c.source_registered === 1 || c.source_registered === true
            const channel = { aihot: 'AI HOT', hackernews: 'Hacker News', rss: 'RSS', github_trending: 'GitHub Trending' }[c.source_app] || c.source_app
            const repoOwner = c.source_app === 'github_trending' ? (c.en_title || '').split('/')[0] : null
            const author = c.source_display_name || repoOwner || channel
            const canRead = Boolean(c.permalink) || (c.url && c.content_type !== 'tweet')
            const openRead = () => { dismissAirHint(); if (c.permalink) window.open(c.permalink, '_blank', 'noopener'); else setReaderContent(c) }
            return (
              <div key={c.id} className={`wb-gcard${checked ? ' selected' : ''}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                  {followed
                    ? <span className="wb-pill" style={{ color: '#3f7350', background: 'rgba(63,115,80,.12)' }}>已关注</span>
                    : <span className="wb-pill" style={{ color: '#8a8478', background: 'rgba(33,31,26,.06)' }}>未标注</span>}
                  <span style={{ color: 'var(--sub)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{author}</span>
                  <span style={{ color: 'var(--faint)', flexShrink: 0 }}>· {timeAgo(c.published_at)}</span>
                  {c.category && <span className="wb-cat">{c.category}</span>}
                  <button className={`wb-star${c.starred ? ' on' : ''}`} style={{ marginLeft: 'auto' }}
                    title={c.starred ? '取消收藏' : '收藏：一键钉住，事后找得回'} onClick={() => onStar(c)}>{c.starred ? '★' : '☆'}</button>
                </div>
                <div className="wb-gcard-title">{c.zh_title || c.en_title || '（无标题）'}</div>
                {c.zh_summary && <div className="wb-gcard-sum">{c.zh_summary}</div>}
                <div className="wb-gcard-foot">
                  {canRead && <button className="wb-btn-primary" style={{ padding: '4px 12px', fontSize: 12 }}
                    title="AI 帮你读懂这篇，出精读稿，不用啃原文" onClick={openRead}>AI 精读</button>}
                  <button className="wb-btn-ghost" style={{ padding: 0 }} title="送入右侧一起解读/对话"
                    onClick={() => toggleSelect(c)}>{checked ? '✓ 已选中' : '选中解读'}</button>
                  {c.url && <a className="wb-btn-ghost" style={{ padding: 0, display: 'inline-flex', alignItems: 'center' }}
                    href={c.url} target="_blank" rel="noreferrer" title="跳转原文"><IconExternal /></a>}
                  {!followed && c.source_id !== undefined && (
                    <button className="wb-btn-ghost" style={{ padding: 0, marginLeft: 'auto', fontSize: 11.5 }}
                      disabled={followingIds?.has(c.id)} onClick={() => followSource(c.id)} title="关注这个作者/来源，以后自动追更">
                      {followingIds?.has(c.id) ? '识别中…' : '＋ 关注'}
                    </button>
                  )}
                </div>
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
