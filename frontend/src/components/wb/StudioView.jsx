import { useState, useRef, useEffect } from 'react'
import { IconWarn, IconBolt } from './Icons'
import { api } from './util'
import FeishuPicker from './FeishuPicker'

// 创作台（视觉对齐原型 06-studio）：平台模板分段 + 衬线草稿区 + 溯源警示 + 复制/导出。
// 平台列表动态化（P1）：来自 /api/studio/platforms（reference/prompts/creation/platforms/
// 目录扫描）——加一个 md 文件，这里自动多一个按钮。
// P2 修改工具包（设计红线：AI 产出先以建议形态出现，用户点了才写入草稿）：
// - 审稿：三个批评人格通读全稿 → 批注列表，每条可「按此修改」
// - 3 个改法：草稿区选中一段 → 三个策略不同的候选卡，挑一个原位替换

const RETURN_LABEL = { feed: '资讯', notes: '素材库', topics: '主题库', reports: '周报', inspirations: '灵感库' }

export default function StudioView({ studio, setStudio, platforms, genDraft, exportMd, setPage, showToast, drafts, saveDraft, openDraft, humanizeDraft, undoRewrite, deleteCurrentDraft, deleteDrafts, suggestTitles, gotoTopic, returnPage, goBack, removeRef, studioTab, setStudioTab, adapted, setAdapted, filmActiveForm, setFilmActiveForm }) {
  const platformIcon = (key) => platforms.find(p => p.key === key)?.icon || '📝'

  // ── ADR-026 试新版：文体(genre) × 平台形态(platform-form)，与老平台行完全并存 ──
  const [v2Mode] = useState(true)   // 老版已删，v2 为唯一创作流
  const [genres, setGenres] = useState([])
  const [pforms, setPforms] = useState([])
  const [v2Genre, setV2Genre] = useState('读书精读体')   // 默认=推荐
  const [v2Pform, setV2Pform] = useState('gzh-long')
  const [voices, setVoices] = useState([])              // ADR-052 P3 声音层（可选）
  const [v2Voice, setV2Voice] = useState('')            // '' = 无声音（默认，行为不变）
  const vLabel = k => voices.find(v => v.key === k)?.label || k
  // ADR-052 P4 联动：一次「系列风格」→ 头图皮肤 + 排版主题 + 默认声音（声音仍可覆盖=软绑定）
  const [seriesPresets, setSeriesPresets] = useState([])
  const [seriesPreset, setSeriesPreset] = useState('')  // '' = 无（各自手选）
  const curPreset = seriesPresets.find(p => p.id === seriesPreset) || null
  const pickSeries = (id) => {
    setSeriesPreset(id)
    const p = seriesPresets.find(x => x.id === id)
    if (p) { setV2Voice(p.default_voice || ''); showToast(`已按「${p.name}」联动：头图皮肤 + 排版主题 + 声音（声音可再改）`) }
    else showToast('已取消系列风格联动')
  }
  const [openDD, setOpenDD] = useState(null)            // 'genre' | 'platform' | null
  const [combosOpen, setCombosOpen] = useState(false)
  const [recReason, setRecReason] = useState('')        // 推荐理由（基于素材）
  const [recPinned, setRecPinned] = useState(false)     // 用户手动改过 → 不再自动覆盖
  const gLabel = k => genres.find(g => g.key === k)?.label || k
  // 母稿固定用「公众号·长文」形态（最厚那版）；平台裂变移到「③ 出片」多选。定稿只挑文体。
  // 阶段3 溯源态：只读渲染草稿，[素材N] 可点 → 高亮左栏对应引用
  const [srcMode, setSrcMode] = useState(false)
  const [activeRef, setActiveRef] = useState(null)
  const renderTraced = () => String(studio.draft || '').split(/(\[素材\d+\])/g).map((p, i) => (
    /^\[素材\d+\]$/.test(p)
      ? <span key={i} onClick={() => setActiveRef(activeRef === p ? null : p)}
          style={{ color: activeRef === p ? '#fff' : 'var(--accent)', background: activeRef === p ? 'var(--accent)' : 'rgba(61,90,128,.1)', borderRadius: 5, padding: '1px 5px', fontFamily: 'system-ui', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>{p}</span>
      : <span key={i}>{p}</span>
  ))
  useEffect(() => {
    if (!v2Mode || genres.length) return
    ;(async () => {
      try {
        const [g, p, v, sp] = await Promise.all([api('/api/studio/genres'), api('/api/studio/platform-forms'), api('/api/studio/voices'), api('/api/studio/series-presets')])
        setGenres(g.data || []); setPforms(p.data || []); setVoices(v.data || []); setSeriesPresets(sp.data || [])
      } catch (err) { showToast('文体/平台形态加载失败：' + err.message) }
    })()
  }, [v2Mode])
  // 阶段1·B：从整个素材库挑（不必先有主题），默认不选，可搜；生成只用勾中的
  const [mats, setMats] = useState([])
  const [selMat, setSelMat] = useState(new Set())
  const [expMat, setExpMat] = useState(new Set())  // 素材台「展开全文」态（ADR-039 取料截断修复）
  const [matQ, setMatQ] = useState('')
  useEffect(() => {
    if (!v2Mode) return
    ;(async () => {
      try { const j = await api('/api/materials'); setMats(j.data || []) } catch { /* 静默 */ }
    })()
  }, [v2Mode])
  // 断链修复（P0-1）：从主题「开始创作」进来 → 预取该主题下已归位素材并自动勾选，
  // 透明标注"已带主题《X》的 N 条，可增减"。每个 sourceTopicId 只带一次，用户之后增减不覆盖。
  const [topicPreload, setTopicPreload] = useState(null) // { name, count }
  const preloadedTopicRef = useRef(null)
  useEffect(() => {
    if (!v2Mode) return
    const tid = studio.sourceTopicId
    if (!tid) { preloadedTopicRef.current = null; setTopicPreload(null); return }
    if (preloadedTopicRef.current === tid) return
    preloadedTopicRef.current = tid
    ;(async () => {
      try {
        const j = await api(`/api/topics/${tid}/materials`)
        const list = j.data || []
        if (!list.length) { setTopicPreload(null); return }
        setMats(prev => { const have = new Set(prev.map(m => m.id)); return [...list.filter(m => !have.has(m.id)), ...prev] })
        setSelMat(new Set(list.map(m => m.id)))
        setTopicPreload({ name: String(studio.source || '').replace(/^Topic：/, '').trim() || '该主题', count: list.length })
      } catch { /* 静默：拉不到就退回手选 */ }
    })()
  }, [studio.sourceTopicId, v2Mode])
  const toggleMat = id => setSelMat(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  // A+：缺素材当场「+新增」写进 notes 库；起稿后某条素材可「插入」正文（不重新生成）
  const [addOpen, setAddOpen] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [addText, setAddText] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [fsOpen, setFsOpen] = useState(false) // 「从飞书取料」面板（ADR-039）
  // 从飞书拉一篇文档 → 抓正文 → 存成素材并选中（复用 addNote 的落库+刷新逻辑）
  const takeFeishuAsNote = async (item) => {
    try {
      const a = await api('/api/feishu/analyze', { method: 'POST', body: { objType: item.objType, feishuId: item.feishuId, extra: item.extra, title: item.title, url: item.url } })
      if (!a.success) { showToast('飞书抓取失败：' + (a.error || '')); return }
      const j = await api('/api/notes', { method: 'POST', body: { excerpt: a.data.zhBody, sourceTitle: a.data.zhTitle, sourceUrl: a.data.url || null, noteType: 'chat' } })
      const id = j.data?.id
      const mj = await api('/api/materials'); setMats(mj.data || [])
      if (id) setSelMat(s => new Set([...s, id]))
      setFsOpen(false)
      showToast(`已把《${a.data.zhTitle}》拉进素材台并选中`)
    } catch (err) { showToast('从飞书取料失败：' + err.message) }
  }
  const addNote = async () => {
    if (!addText.trim()) { showToast('先粘一段素材文字'); return }
    setAddBusy(true)
    try {
      const j = await api('/api/notes', { method: 'POST', body: { excerpt: addText.trim(), sourceTitle: addTitle.trim() || addText.trim().slice(0, 18), noteType: 'chat' } })
      const id = j.data?.id
      const mj = await api('/api/materials'); setMats(mj.data || [])
      if (id) setSelMat(s => new Set([...s, id]))
      setAddOpen(false); setAddTitle(''); setAddText('')
      showToast('已新增素材并选中')
    } catch (err) { showToast('新增失败：' + err.message) }
    setAddBusy(false)
  }
  const insertMat = (m) => {
    const label = m.sourceTitle || '素材'
    setStudio(s => ({
      ...s,
      draft: (s.draft ? s.draft + '\n\n' : '') + `> ${m.excerpt}\n  —— 引自《${label}》（可溯源）`,
      refs: [...(s.refs || []), { note: label, para: '引块' }],
      paragraphRefs: [...(s.paragraphRefs || []), { marker: '引块', noteId: m.id, sourceTitle: label, contentId: null }],
    }))
    showToast(`已把《${label}》插入正文`)
  }
  const matsShown = matQ.trim()
    ? mats.filter(m => (`${m.sourceTitle} ${m.excerpt}`).toLowerCase().includes(matQ.trim().toLowerCase()))
    : mats
  // 素材变了 → 启发式推荐文体（用户手动改过则只更新理由、不覆盖选择）
  useEffect(() => {
    if (!v2Mode || selMat.size === 0) { setRecReason(''); return }
    let cancelled = false
    ;(async () => {
      try {
        const j = await api('/api/materials/recommend', { method: 'POST', body: { selectedNoteIds: [...selMat] } })
        if (cancelled) return
        const r = j.data || {}
        setRecReason(r.reason || '')
        if (!recPinned) { if (r.genre) setV2Genre(r.genre); if (r.platformForm) setV2Pform(r.platformForm) }
      } catch { /* 静默 */ }
    })()
    return () => { cancelled = true }
  }, [selMat, v2Mode])
  const genDraftV2 = async () => {
    if (!v2Genre) { showToast('先选文体'); return }
    // ADR-035 带稿：没勾素材但编辑器里有草稿 → 把你的原文按 文体×平台 重塑（而非逼你选素材）
    const draftReshape = selMat.size === 0 && studio.draft.trim().length >= 10
    if (selMat.size === 0 && !draftReshape) { showToast('先从素材库勾选素材，或在编辑器里写/带一段草稿'); return }
    const gl = genres.find(g => g.key === v2Genre)?.label
    setStudio(s => ({ ...s, busy: true, draft: s.draft || '正在按 文体×平台 起稿（约 30 秒）…' }))
    try {
      if (draftReshape) {
        const json = await api('/api/studio/reshape', { method: 'POST', body: { draft: studio.draft, genre: v2Genre, platformForm: v2Pform, viewpoint: studio.viewpoint || null, voice: v2Voice || null } })
        const d = json.data
        setStudio(s => ({ ...s, busy: false, draft: d.body, title: d.title, draftId: d.id, platform: d.platform, paragraphRefs: [], refs: [] }))
        showToast(`已按「${gl}」重塑成母稿（¥${d.cost_yuan?.toFixed(3)}）`)
        return
      }
      const json = await api('/api/materials/draft-v2', { method: 'POST', body: { genre: v2Genre, platformForm: v2Pform, viewpoint: studio.viewpoint || null, selectedNoteIds: [...selMat], voice: v2Voice || null } })
      const d = json.data
      setStudio(s => ({
        ...s, busy: false, draft: d.body, title: d.title, draftId: d.id, platform: d.platform,
        paragraphRefs: d.paragraph_refs,
        refs: (d.paragraph_refs || []).map(r => ({ note: r.sourceTitle || '素材', para: r.marker })),
      }))
      showToast(`已按「${gl}」起稿母稿（引用 ${d.paragraph_refs?.length || 0} 条，¥${d.cost_yuan?.toFixed(3)}）`)
    } catch (err) {
      setStudio(s => ({ ...s, busy: false }))
      showToast(`起稿失败：${err.message}`)
    }
  }

  // ---- P2：批评人格审稿 ----
  const [critique, setCritique] = useState(null) // {verdict, points:[{persona,quote,problem,suggestion}]}
  const [critiqueBusy, setCritiqueBusy] = useState(false)
  const [applyingIdx, setApplyingIdx] = useState(null)
  const critiqueDraft = async () => {
    if (!studio.draft.trim()) { showToast('草稿为空'); return }
    setCritiqueBusy(true)
    showToast('三位审稿人正在通读草稿（约 30 秒）…')
    try {
      const json = await api('/api/studio/critique', { method: 'POST', body: { draft: studio.draft, platform: studio.platform } })
      setCritique(json.data)
      showToast(json.data.points.length ? `收到 ${json.data.points.length} 条批注（¥${json.data.cost?.toFixed(3)}）` : '审稿人没挑出问题')
    } catch (err) { showToast(`审稿失败：${err.message}`) }
    setCritiqueBusy(false)
  }
  // 应用批注 = 记录该次改写的前后快照，撤销按钮跟在条目后面（2026-07-16 反馈：
  // 连续应用多条后，全局撤销分不清撤的是哪次）。全局「撤销改写」只管整稿类操作
  const applyCritique = async (point, idx) => {
    setApplyingIdx(idx)
    try {
      const before = studio.draft
      const json = await api('/api/studio/rewrite', {
        method: 'POST',
        body: { draft: before, instruction: `${point.problem}——${point.suggestion}`, platform: studio.platform },
      })
      setStudio(s => ({ ...s, draft: json.data.draft }))
      setCritique(c => c && { ...c, points: c.points.map((p, i) => i === idx ? { ...p, applied: { before, after: json.data.draft } } : p) })
      showToast('已按批注改写，该条后面可「撤销」')
    } catch (err) { showToast(`改写失败：${err.message}`) }
    setApplyingIdx(null)
  }
  const undoCritique = (point, idx) => {
    if (studio.draft !== point.applied.after &&
      !confirm('这次改写之后草稿又有过修改，撤销会回到这次改写前的版本、丢掉之后的修改。继续？')) return
    setStudio(s => ({ ...s, draft: point.applied.before }))
    setCritique(c => c && { ...c, points: c.points.map((p, i) => i === idx ? { ...p, applied: null } : p) })
    showToast('已撤销该条改写')
  }

  // ---- P2：选段 3 个改法 ----
  // 选区在点按钮那一刻直接从 textarea DOM 读（失焦后 selectionStart/End 仍保留）——
  // 比 onSelect 事件跟踪可靠：键盘选择/程序化选区不会丢
  const draftRef = useRef(null)
  const [variants, setVariants] = useState(null) // {start, end, text, options:[]}
  const [variantsBusy, setVariantsBusy] = useState(false)
  const VARIANT_TAGS = ['🔪 更锋利', '🎯 更具体', '✂️ 更简洁']
  const makeVariants = async () => {
    const start = draftRef.current?.selectionStart ?? 0
    const end = draftRef.current?.selectionEnd ?? 0
    const text = studio.draft.slice(start, end)
    if (text.trim().length < 10) { showToast('先在草稿里选中一段（≥10 字），再点「3 个改法」'); return }
    setVariantsBusy(true)
    showToast('正在生成 3 个改法（约 20 秒）…')
    try {
      const json = await api('/api/studio/variants', { method: 'POST', body: { draft: studio.draft, selection: text, platform: studio.platform } })
      setVariants({ start, end, text, options: json.data.variants })
    } catch (err) { showToast(`生成失败：${err.message}`) }
    setVariantsBusy(false)
  }
  const applyVariant = (opt, idx) => {
    const before = studio.draft
    const after = before.slice(0, variants.start) + opt + before.slice(variants.end)
    setStudio(s => ({ ...s, draft: after }))
    setVariants(v => ({ ...v, applied: { idx, before, after } }))
    showToast('已替换选段，该改法后面可「撤销」')
  }
  const undoVariant = () => {
    if (studio.draft !== variants.applied.after &&
      !confirm('替换之后草稿又有过修改，撤销会回到替换前的版本、丢掉之后的修改。继续？')) return
    setStudio(s => ({ ...s, draft: variants.applied.before }))
    setVariants(v => ({ ...v, applied: null })) // 撤销后三个候选恢复可选
    showToast('已撤销替换')
  }
  // ---- 「⋯ 更多」下拉（按钮墙降级：主操作+3打磨键留在外面，低频项收进来）----
  // ---- 卡片图 tab（小红书专属）：iframe 嵌入卡片工作台，切过去自动灌入当前草稿 ----
  const [xhsMode, setXhsMode] = useState('text')  // 'text' 文案 | 'cards' 卡片图
  const [v2Cards, setV2Cards] = useState(false)   // 阶段4：v2 卡片平台打开图卡工具
  const [cardFeedText, setCardFeedText] = useState(null)  // 出片渲染图卡时喂给 iframe 的适配稿（非空则优先于母稿）
  // ── ADR-046 出片：中栏「② 定稿 ｜ ③ 出片」tab + 母稿→多平台适配稿 ──
  // studioTab / adapted / filmActiveForm 提到 WorkbenchPage（与右栏创作助手共享，出片模式改当前适配稿）
  const [filmForms, setFilmForms] = useState(new Set(['gzh-long', 'xhs-card']))  // 出片选中的平台形态
  const [adaptBusy, setAdaptBusy] = useState(false)
  const [filmTheme, setFilmTheme] = useState('warm')      // 视觉主题（P1 占位，喂图卡渲染器）
  const CARD_FORMS = new Set(['xhs-card', 'douyin-card'])  // 走图卡渲染器
  const VIDEO_FORMS = new Set(['douyin-koubo', 'bilibili']) // 视频渲染器（P2，出片先占位）
  // ADR-046 P3 主题集（用户选定 4 版，与竖版播放器 vertical-player.html 的 th-* 一一对应）
  const THEMES = [['warm', '暖刊', '#f2ece0', '#c1633a'], ['neon', '午夜霓虹', '#141833', '#8ea2ff'], ['aesop', 'Aesop 药房', '#E7E2D8', '#5A6247'], ['brut', '新粗野', '#FFFDF5', '#0A0A0A']]
  const toggleFilmForm = k => setFilmForms(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const adaptBatch = async () => {
    if (!studio.draft.trim()) { showToast('先在②定稿把母稿写好，再来出片'); return }
    if (filmForms.size === 0) { showToast('先选至少一个平台形态'); return }
    setAdaptBusy(true)
    showToast(`正在把母稿适配成 ${filmForms.size} 个平台形态（每个约 20 秒）…`)
    try {
      const json = await api('/api/studio/adapt-batch', { method: 'POST', body: { draft: studio.draft, forms: [...filmForms], viewpoint: studio.viewpoint || null } })
      const map = {}
      for (const r of (json.data || [])) map[r.platformForm] = { ...r, open: false }
      // 第一个非透传的默认展开，方便直接看
      const firstReal = (json.data || []).find(r => !r.passthrough && !r.error)
      if (firstReal) { map[firstReal.platformForm].open = true; setFilmActiveForm?.(firstReal.platformForm) }
      setAdapted(map)
      const okCost = (json.data || []).reduce((s, r) => s + (r.cost || 0), 0)
      showToast(`已适配 ${Object.keys(map).length} 个平台（¥${okCost.toFixed(3)}）`)
    } catch (err) { showToast(`适配失败：${err.message}`) }
    setAdaptBusy(false)
  }
  const openCardsFor = (formKey) => {
    const body = adapted[formKey]?.body || studio.draft
    setCardFeedText(body)
    setV2Cards(true)
    setTimeout(() => postDraftToCards(), 150)
  }
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(stripRefs(text)) } catch { /* 剪贴板受限时忽略 */ }
    showToast('已复制适配稿（自动去掉 [素材N] 标记）')
  }
  // ADR-046 P2a 视频渲染器·内容预览层：口播适配稿 → 竖版分镜播放器（站内预览，纯预览、零 TTS/零花费）。
  // 配音是产品里另一步（ADR-038 半自动：这里出播放器+分镜稿，剪映收尾）。
  const [videoMode, setVideoMode] = useState(false)
  const [videoBusy, setVideoBusy] = useState(false)
  const videoFrame = useRef(null)
  const storyboardRef = useRef(null)   // 存最新分镜稿，避免 onLoad/setTimeout 闭包读到旧 state（导致 post 空 scenes）
  const postStoryboard = () => {
    const sb = storyboardRef.current
    if (!sb) return
    try { videoFrame.current?.contentWindow?.postMessage({ type: 'kw-storyboard', title: sb.title, scenes: sb.scenes || [], theme: filmTheme }, '*') } catch { /* 跨窗口受限时忽略 */ }
  }
  const openVideoFor = async (formKey) => {
    const body = adapted[formKey]?.body
    if (!body?.trim()) { showToast('先展开这篇口播适配稿再生成分镜'); return }
    setVideoBusy(true)
    showToast('正在切分镜（约 20 秒 · 纯预览、不配音、不花钱）…')
    try {
      const j = await api('/api/studio/storyboard', { method: 'POST', body: { draft: body } })
      storyboardRef.current = j.data; setVideoMode(true)
      setTimeout(postStoryboard, 350)
      showToast(`已切 ${j.data.scenes?.length || 0} 个分镜（¥${j.data.cost?.toFixed(3)}）· 预览节奏，满意再拿去剪映配音`)
    } catch (err) { showToast('分镜生成失败：' + err.message) }
    setVideoBusy(false)
  }
  // 竖版播放器里的「加配音 / 试听」是 iframe 内按钮 → postMessage 请求，父窗口调 edge-tts 后回灌音频。
  // 配音与预览物理分开：只有用户在播放器里点了才走这里、才出音（免费，但仍是主动一步）。
  useEffect(() => {
    const onMsg = async (e) => {
      const d = e.data
      const post = (m) => { try { videoFrame.current?.contentWindow?.postMessage(m, '*') } catch { /* 忽略 */ } }
      if (!d || !videoFrame.current) return
      if (d.type === 'kw-tts-request') {
        const sb = storyboardRef.current
        if (!sb?.scenes?.length) { post({ type: 'kw-tts-error', error: '没有分镜' }); return }
        try {
          const j = await api('/api/studio/tts', { method: 'POST', body: { scenes: sb.scenes.map(s => ({ id: s.id, phrases: s.phrases })), voice: d.voice } })
          post({ type: 'kw-tts', scenes: j.data.scenes })
          showToast('配音已生成（edge-tts 免费）· 带声重播')
        } catch (err) { post({ type: 'kw-tts-error', error: err.message }); showToast('配音失败：' + err.message) }
      } else if (d.type === 'kw-tts-sample') {
        try {
          const j = await api('/api/studio/tts-sample', { method: 'POST', body: { voice: d.voice, text: '关键是把需求说清楚，先做出来给你看。' } })
          post({ type: 'kw-tts-sample-audio', audio: j.data.base64 })
        } catch (err) { post({ type: 'kw-tts-sample-error', error: err.message }) }
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // ── ADR-046 P3 多平台产出管理：单篇重出 / 单篇导出 / 全部导出（复用 adapt-batch，无新后端）──
  const readaptOne = async (formKey) => {
    if (!studio.draft.trim()) { showToast('母稿为空'); return }
    setAdapted(a => ({ ...a, [formKey]: { ...a[formKey], reBusy: true } }))
    try {
      const j = await api('/api/studio/adapt-batch', { method: 'POST', body: { draft: studio.draft, forms: [formKey], viewpoint: studio.viewpoint || null } })
      const r = (j.data || [])[0]
      if (r) setAdapted(a => ({ ...a, [formKey]: { ...r, open: true } }))
      showToast('已按母稿重出这篇适配稿')
    } catch (err) { showToast('重出失败：' + err.message); setAdapted(a => ({ ...a, [formKey]: { ...a[formKey], reBusy: false } })) }
  }
  const dlText = (name, text, ext) => {
    const blob = new Blob([stripRefs(text)], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${String(name).replace(/[\\/:*?"<>|]/g, '_')}.${ext}`; a.click(); URL.revokeObjectURL(a.href)
  }
  const exportOne = (k) => {
    const a = adapted[k]; if (!a?.body) return
    dlText(a.formLabel || k, a.body, (k === 'gzh-long' || k === 'xhs-long') ? 'md' : 'txt')
    showToast(`已导出「${a.formLabel || k}」`)
  }
  const exportAll = () => {
    const parts = Object.entries(adapted).filter(([, a]) => a.body && !a.error)
      .map(([k, a]) => `## ${a.formLabel || k}\n\n${stripRefs(a.body)}`)
    if (!parts.length) { showToast('还没有可导出的适配稿'); return }
    dlText(`各平台稿-${(studio.title || '稿').slice(0, 10)}`, parts.join('\n\n---\n\n'), 'md')
    showToast(`已把 ${parts.length} 个平台的稿导出为一个 md`)
  }
  const [draftsOpen, setDraftsOpen] = useState(false)   // 草稿箱面板
  const [selDrafts, setSelDrafts] = useState(new Set()) // 勾选待删的草稿
  const cardFrame = useRef(null)
  const cardsMode = (studio.platform === 'xhs' && xhsMode === 'cards') || v2Cards
  const postDraftToCards = () => {
    // 出片渲染适配稿时喂 cardFeedText（不动母稿）；否则喂母稿。都去掉 [素材N] 溯源标记
    const text = String(cardFeedText ?? studio.draft ?? '').replace(/\s*\[素材\d+\]/g, '')
    try { cardFrame.current?.contentWindow?.postMessage({ type: 'kw-fill-cards', text }, '*') } catch { /* 跨窗口受限时忽略 */ }
  }
  // P0#3：卡片是草稿的派生视图——在卡片 tab 时监听 draft 变化自动重灌（防"派生视图装死"）。
  // 否则你在右侧「创作助手」/改稿改了文案，卡片纹丝不动。首次进卡片不弹提示，之后因改稿刷新给一句确认。
  const cardFedOnce = useRef(false)
  useEffect(() => {
    if (!cardsMode) { cardFedOnce.current = false; return }
    const t = setTimeout(() => {
      postDraftToCards()
      if (cardFedOnce.current) showToast('卡片已按最新文案刷新')
      cardFedOnce.current = true
    }, 400)
    return () => clearTimeout(t)
  }, [studio.draft, cardsMode, cardFeedText]) // eslint-disable-line react-hooks/exhaustive-deps

  const setPlatform = (p) => {
    setXhsMode('text')
    setStudio(s => ({ ...s, platform: p }))
    setTimeout(() => genDraft(p), 0)
  }

  const stripRefs = t => String(t || '').replace(/\s*\[素材\d+\]/g, '')   // 批量去 [素材N] 溯源标记（发布用）
  const copyAll = async () => {
    try { await navigator.clipboard.writeText(stripRefs(studio.draft)) } catch { /* 剪贴板受限时忽略 */ }
    showToast('已复制全文（自动去掉了 [素材N] 溯源标记）')
  }

  // 溯源检查：草稿有内容但没有任何 [素材N]/引用标记时提示
  // 只在"选了素材却没引用"时提醒；带稿（没勾素材、是你自己的字）不算缺引用（ADR-035）
  const noRefs = selMat.size > 0 && studio.draft.trim() && !/\[素材|—— 引自/.test(studio.draft)
  // 冷启动态：还没有草稿 → 出三步向导 + 一个明确的「生成初稿」，而不是空框+按钮墙
  const isEmpty = !studio.draft.trim()
  // ADR-035 带稿态：没勾素材但编辑器里已有草稿 → 生成=重塑我的稿（而非从素材写）
  const reshapeMode = selMat.size === 0 && studio.draft.trim().length >= 10
  const selPlatform = platforms.find(p => p.key === studio.platform)

  return (
    <>
      {returnPage
        ? <button className="wb-back" onClick={goBack}>← 返回{RETURN_LABEL[returnPage] || '上一页'}</button>
        : <button className="wb-back" onClick={() => setPage('topics')}>← 返回主题库</button>}
      <div className="wb-topic-head" style={{ marginTop: 6 }}>
        <span className="wb-topic-name">创作台</span>
        <span style={{ fontSize: 12, color: 'var(--sub2)' }}>来源</span>
        <span className="wb-studio-src" style={studio.sourceTopicId ? { cursor: 'pointer', textDecoration: 'underline dotted' } : undefined}
          title={studio.sourceTopicId ? '打开来源主题页' : undefined}
          onClick={() => studio.sourceTopicId && gotoTopic(studio.sourceTopicId)}>
          {studio.source || '手选素材（右侧插入）'}
        </span>
        {drafts?.length > 0 && (
          <div style={{ marginLeft: 'auto', position: 'relative' }}>
            <button className="wb-btn-ghost" onClick={() => setDraftsOpen(o => !o)}>草稿箱（{drafts.length}）</button>
            {draftsOpen && (<>
              <div onClick={() => setDraftsOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, width: 340, background: 'var(--surface)', border: '1px solid var(--line10)', borderRadius: 11, boxShadow: '0 12px 32px rgba(33,31,26,.16)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 13px', borderBottom: '1px solid var(--line08)', fontSize: 12, color: 'var(--sub2)' }}>
                  <span>草稿箱 · {drafts.length} 篇</span>
                  <span style={{ cursor: 'pointer', color: 'var(--accent)' }}
                    onClick={() => setSelDrafts(selDrafts.size === drafts.length ? new Set() : new Set(drafts.map(d => d.id)))}>
                    {selDrafts.size === drafts.length ? '取消全选' : '全选'}
                  </span>
                </div>
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {drafts.map(d => (
                    <div key={d.id} style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '9px 13px', borderBottom: '1px solid var(--line08)' }}>
                      <input type="checkbox" checked={selDrafts.has(d.id)}
                        onChange={() => setSelDrafts(s => { const n = new Set(s); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n })} />
                      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => { openDraft(d); setDraftsOpen(false) }}>
                        <div style={{ fontSize: 13, color: 'var(--body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(d.title || d.body.slice(0, 24)).slice(0, 28)}</div>
                        <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>{(d.updated_at || '').slice(5, 16)}</div>
                      </div>
                      <button title="删除这份" onClick={() => deleteDrafts?.([d.id])}
                        style={{ border: 'none', background: 'none', padding: '4px 7px', borderRadius: 6, color: 'var(--faint)', fontSize: 12 }}>删</button>
                    </div>
                  ))}
                </div>
                {selDrafts.size > 0 && (
                  <div style={{ padding: '10px 13px', borderTop: '1px solid var(--line08)' }}>
                    <button onClick={() => { deleteDrafts?.([...selDrafts]); setSelDrafts(new Set()) }}
                      style={{ width: '100%', border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 600, fontSize: 13, padding: '8px 0', borderRadius: 8, cursor: 'pointer' }}>
                      删除选中（{selDrafts.size}）
                    </button>
                  </div>
                )}
              </div>
            </>)}
          </div>
        )}
      </div>
      <div className="wb-page-sub">选素材 → ②定文体起母稿 → ③出片裂变各平台 · 每段可溯源、发布前一键去标记</div>

      {v2Mode && !cardsMode && !videoMode && (
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '236px 1fr', border: '1px solid var(--line10)', borderRadius: 12, margin: '10px 0', background: 'var(--surface)', minHeight: 300 }}>
          {/* 左：素材台（贯穿到底 + 改稿说明） */}
          <aside style={{ borderRight: '1px solid var(--line08)', padding: 14, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: 12, color: 'var(--sub2)', fontWeight: 600 }}>素材（已选 {selMat.size}）</span>
              <button onClick={() => setFsOpen(o => !o)} title="从飞书拉一篇文档进素材台" style={{ marginLeft: 'auto', border: '1px solid rgba(42,111,181,.3)', background: 'rgba(42,111,181,.06)', color: '#2a6fb5', borderRadius: 6, padding: '2px 8px', fontSize: 11.5, cursor: 'pointer' }}>飞 从飞书</button>
              <button onClick={() => setAddOpen(o => !o)} title="新增一条素材到素材库" style={{ border: '1px solid var(--line10)', background: 'var(--surface)', color: 'var(--accent)', borderRadius: 6, padding: '2px 8px', fontSize: 11.5, cursor: 'pointer' }}>+ 新增</button>
            </div>
            {fsOpen && <FeishuPicker onPick={takeFeishuAsNote} showToast={showToast} />}
            <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 8 }}>从素材库挑（按收藏时间排），勾中的才用来起稿；缺就点「+新增」</div>
            {topicPreload && (
              <div style={{ marginBottom: 8, padding: '6px 9px', fontSize: 11.5, lineHeight: 1.5, color: 'var(--accent)', background: 'rgba(61,90,128,.07)', border: '1px solid rgba(61,90,128,.2)', borderRadius: 7 }}>
                已带上主题《{topicPreload.name}》的 {topicPreload.count} 条素材，可增减
              </div>
            )}
            <input value={matQ} onChange={e => setMatQ(e.target.value)} placeholder="搜索素材…"
              style={{ width: '100%', marginBottom: 8, padding: '6px 10px', fontSize: 12.5, border: '1px solid var(--line10)', borderRadius: 6, background: 'var(--surface)', color: 'var(--body)' }} />
            {addOpen && (
              <div style={{ marginBottom: 8, padding: 8, border: '1px solid var(--line10)', borderRadius: 7, background: 'var(--brief-bg)' }}>
                <input value={addTitle} onChange={e => setAddTitle(e.target.value)} placeholder="标题（可选）"
                  style={{ width: '100%', marginBottom: 6, padding: '5px 8px', fontSize: 12, border: '1px solid var(--line10)', borderRadius: 5, background: 'var(--surface)', color: 'var(--body)' }} />
                <textarea value={addText} onChange={e => setAddText(e.target.value)} placeholder="粘一段素材文字…"
                  style={{ width: '100%', minHeight: 54, padding: '5px 8px', fontSize: 12, border: '1px solid var(--line10)', borderRadius: 5, background: 'var(--surface)', color: 'var(--body)', resize: 'vertical', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button disabled={addBusy} onClick={addNote} style={{ flex: 1, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 12, padding: '5px 0', borderRadius: 6, cursor: 'pointer' }}>{addBusy ? '保存中…' : '存入并选中'}</button>
                  <button onClick={() => setAddOpen(false)} style={{ border: '1px solid var(--line10)', background: 'var(--surface)', color: 'var(--sub)', fontSize: 12, padding: '5px 10px', borderRadius: 6, cursor: 'pointer' }}>取消</button>
                </div>
              </div>
            )}
            <div style={{ flex: 1, minHeight: 120, maxHeight: 360, overflowY: 'auto', border: '1px solid var(--line10)', borderRadius: 6, padding: '4px 8px' }}>
              {matsShown.length === 0 && <div style={{ fontSize: 12, color: 'var(--faint)', padding: '8px 2px' }}>{mats.length ? '没有匹配的素材' : '素材库为空 / 加载中…'}</div>}
              {matsShown.map(m => {
                const isExp = expMat.has(m.id)
                const hasMore = (m.full || '').length > (m.excerpt || '').length
                return (
                <div key={m.id} style={{ padding: '6px 0', fontSize: 12.5, borderBottom: '1px solid var(--line08)' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flex: 1, minWidth: 0, cursor: 'pointer' }}>
                      <input type="checkbox" checked={selMat.has(m.id)} onChange={() => toggleMat(m.id)} style={{ marginTop: 3, flex: 'none' }} />
                      <span><b style={{ color: 'var(--body)' }}>{m.sourceTitle}</b>{!isExp && m.excerpt ? <span style={{ color: 'var(--faint)' }}> · {m.excerpt}{hasMore ? '…' : ''}</span> : null}</span>
                    </label>
                    {!isEmpty && (
                      <button onClick={() => insertMat(m)} title="把这条插入正文（不重新生成）"
                        style={{ flex: 'none', border: '1px solid var(--line10)', background: 'var(--surface)', color: 'var(--accent)', borderRadius: 5, padding: '2px 7px', fontSize: 11, cursor: 'pointer' }}>插入</button>
                    )}
                  </div>
                  {hasMore && (
                    <button onClick={() => setExpMat(s => { const n = new Set(s); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n })}
                      style={{ marginLeft: 24, marginTop: 2, border: 'none', background: 'none', color: 'var(--accent)', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                      {isExp ? '收起 ▴' : '展开全文 ▾'}
                    </button>
                  )}
                  {isExp && (
                    <div style={{ marginLeft: 24, marginTop: 4, maxHeight: 220, overflowY: 'auto', fontSize: 12, lineHeight: 1.65, color: 'var(--body)', whiteSpace: 'pre-wrap', background: 'var(--surface)', border: '1px solid var(--line08)', borderRadius: 6, padding: '8px 10px' }}>{m.full}</div>
                  )}
                </div>
                )
              })}
            </div>
            {studio.paragraphRefs?.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line08)' }}>
                <div style={{ fontSize: 11, color: 'var(--sub2)', fontWeight: 600, marginBottom: 6 }}>本文引用（{studio.paragraphRefs.length}）· 点原文溯源</div>
                {studio.paragraphRefs.map((r, i) => (
                  <div key={i} onClick={() => setActiveRef(activeRef === r.marker ? null : r.marker)}
                    style={{ fontSize: 11.5, marginBottom: 3, lineHeight: 1.45, display: 'flex', gap: 5, alignItems: 'baseline', cursor: 'pointer', padding: '3px 5px', borderRadius: 5, background: activeRef === r.marker ? 'rgba(61,90,128,.12)' : 'transparent', border: activeRef === r.marker ? '1px solid rgba(61,90,128,.35)' : '1px solid transparent' }}>
                    <span style={{ color: 'var(--accent)', fontWeight: 600, flex: 'none' }}>{r.marker}</span>
                    <span style={{ color: 'var(--body)', flex: 1, minWidth: 0 }}>{r.sourceTitle || '素材'}</span>
                    {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'var(--accent)', textDecoration: 'none', flex: 'none' }}>原文↗</a>}
                    <button onClick={e => { e.stopPropagation(); removeRef?.(i) }} title="移除该引用（清理草稿里的标记/引块）"
                      style={{ flex: 'none', border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line08)', fontSize: 11, color: 'var(--sub2)', lineHeight: 1.55 }}>
              <b style={{ color: 'var(--sub)' }}>起稿 → 改稿 → 产出，从上到下</b><br />· 改稿（去 AI 味 / AI 挑毛病 / 改选中段落）就在草稿正下方。<br />· 也可到右侧「创作助手」用大白话改（如“开头更狠”“压到 5 条”）。
            </div>
          </aside>

          {/* 右：推荐卡 + 换文体/换平台/更多组合 */}
          <section style={{ padding: 14 }}>
            {/* ADR-046：中栏两段 tab —— ② 定稿(母稿) ｜ ③ 出片(多平台) */}
            <div style={{ display: 'inline-flex', background: 'var(--brief-bg)', border: '1px solid var(--line10)', borderRadius: 10, padding: 3, marginBottom: 12 }}>
              {[['edit', '2', '定稿 · 母稿'], ['film', '3', '出片 · 多平台']].map(([k, n, label]) => (
                <button key={k} onClick={() => setStudioTab(k)}
                  style={{ border: 'none', background: studioTab === k ? 'var(--accent)' : 'transparent', color: studioTab === k ? '#fff' : 'var(--sub)', padding: '7px 15px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit' }}>
                  <span style={{ width: 18, height: 18, borderRadius: '50%', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: studioTab === k ? 'rgba(255,255,255,.25)' : 'var(--line07)', color: studioTab === k ? '#fff' : 'var(--sub)' }}>{n}</span>{label}
                </button>
              ))}
            </div>

            {studioTab === 'edit' && (<>
            {seriesPresets.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10, padding: '9px 11px', background: 'rgba(61,90,128,.05)', border: '1px solid rgba(61,90,128,.18)', borderRadius: 9 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>🎨 系列风格</span>
                <span style={{ fontSize: 11, color: 'var(--sub2)' }}>选一次联动 头图皮肤 + 排版主题 + 声音</span>
                <span style={{ flex: 1 }} />
                <span onClick={() => pickSeries('')} style={{ cursor: 'pointer', fontSize: 12, border: '1px solid var(--line10)', background: !seriesPreset ? 'var(--accent)' : 'var(--surface)', color: !seriesPreset ? '#fff' : 'var(--body)', borderRadius: 14, padding: '4px 11px' }}>无</span>
                {seriesPresets.map(p => (
                  <span key={p.id} onClick={() => pickSeries(p.id)} title={`头图 ${p.cover_skin} · 排版 ${p.article_theme} · 声音 ${p.default_voice}`}
                    style={{ cursor: 'pointer', fontSize: 12, border: '1px solid var(--line10)', background: seriesPreset === p.id ? 'var(--accent)' : 'var(--surface)', color: seriesPreset === p.id ? '#fff' : 'var(--body)', borderRadius: 14, padding: '4px 11px' }}>{p.name}</span>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12.5, color: 'var(--sub2)', marginBottom: 9 }}>
              {selMat.size > 0 ? `基于你选的 ${selMat.size} 条素材，建议文体：` : reshapeMode ? '你带来的稿在下面——想让 AI 按文体重塑就点「用这个生成母稿」；已是成稿就直接去「③ 出片」，不必生成。' : '勾选左侧素材让 AI 起草；或已有成稿直接粘/写进下面编辑器 →「③ 出片」（不必生成母稿）。'}
            </div>
            <div style={{ border: '1px solid rgba(61,90,128,.35)', borderRadius: 11, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 10.5, color: 'var(--accent)', background: 'rgba(61,90,128,.09)', borderRadius: 5, padding: '2px 7px' }}>推荐文体</span>
                <h3 style={{ fontFamily: 'var(--serif)', fontSize: 15.5, fontWeight: 600, margin: 0, color: 'var(--text)' }}>{gLabel(v2Genre)}</h3>
              </div>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--sub)', lineHeight: 1.55 }}>
                {recReason ? recReason + (recPinned ? '（你已手动指定文体）' : '') : `用「${gLabel(v2Genre)}」骨架起稿；想换见下面「换文体」。`}
                <br /><span style={{ color: 'var(--faint)' }}>母稿＝最厚那版（公众号深稿）；平台裂变到「③ 出片」里多选。</span>
              </p>
              <button className="wb-btn-primary" disabled={studio.busy || (selMat.size === 0 && studio.draft.trim().length < 10)} onClick={genDraftV2}>{reshapeMode ? '用我的稿生成母稿' : '用这个生成母稿'}</button>
            </div>

            <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 12.5, color: 'var(--sub)' }}>
              <div style={{ position: 'relative' }}>
                <span style={{ cursor: 'pointer' }} onClick={() => { setCombosOpen(false); setOpenDD(openDD === 'genre' ? null : 'genre') }}>换文体 ▾</span>
                {openDD === 'genre' && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 20, background: 'var(--surface)', border: '1px solid var(--line10)', borderRadius: 10, boxShadow: '0 8px 24px rgba(33,31,26,.14)', padding: 5, minWidth: 180 }}>
                    {genres.map(g => (
                      <div key={g.key} onClick={() => { setV2Genre(g.key); setRecPinned(true); setOpenDD(null) }}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7, fontSize: 13, cursor: 'pointer', color: v2Genre === g.key ? 'var(--accent)' : 'var(--body)', background: v2Genre === g.key ? 'rgba(61,90,128,.07)' : 'transparent' }}>
                        {g.label}{g.key === '读书精读体' && <span style={{ fontSize: 10, color: 'var(--accent)', background: 'rgba(61,90,128,.11)', borderRadius: 4, padding: '1px 6px' }}>推荐</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {voices.length > 0 && (
                <div style={{ position: 'relative' }}>
                  <span style={{ cursor: 'pointer' }} onClick={() => { setCombosOpen(false); setOpenDD(openDD === 'voice' ? null : 'voice') }}>声音：{v2Voice ? vLabel(v2Voice) : '无'} ▾</span>
                  {openDD === 'voice' && (
                    <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 20, background: 'var(--surface)', border: '1px solid var(--line10)', borderRadius: 10, boxShadow: '0 8px 24px rgba(33,31,26,.14)', padding: 5, minWidth: 200 }}>
                      <div onClick={() => { setV2Voice(''); setOpenDD(null) }}
                        style={{ padding: '8px 10px', borderRadius: 7, fontSize: 13, cursor: 'pointer', color: !v2Voice ? 'var(--accent)' : 'var(--body)', background: !v2Voice ? 'rgba(61,90,128,.07)' : 'transparent' }}>无（默认·跟文体走）</div>
                      {voices.map(v => (
                        <div key={v.key} onClick={() => { setV2Voice(v.key); setOpenDD(null) }} title={v.note}
                          style={{ padding: '8px 10px', borderRadius: 7, fontSize: 13, cursor: 'pointer', color: v2Voice === v.key ? 'var(--accent)' : 'var(--body)', background: v2Voice === v.key ? 'rgba(61,90,128,.07)' : 'transparent' }}>{v.label}<span style={{ fontSize: 10.5, color: 'var(--faint)', marginLeft: 6 }}>{v.note}</span></div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <span style={{ cursor: 'pointer' }} onClick={() => { setOpenDD(null); setCombosOpen(o => !o) }}>更多文体 ▾</span>
            </div>

            {combosOpen && (
              <div style={{ marginTop: 12, border: '1px solid var(--line10)', borderRadius: 11, padding: 13, background: 'var(--brief-bg)' }}>
                <div style={{ fontSize: 11, color: 'var(--sub2)', marginBottom: 7 }}>选文体 <span style={{ color: 'var(--faint)' }}>· 平台形态在「③ 出片」里选</span></div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {genres.map(g => (
                    <span key={g.key} onClick={() => { setV2Genre(g.key); setRecPinned(true) }}
                      style={{ border: '1px solid var(--line10)', background: v2Genre === g.key ? 'var(--accent)' : 'var(--surface)', color: v2Genre === g.key ? '#fff' : 'var(--body)', borderRadius: 16, padding: '5px 11px', fontSize: 12.5, cursor: 'pointer' }}>{g.label}</span>
                  ))}
                </div>
              </div>
            )}

            {/* 方案C：草稿嵌右栏（素材台贯穿到底）；改稿贴着草稿单独一行，产出另起一行 */}
            {studio.sourceTopicId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 0' }}>
                <span style={{ fontSize: 12, color: 'var(--sub2)', flex: 'none' }}>你的观点</span>
                <input value={studio.viewpoint} onChange={(e) => setStudio(s => ({ ...s, viewpoint: e.target.value }))}
                  placeholder="这篇你想说什么？一句话立场 · 留空则 AI 提议判断并标注"
                  style={{ flex: 1, fontSize: 12.5, padding: '7px 10px', border: '1px solid var(--line08)', borderRadius: 8, background: 'var(--surface)' }} />
              </div>
            )}
            {!isEmpty && (
              <div style={{ display: 'inline-flex', border: '1px solid var(--line10)', borderRadius: 8, overflow: 'hidden', marginTop: 14, marginBottom: 6 }}>
                <button className={!srcMode ? 'wb-btn-primary' : 'wb-btn-ghost'} style={{ borderRadius: 0, border: 'none', fontSize: 12, padding: '6px 14px' }} onClick={() => setSrcMode(false)}>编辑</button>
                <button className={srcMode ? 'wb-btn-primary' : 'wb-btn-ghost'} style={{ borderRadius: 0, border: 'none', fontSize: 12, padding: '6px 14px' }} onClick={() => setSrcMode(true)}>溯源（点 [素材N] 溯源）</button>
              </div>
            )}
            {srcMode && !isEmpty ? (
              <div className="wb-draft" style={{ whiteSpace: 'pre-wrap', overflowY: 'auto', cursor: 'default', marginTop: 4 }}>{renderTraced()}</div>
            ) : (
              <textarea ref={draftRef} className="wb-draft" style={{ marginTop: 4 }} value={studio.draft}
                onChange={(e) => setStudio(s => ({ ...s, draft: e.target.value }))}
                placeholder="① 从素材让 AI 起草 → 点上方「用这个生成母稿」；② 已有成稿 → 直接粘/写在这里，不必点生成，去「③ 出片」即可。改稿见下方或右侧「创作助手」…" />
            )}
            {noRefs && (
              <div className="wb-warnbar" style={{ marginTop: 10 }}><IconWarn />草稿中没有素材引用，创作前请补充引用（每段可溯源）</div>
            )}
            {/* 改稿：贴着草稿（「改一段」要读草稿里选中的文字），与产出分开 */}
            <div className="wb-studio-actions">
              <span style={{ fontSize: 11, color: 'var(--sub2)', fontWeight: 600, marginRight: 2 }}>改稿</span>
              <button className="wb-btn-outline" disabled={studio.busy || isEmpty} title="整篇改得更顺更好读：换掉 AI 高频词 / 拆套路句式 / 加入第一人称判断" onClick={humanizeDraft}>去 AI 味</button>
              <button className="wb-btn-outline" disabled={critiqueBusy || studio.busy || isEmpty} title="三个批评视角通读全稿，挑出问题给批注——只挑毛病不改稿，你决定改哪条" onClick={critiqueDraft}>{critiqueBusy ? '挑毛病中…' : 'AI 挑毛病'}</button>
              <button className="wb-btn-outline" disabled={variantsBusy || studio.busy || isEmpty} title="先在草稿里选中一段（≥10 字），给这段 3 个策略不同的改法" onClick={makeVariants}>{variantsBusy ? '生成中…' : '改选中段落'}</button>
              <button className="wb-btn-ghost" disabled={!studio.prevDraft} title="改写前后两版互换（去 AI 味 / 改选中段落后可用）" onClick={undoRewrite}>撤销改写</button>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--faint)' }}>或到右侧「创作助手」用大白话改</span>
            </div>
            {/* 产出 */}
            <div className="wb-studio-actions">
              <span style={{ fontSize: 11, color: 'var(--sub2)', fontWeight: 600, marginRight: 2 }}>产出</span>
              <button className="wb-btn-outline" disabled={studio.busy || isEmpty} title={reshapeMode ? '把你的稿按上方文体再重塑一版母稿' : '用同样的素材·文体再出一版母稿（起稿请用上方推荐卡「用这个生成母稿」）'} onClick={genDraftV2}>{reshapeMode ? '重塑我的稿' : '重新生成'}</button>
              <button className="wb-btn-ghost" disabled={isEmpty} title={studio.draftId ? '把改动存回当前草稿（不发布）' : '把当前草稿存进草稿箱，之后可继续改（不发布）'} onClick={saveDraft}>{studio.draftId ? '保存修改' : '存草稿'}</button>
              <button className="wb-btn-ghost" disabled={isEmpty} title="导出发布版：溯源标记转文末来源列表" onClick={exportMd}>导出 Markdown</button>
              <button className="wb-btn-ghost" disabled={isEmpty} title="删掉正文里所有 [素材N] 标记（发布前用；先存草稿）" onClick={() => { setStudio(s => ({ ...s, draft: stripRefs(s.draft) })); showToast('已去掉正文里所有 [素材N] 标记') }}>去引用标记</button>
              <button className="wb-btn-ghost" disabled={isEmpty} title="生成几个标题候选" onClick={suggestTitles}>标题候选</button>
              <button className="wb-btn-ghost" disabled={isEmpty} title="复制母稿全文（自动去掉 [素材N] 溯源标记，公众号长文可直接发）" onClick={copyAll}>复制全文</button>
              {studio.draftId && (
                <button className="wb-btn-ghost" title="删除当前草稿" style={{ color: 'var(--red)' }} onClick={deleteCurrentDraft}>删除草稿</button>
              )}
              <span style={{ marginLeft: 'auto' }} />
              <button className="wb-btn-primary" disabled={isEmpty} title="母稿定了？去出片：选平台形态、一鱼多吃各平台稿" onClick={() => setStudioTab('film')}>去出片 · 各平台 →</button>
            </div>
            </>)}

            {studioTab === 'film' && (
              <FilmPane
                draftEmpty={isEmpty} pforms={pforms} filmForms={filmForms} toggleFilmForm={toggleFilmForm}
                adapted={adapted} setAdapted={setAdapted} adaptBusy={adaptBusy} adaptBatch={adaptBatch}
                CARD_FORMS={CARD_FORMS} VIDEO_FORMS={VIDEO_FORMS} openCardsFor={openCardsFor} copyText={copyText}
                openVideoFor={openVideoFor} videoBusy={videoBusy}
                readaptOne={readaptOne} exportOne={exportOne} exportAll={exportAll}
                THEMES={THEMES} filmTheme={filmTheme} setFilmTheme={setFilmTheme} setStudioTab={setStudioTab}
                filmActiveForm={filmActiveForm} setFilmActiveForm={setFilmActiveForm} showToast={showToast}
                defaultTitle={studio.title || ''}
                boundPreset={seriesPreset} boundTheme={curPreset?.article_theme || ''} seriesName={curPreset?.name || ''} />
            )}
          </section>

          {openDD && <div onClick={() => setOpenDD(null)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />}
        </div>
      )}


      {studio.platform === 'xhs' && (
        <div style={{ display: 'flex', gap: 6, margin: '12px 0 0', alignItems: 'center', flexWrap: 'wrap' }}>
          {[['text', '文案'], ['cards', '卡片图']].map(([m, label]) => (
            <button key={m} className={xhsMode === m ? 'wb-btn-primary' : 'wb-btn-outline'}
              onClick={() => { setXhsMode(m); if (m === 'cards') setTimeout(postDraftToCards, 80) }}>{label}</button>
          ))}
          {cardsMode && <span style={{ fontSize: 12, color: 'var(--sub2)' }}>已填入当前文案 · 切风格/比例、点着改字、下载图</span>}
        </div>
      )}

      {v2Cards && (
        <div style={{ display: 'flex', gap: 8, margin: '12px 0 0', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="wb-btn-ghost" onClick={() => { setV2Cards(false); setCardFeedText(null) }}>← 返回文稿</button>
          <span style={{ fontSize: 12, color: 'var(--sub2)' }}>{cardFeedText != null ? '已填入出片适配稿（已去 [素材N]）· 切风格/比例、点着改字、下载图' : '已填入当前文案（已去 [素材N]）· 切风格/比例、点着改字、下载图'}</span>
        </div>
      )}


      {cardsMode && (
        <iframe ref={cardFrame} src="/xhs-card-studio.html" title="卡片图工作台"
          onLoad={postDraftToCards}
          style={{ width: '100%', height: '78vh', border: '1px solid var(--line10)', borderRadius: 10, marginTop: 8, background: 'var(--surface)' }} />
      )}

      {/* ADR-046 P2a：竖版分镜播放器（内容预览层，纯预览、零 TTS/零花费；配音是产品另一步） */}
      {videoMode && (
        <div style={{ display: 'flex', gap: 8, margin: '12px 0 0', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="wb-btn-ghost" onClick={() => setVideoMode(false)}>← 返回文稿</button>
          <span style={{ fontSize: 12, color: 'var(--sub2)' }}>竖版分镜预览 · 看节奏/字幕；可选「加配音」(edge-tts 免费·主动点才出音)；下载分镜稿拿去剪映收尾</span>
          <button className="wb-btn-ghost" style={{ marginLeft: 'auto' }} disabled={videoBusy}
            onClick={() => filmActiveForm && openVideoFor(filmActiveForm)} title="按当前口播适配稿重切分镜">↻ 重切分镜</button>
        </div>
      )}
      {videoMode && (
        <iframe ref={videoFrame} src="/vertical-player.html" title="竖版分镜播放器"
          onLoad={postStoryboard}
          style={{ width: '100%', height: '80vh', border: '1px solid var(--line10)', borderRadius: 10, marginTop: 8, background: 'var(--surface)' }} />
      )}

      {critique && (
        <div className="wb-card" style={{ marginTop: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="wb-card-label" style={{ flex: 'none' }}>AI 挑出的问题（{critique.points.length}）</span>
            <span style={{ fontSize: 12.5, color: 'var(--sub2)', flex: 1 }}>{critique.verdict}</span>
            <button className="wb-note-del" style={{ flex: 'none' }} title="关闭批注" onClick={() => setCritique(null)}>✕</button>
          </div>
          {critique.points.length === 0 && (
            <div style={{ fontSize: 13, marginTop: 8, color: 'var(--body2)' }}>三位审稿人都没挑出值得改的问题。</div>
          )}
          {critique.points.map((p, i) => (
            <div key={i} style={{ borderTop: '1px solid var(--line08)', padding: '10px 0 8px', fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="wb-pill" style={{ color: '#3d5a80', background: 'rgba(61,90,128,.12)', flex: 'none' }}>{p.persona}</span>
                <span style={{ color: 'var(--sub2)', fontSize: 12 }}>引「{p.quote}」</span>
              </div>
              <div style={{ margin: '6px 0 4px', color: 'var(--body2)' }}>{p.problem}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ color: 'var(--sub2)', fontSize: 12.5, flex: 1 }}>建议：{p.suggestion}</span>
                {p.applied ? (
                  <>
                    <span className="wb-pill" style={{ color: '#3f7350', background: 'rgba(63,115,80,.12)', flex: 'none' }}>✅ 已应用</span>
                    <button className="wb-btn-ghost" style={{ flex: 'none' }} title="回到这条改写之前的版本"
                      onClick={() => undoCritique(p, i)}>撤销</button>
                  </>
                ) : (
                  <button className="wb-btn-ghost" style={{ flex: 'none' }} disabled={applyingIdx !== null}
                    onClick={() => applyCritique(p, i)}>{applyingIdx === i ? '改写中…' : '按此修改'}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {variants && (
        <div className="wb-card" style={{ marginTop: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="wb-card-label" style={{ flex: 'none' }}>✨ 选段改法</span>
            <span style={{ fontSize: 12, color: 'var(--sub2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              原文：「{variants.text.slice(0, 40)}{variants.text.length > 40 ? '…' : ''}」
            </span>
            <button className="wb-note-del" style={{ flex: 'none' }} title="全部放弃" onClick={() => setVariants(null)}>✕</button>
          </div>
          {variants.options.map((opt, i) => (
            <div key={i} style={{ borderTop: '1px solid var(--line08)', padding: '10px 0 8px', fontSize: 13, opacity: variants.applied && variants.applied.idx !== i ? 0.5 : 1 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span className="wb-pill" style={{ color: '#3f7350', background: 'rgba(63,115,80,.12)', flex: 'none' }}>{VARIANT_TAGS[i] || `改法${i + 1}`}</span>
                {variants.applied?.idx === i ? (
                  <>
                    <span className="wb-pill" style={{ marginLeft: 'auto', color: '#3f7350', background: 'rgba(63,115,80,.12)', flex: 'none' }}>✅ 已替换</span>
                    <button className="wb-btn-ghost" style={{ flex: 'none' }} title="撤销这次替换，三个候选恢复可选"
                      onClick={undoVariant}>撤销</button>
                  </>
                ) : !variants.applied && (
                  <button className="wb-btn-ghost" style={{ marginLeft: 'auto', flex: 'none' }} onClick={() => applyVariant(opt, i)}>用这个替换</button>
                )}
              </div>
              <div style={{ marginTop: 6, color: 'var(--body2)', whiteSpace: 'pre-wrap' }}>{opt}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ADR-046 ③ 出片：母稿 → 选平台形态（多选）→ 适配稿(看/改) → 主题占位 → 各平台出片。
// P1 渲染只接：图卡渲染器（小红书/抖音卡片）+ 公众号长文直用；视频渲染器(hyperframes)是 P2 占位。
function FilmPane({ draftEmpty, pforms, filmForms, toggleFilmForm, adapted, setAdapted, adaptBusy, adaptBatch,
  CARD_FORMS, VIDEO_FORMS, openCardsFor, copyText, openVideoFor, videoBusy, readaptOne, exportOne, exportAll,
  THEMES, filmTheme, setFilmTheme, setStudioTab, filmActiveForm, setFilmActiveForm, showToast, defaultTitle,
  boundPreset, boundTheme, seriesName }) {
  const pf = k => pforms.find(p => p.key === k) || { key: k, label: k, icon: '📝', note: '' }
  const rendHint = k => k === 'gzh-long' ? '长文体 · 直用母稿' : CARD_FORMS.has(k) ? '卡片体 · 图卡渲染器' : VIDEO_FORMS.has(k) ? '口播体 · 竖版分镜播放器' : '文案 · 复制发布'
  const editBody = (k, v) => setAdapted(a => ({ ...a, [k]: { ...a[k], body: v } }))
  // 展开/进编辑即把「右栏助手改的对象」切到这篇适配稿（passthrough=母稿本身不作为助手目标）
  const focusAssist = k => { if (!adapted[k]?.passthrough && !adapted[k]?.error) setFilmActiveForm?.(k) }
  const toggleOpen = k => { setAdapted(a => a[k] ? ({ ...a, [k]: { ...a[k], open: !a[k].open } }) : a); if (!adapted[k]?.open) focusAssist(k) }
  const toggleEdit = k => { setAdapted(a => ({ ...a, [k]: { ...a[k], editing: !a[k].editing, open: true } })); focusAssist(k) }
  const selected = [...filmForms]

  if (draftEmpty) {
    return (
      <div className="wb-card" style={{ padding: '18px 20px', textAlign: 'center', color: 'var(--sub)' }}>
        <div style={{ fontSize: 13.5, marginBottom: 10 }}>还没有母稿——出片是把定稿的母稿一鱼多吃成各平台稿。</div>
        <button className="wb-btn-primary" onClick={() => setStudioTab('edit')}>← 先去②定稿写好母稿</button>
      </div>
    )
  }

  return (
    <>
      <div style={{ fontSize: 12.5, color: 'var(--sub2)', marginBottom: 11 }}>母稿是最厚那版；下面把它压/改成各平台稿，渲染前你过一眼、可改。</div>

      {/* ① 选平台形态（多选，每个自带合适文体） */}
      <div style={{ border: '1px solid var(--line10)', borderRadius: 11, padding: '13px 14px', marginBottom: 11, background: 'var(--surface)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>① 选平台形态 <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--sub2)' }}>· 可多选，每个自带合适文体，自动从母稿适配</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 7, marginTop: 10 }}>
          {pforms.map(p => {
            const on = filmForms.has(p.key)
            return (
              <div key={p.key} onClick={() => toggleFilmForm(p.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, border: `1.4px solid ${on ? 'var(--accent)' : 'var(--line10)'}`, background: on ? 'rgba(61,90,128,.06)' : 'var(--surface)', borderRadius: 9, padding: '8px 11px', cursor: 'pointer' }}>
                <span style={{ fontSize: 16 }}>{p.icon || '📝'}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--body)' }}>{p.label}</span>
                  <span style={{ display: 'block', fontSize: 9.5, color: 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>· {rendHint(p.key)}</span>
                </span>
                <span style={{ flex: 'none', width: 17, height: 17, borderRadius: 5, border: `1.4px solid ${on ? 'var(--accent)' : 'var(--line14)'}`, background: on ? 'var(--accent)' : 'transparent', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? '✓' : ''}</span>
              </div>
            )
          })}
        </div>
        <button className="wb-btn-primary" style={{ marginTop: 12 }} disabled={adaptBusy || filmForms.size === 0} onClick={adaptBatch}>
          {adaptBusy ? '适配中…' : `⚡ 一键适配母稿 → ${filmForms.size} 个平台`}
        </button>
      </div>

      {/* ② 适配稿·看/改 + 产出管理（导出/重出） */}
      <div style={{ border: '1px solid var(--line10)', borderRadius: 11, padding: '13px 14px', marginBottom: 11, background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>② 适配稿 · 看 / 改</span>
          <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--sub2)', flex: 1 }}>· 母稿已按各平台适配，渲染前过一眼、可改</span>
          {selected.filter(k => adapted[k]?.body).length > 0 && (
            <button className="wb-btn-ghost" title="把各平台适配稿打包导出为一个 Markdown（每平台一节）" onClick={exportAll}>⬇ 全部导出</button>
          )}
        </div>
        {selected.filter(k => adapted[k]).length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--faint)', padding: '10px 2px' }}>还没适配——选好平台形态，点上面「一键适配母稿」。</div>
        )}
        {selected.filter(k => adapted[k]).map(k => {
          const a = adapted[k], p = pf(k)
          const render = a.passthrough
            ? <button className="wb-btn-outline" onClick={() => copyText(a.body)}>复制长文</button>
            : a.error ? <span style={{ fontSize: 11, color: 'var(--red)' }}>适配失败</span>
            : CARD_FORMS.has(k) ? <button className="wb-btn-primary" onClick={() => openCardsFor(k)}>生成图文卡片 →</button>
            : VIDEO_FORMS.has(k) ? <button className="wb-btn-primary" disabled={videoBusy} title="口播稿→竖版分镜播放器，站内预览节奏（不配音、不渲染 MP4，剪映收尾）" onClick={() => openVideoFor(k)}>{videoBusy ? '切分镜中…' : '🎬 生成分镜播放器 →'}</button>
            : <button className="wb-btn-outline" onClick={() => copyText(a.body)}>复制文案</button>
          return (
            <div key={k} style={{ border: '1px solid var(--line10)', borderRadius: 9, marginTop: 9, overflow: 'hidden', background: 'var(--surface)' }}>
              <div onClick={() => toggleOpen(k)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', cursor: 'pointer' }}>
                <span style={{ fontSize: 15 }}>{p.icon || '📝'}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--body)' }}>{p.label}</span>
                {a.error
                  ? <span style={{ fontSize: 10.5, color: 'var(--red)' }}>✕ {a.error.slice(0, 20)}</span>
                  : <span style={{ fontSize: 10.5, color: a.passthrough ? 'var(--sub2)' : 'var(--green)' }}>{a.passthrough ? '= 母稿本身' : '✓ 已适配'}</span>}
                {filmActiveForm === k && !a.passthrough && !a.error && (
                  <span title="右栏「创作助手」当前改的就是这篇" style={{ fontSize: 10, color: 'var(--accent)', background: 'rgba(61,90,128,.11)', borderRadius: 4, padding: '1px 6px' }}>🤖 助手改这篇</span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent)' }}>{a.open ? '收起 ▴' : '看 / 改 ▾'}</span>
              </div>
              {a.open && !a.error && (
                <div style={{ borderTop: '1px solid var(--line08)', padding: '10px 12px 12px' }}>
                  {a.editing ? (
                    <textarea value={a.body} onChange={e => editBody(k, e.target.value)}
                      style={{ width: '100%', minHeight: 160, fontSize: 12.5, lineHeight: 1.7, padding: '9px 11px', border: '1px solid var(--line10)', borderRadius: 7, background: 'var(--surface)', color: 'var(--body)', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                  ) : (
                    <div style={{ fontSize: 12.5, lineHeight: 1.75, color: 'var(--body)', whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>{a.body}</div>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                    <button className={a.editing ? 'wb-btn-primary' : 'wb-btn-ghost'} onClick={() => toggleEdit(k)}>{a.editing ? '✓ 改完' : '✎ 直接改文字'}</button>
                    {!a.passthrough && (
                      <button className="wb-btn-ghost" title="切到右栏「创作助手」改这篇——用大白话说「钩子再狠点」「压到 60 秒」" onClick={() => { focusAssist(k); showToast?.('右栏「创作助手」现在改这篇适配稿——说「钩子再狠点」试试') }}>🤖 让助手改这篇</button>
                    )}
                    <button className="wb-btn-ghost" title="复制该适配稿（去 [素材N] 标记）" onClick={() => copyText(a.body)}>📋 复制</button>
                    <button className="wb-btn-ghost" title="导出这篇为文件（长文=.md，其余=.txt）" onClick={() => exportOne(k)}>⬇ 导出</button>
                    {!a.passthrough && (
                      <button className="wb-btn-ghost" disabled={a.reBusy} title="丢弃这篇、按母稿重新适配一版（改坏了想回滚用）" onClick={() => readaptOne(k)}>{a.reBusy ? '重出中…' : '↻ 重出'}</button>
                    )}
                    <span style={{ marginLeft: 'auto' }}>{render}</span>
                  </div>
                </div>
              )}
              {!a.open && !a.error && (
                <div style={{ borderTop: '1px solid var(--line08)', padding: '8px 12px', display: 'flex', justifyContent: 'flex-end' }}>{render}</div>
              )}
            </div>
          )
        })}
      </div>

      {/* ③ 视觉主题（P1 占位，喂图卡渲染器）+ 配音（P2） */}
      <div style={{ border: '1px solid var(--line10)', borderRadius: 11, padding: '13px 14px', background: 'var(--surface)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>③ 视觉主题 <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--sub2)' }}>· 图卡/视频共用（配音 P2）</span></div>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          {THEMES.map(([key, name, bg, fg]) => {
            const on = filmTheme === key
            return (
              <div key={key} onClick={() => setFilmTheme(key)} style={{ width: 80, border: `2px solid ${on ? 'var(--accent)' : 'var(--line14)'}`, borderRadius: 9, overflow: 'hidden', cursor: 'pointer' }}>
                <div style={{ height: 38, background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 700 }}>{name.slice(0, 1)}</div>
                <div style={{ fontSize: 10, padding: 4, textAlign: 'center', color: on ? 'var(--accent)' : 'var(--body)', fontWeight: on ? 700 : 400 }}>{name}</div>
              </div>
            )
          })}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--sub2)', marginTop: 11 }}>🎙 配音在竖版播放器里（edge-tts 免费·单独触发）· 背景乐随后</div>
      </div>

      {/* ④ 公众号头图（ADR-052 P1 · AI 观察手记系列）：字段 → 双尺寸 PNG */}
      <CoverPanel showToast={showToast} defaultTitle={defaultTitle} boundPreset={boundPreset} seriesName={seriesName} />

      {/* ⑤ 公众号排版（ADR-052 P2 · vendored gzh-design）：定稿 → 合规 HTML */}
      <TypesetPanel showToast={showToast} articleMd={adapted['gzh-long']?.body || ''} boundTheme={boundTheme} seriesName={seriesName} />
    </>
  )
}

// ADR-052 P2 排版面板：选主题 → LLM 装配 + 校验兜底 → 合规公众号 HTML；预览 + 复制到公众号 + 下载。
function TypesetPanel({ showToast, articleMd, boundTheme, seriesName }) {
  const [themes, setThemes] = useState([])
  const [theme, setTheme] = useState('olive-journal')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { html, errors, warnings, leaf }
  useEffect(() => { (async () => { try { const j = await api('/api/studio/article-themes'); setThemes(j.data || []) } catch { /* 静默 */ } })() }, [])
  // P4 联动：定稿选了系列风格 → 排版主题跟随（仍可手改=软绑定）
  useEffect(() => { if (boundTheme) setTheme(boundTheme) }, [boundTheme])
  const gen = async () => {
    if (!articleMd?.trim()) { showToast('先在②一键适配母稿，把「公众号长文」备好'); return }
    setBusy(true); showToast('正在排版（LLM 装配 + 合规校验，约 40–90 秒）…')
    try {
      const j = await api('/api/studio/typeset', { method: 'POST', body: { article_md: articleMd, theme } })
      setResult(j.data)
      const clean = j.data.errors.length === 0 && j.data.warnings.length === 0
      showToast(clean ? `排版完成 · ✅ 合规 0/0（¥${j.data.cost.toFixed(3)}）` : `排版完成 · ⚠️ 还剩 ${j.data.errors.length} ERROR/${j.data.warnings.length} WARN`)
    } catch (err) { showToast('排版失败：' + err.message) }
    setBusy(false)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([result.html], { type: 'text/html' }),
        'text/plain': new Blob([result.html], { type: 'text/plain' }),
      })])
      showToast('已复制富文本 → 到公众号编辑器 Ctrl/⌘+V 粘贴（样式保留）')
    } catch { showToast('浏览器限制复制——用「下载 HTML」，浏览器打开后全选复制兜底') }
  }
  const dl = () => { const blob = new Blob([result.html], { type: 'text/html;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '公众号排版.html'; a.click(); URL.revokeObjectURL(a.href) }
  const clean = result && result.errors.length === 0 && result.warnings.length === 0
  return (
    <div style={{ border: '1px solid var(--line10)', borderRadius: 11, padding: '13px 14px', marginTop: 11, background: 'var(--surface)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>⑤ 公众号排版 <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--sub2)' }}>· 定稿 → 可粘贴公众号的合规 HTML（LLM 装配 + 校验兜底）</span></div>
      {!articleMd?.trim() && <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 8 }}>先在②「一键适配母稿」把公众号长文备好，再来排版。</div>}
      <div style={{ fontSize: 11, color: 'var(--sub2)', fontWeight: 600, margin: '8px 0 6px' }}>排版主题{boundTheme && seriesName && <span style={{ fontWeight: 400, color: 'var(--accent)', marginLeft: 6 }}>· 已跟随定稿的「{seriesName}」（可改）</span>}</div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
        {themes.map(t => (
          <span key={t.key} onClick={() => setTheme(t.key)} title={t.hint}
            style={{ border: '1px solid var(--line10)', background: theme === t.key ? 'var(--accent)' : 'var(--surface)', color: theme === t.key ? '#fff' : 'var(--body)', borderRadius: 16, padding: '5px 11px', fontSize: 12.5, cursor: 'pointer' }}>{t.name}</span>
        ))}
      </div>
      <button className="wb-btn-primary" disabled={busy || !articleMd?.trim()} onClick={gen}>{busy ? '排版中（约 1 分钟）…' : (result ? '↻ 重新排版' : '📰 排版成公众号 HTML')}</button>

      {result && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: clean ? 'var(--green)' : 'var(--amber)' }}>
              {clean ? '✅ 合规校验 0 ERROR / 0 WARNING' : `⚠️ 剩 ${result.errors.length} ERROR / ${result.warnings.length} WARNING`}
            </span>
            <span style={{ fontSize: 11, color: 'var(--faint)' }}>· {result.leaf} 处 span leaf</span>
            <span style={{ marginLeft: 'auto' }} />
            <button className="wb-btn-primary" onClick={copy}>📋 复制到公众号</button>
            <button className="wb-btn-ghost" onClick={dl}>⬇ 下载 HTML</button>
          </div>
          {!clean && (
            <div style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 8, lineHeight: 1.5 }}>
              {[...result.errors, ...result.warnings].slice(0, 3).map((m, i) => <div key={i}>· {m}</div>)}
            </div>
          )}
          <iframe title="公众号排版预览" srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">${result.html}</body>`}
            style={{ width: '100%', height: 460, border: '1px solid var(--line10)', borderRadius: 8, background: '#fff' }} />
          <div style={{ fontSize: 11, color: 'var(--sub2)', marginTop: 6 }}>预览即最终效果 · 点「复制到公众号」→ 公众号编辑器 Ctrl/⌘+V 粘贴，样式保留。</div>
        </div>
      )}
    </div>
  )
}

// 头图字段（模块级组件，稳定 identity——定义在 CoverPanel 内会每次输入就重挂、丢焦点）
// chips：常用值一键填入（可点可不点，输入框仍自由编辑——预设是提议，不替用户决定）
function CoverField({ label, k, ph, area, f, set, chips }) {
  const st = { width: '100%', marginTop: 3, padding: '6px 9px', fontSize: 12.5, border: '1px solid var(--line10)', borderRadius: 6, background: 'var(--surface)', color: 'var(--body)', boxSizing: 'border-box' }
  return (
    <label style={{ display: 'block', marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--sub2)', fontWeight: 600 }}>{label}</span>
      {area
        ? <textarea value={f[k]} onChange={e => set(k, e.target.value)} placeholder={ph} style={{ ...st, minHeight: 42, resize: 'vertical', fontFamily: 'inherit' }} />
        : <input value={f[k]} onChange={e => set(k, e.target.value)} placeholder={ph} style={st} />}
      {chips && chips.length > 0 && (
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          {chips.map(c => (
            <span key={c} onClick={e => { e.preventDefault(); set(k, c) }}
              style={{ fontSize: 10.5, padding: '1px 8px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid ' + (f[k] === c ? 'var(--accent)' : 'var(--line10)'), color: f[k] === c ? 'var(--accent)' : 'var(--sub2)' }}>
              {c.replace(/\n/g, ' / ').replace(/<[^>]+>/g, '')}
            </span>
          ))}
        </span>
      )}
    </label>
  )
}

// 头图常用值（后端 cover-prefs）：预置 + 用过即成选项；期号自动 +1 只是预填，随时可手改
const bumpIssue = s => String(s || '').replace(/NO\.(\d+)/i, (_, n) => 'NO.' + String(+n + 1).padStart(2, '0'))
const uniqVals = a => [...new Set(a.filter(Boolean))]
const COVER_PRESET_OPTS = {
  name: ['AI 观察手记', 'AI 踩坑手记'],
  tag: ['深度精读', '深度复盘', '踩坑复盘', '实践复盘'],
  author_html: ['杰西卡　<b>AI 产品人</b> · 做过数百个数字化项目'],
}

// ADR-052 P1 头图面板：选系列风格 + 填期刊字段 → 生成双尺寸 PNG（消息大图 1800×766 + 方图 2000×2000）。
// title_html 只让用户填「主标题 + 点睛词」，UI 自动包一个 <span class="ul">（守 ux-no-raw-numbers，用户零 HTML）。
function CoverPanel({ showToast, defaultTitle, boundPreset, seriesName }) {
  const [presets, setPresets] = useState([])
  const [preset, setPreset] = useState('ticket-brisk')
  const [f, setF] = useState({ name: 'AI 观察手记', issue_event: '', badge: '', kicker: '', title: defaultTitle || '', keyword: '', author_html: '', tag: '深度精读' })
  const [prefs, setPrefs] = useState({ options: {}, last: {} })  // 常用值 + 上次出图字段（后端 app_meta 存，换浏览器不丢）
  const [kwSugg, setKwSugg] = useState([])  // 点睛词建议（显式按钮触发）
  const [kwBusy, setKwBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)  // { wide:{base64,w,h}, square:{...} }
  useEffect(() => { (async () => { try { const j = await api('/api/studio/series-presets'); setPresets(j.data || []) } catch { /* 静默 */ } })() }, [])
  // 带出上次出图的刊名/作者行/标签，期号预填"上次 +1"（都只是预填，任意可改）
  useEffect(() => { (async () => { try {
    const j = await api('/api/studio/cover-prefs'); const p = j.data || {}
    setPrefs({ options: p.options || {}, last: p.last || {} })
    const L = p.last || {}
    setF(s => ({ ...s, name: L.name || s.name, author_html: L.author_html || s.author_html, tag: L.tag || s.tag, issue_event: s.issue_event || bumpIssue(L.issue_event) }))
  } catch { /* 静默 */ } })() }, [])
  // P4 联动：定稿选了系列风格 → 头图预设跟随（仍可在下面手改=软绑定）
  useEffect(() => { if (boundPreset) setPreset(boundPreset) }, [boundPreset])
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const BADGES = [['', '无（默认隐藏）'], ['▶ YouTube', '▶ YouTube'], ['𝕏', '𝕏 Twitter'], ['✎ Blog', '✎ Blog'], ['🎧 播客', '🎧 播客'], ['🎤 现场', '🎤 现场'], ['⚡ 黑客松', '⚡ 黑客松']]
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const buildTitleHtml = () => {
    let e = esc(f.title); const ek = esc(f.keyword.trim())
    if (ek && e.includes(ek)) e = e.replace(ek, `<span class="ul">${ek}</span>`)  // 只包第一处 → 恰好一个 .ul
    return e.replace(/\n/g, '<br>')
  }
  const gen = async () => {
    if (!f.title.trim()) { showToast('先填主标题'); return }
    const kw = f.keyword.trim()
    if (kw && !f.title.includes(kw)) showToast('点睛词不在主标题里，这次先不加下划线（可改标题或点睛词）')  // 提示但不拦
    const skin = presets.find(p => p.id === preset)?.cover_skin || 'moyu-green'
    const content = { name: f.name, issue_event: f.issue_event.replace(/\n/g, '<br>'), badge: f.badge, kicker: f.kicker, title_html: buildTitleHtml(), author_html: f.author_html, tag: f.tag }
    setBusy(true); showToast('正在渲染头图（双尺寸，约 3–5 秒）…')
    try {
      const j = await api('/api/studio/cover', { method: 'POST', body: { skin, content } }); setResult(j.data.shapes); showToast('头图已生成（消息大图 + 方图）')
      // 出图成功才回写常用值/期号（以用户实际填的为准——重复生成同一期不会误 +1）
      api('/api/studio/cover-used', { method: 'POST', body: { name: f.name, issue_event: f.issue_event, author_html: f.author_html, tag: f.tag } })
        .then(r => { const p = r.data || {}; setPrefs({ options: p.options || {}, last: p.last || {} }) })
        .catch(() => { /* 静默 */ })
    }
    catch (err) { showToast('头图生成失败：' + err.message) }
    setBusy(false)
  }
  const suggestKeyword = async () => {
    setKwBusy(true)
    try {
      const j = await api('/api/studio/cover-keyword-suggest', { method: 'POST', body: { title: f.title } })
      setKwSugg(j.data || []); if (!(j.data || []).length) showToast('没挑出合适的词，手填一个也行')
    } catch (err) { showToast('建议失败：' + err.message) }
    setKwBusy(false)
  }
  const DL_NAME = { combined: '头图母图1800x1986', wide: '公众号封面1800x766', square: '转发方图2000x2000' }
  const dl = (shape) => { const v = result?.[shape]; if (!v) return; const a = document.createElement('a'); a.href = v.base64; a.download = `${DL_NAME[shape] || shape}.png`; a.click() }
  return (
    <div style={{ border: '1px solid var(--line10)', borderRadius: 11, padding: '13px 14px', marginTop: 11, background: 'var(--surface)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>④ 公众号头图 <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--sub2)' }}>· AI 观察手记系列 · 字段 → 双尺寸 PNG</span></div>
      <div style={{ fontSize: 11.5, color: 'var(--sub2)', marginBottom: 10 }}>选系列风格 + 填期刊字段，出「消息大图 1800×766 + 方图 2000×2000」。</div>
      <div style={{ fontSize: 11, color: 'var(--sub2)', fontWeight: 600, marginBottom: 6 }}>系列风格{boundPreset && seriesName && <span style={{ fontWeight: 400, color: 'var(--accent)', marginLeft: 6 }}>· 已跟随定稿的「{seriesName}」（可改）</span>}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {presets.map(p => (
          <span key={p.id} onClick={() => setPreset(p.id)}
            style={{ border: '1px solid var(--line10)', background: preset === p.id ? 'var(--accent)' : 'var(--surface)', color: preset === p.id ? '#fff' : 'var(--body)', borderRadius: 16, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer' }}>{p.name}</span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <CoverField f={f} set={set} label="刊名（报头左上）" k="name" ph="AI 观察手记"
          chips={uniqVals([...(prefs.options.name || []), ...COVER_PRESET_OPTS.name])} />
        <CoverField f={f} set={set} label="期号 + 场合（报头右上·可两行·期号可任意手改）" k="issue_event" ph="NO.01 · 视频演讲精读&#10;Compile 26 · Cursor 社区" area
          chips={uniqVals(prefs.last.issue_event ? [bumpIssue(prefs.last.issue_event), prefs.last.issue_event] : ['NO.01 · 写给上个月的我'])} />
        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--sub2)', fontWeight: 600 }}>来源徽章（可留空隐藏）</span>
          <select value={f.badge} onChange={e => set('badge', e.target.value)} style={{ width: '100%', marginTop: 3, padding: '6px 9px', fontSize: 12.5, border: '1px solid var(--line10)', borderRadius: 6, background: 'var(--surface)', color: 'var(--body)' }}>
            {BADGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <CoverField f={f} set={set} label="副标（kicker）" k="kicker" ph="一句话副标题" />
        <CoverField f={f} set={set} label="主标题（可换行）" k="title" ph="当造东西不再稀缺，产品人还剩下什么？" area />
        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--sub2)', fontWeight: 600 }}>点睛词（选填·标题里一个词，自动加下划线）</span>
          <span style={{ display: 'flex', gap: 6, marginTop: 3 }}>
            <input value={f.keyword} onChange={e => set('keyword', e.target.value)} placeholder="造东西"
              style={{ flex: 1, padding: '6px 9px', fontSize: 12.5, border: '1px solid var(--line10)', borderRadius: 6, background: 'var(--surface)', color: 'var(--body)', boxSizing: 'border-box' }} />
            <button className="wb-btn-ghost" disabled={kwBusy || !f.title.trim()} title={f.title.trim() ? '让 AI 从主标题里挑 2-4 个候选词' : '先填主标题'}
              onClick={e => { e.preventDefault(); suggestKeyword() }} style={{ whiteSpace: 'nowrap' }}>{kwBusy ? '…' : '✨ 从标题选'}</button>
          </span>
          {kwSugg.length > 0 && (
            <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {kwSugg.map(w => (
                <span key={w} onClick={e => { e.preventDefault(); set('keyword', w) }}
                  style={{ fontSize: 10.5, padding: '1px 8px', borderRadius: 10, cursor: 'pointer', border: '1px solid ' + (f.keyword === w ? 'var(--accent)' : 'var(--line10)'), color: f.keyword === w ? 'var(--accent)' : 'var(--sub2)' }}>{w}</span>
              ))}
            </span>
          )}
        </label>
        <CoverField f={f} set={set} label="作者行（可用 <b>身份</b> 上色）" k="author_html" ph="杰西卡　<b>AI 产品人</b> · 做过数百个数字化项目"
          chips={uniqVals([...(prefs.options.author_html || []), ...COVER_PRESET_OPTS.author_html])} />
        <CoverField f={f} set={set} label="类型标签" k="tag" ph="深度精读"
          chips={uniqVals([...(prefs.options.tag || []), ...COVER_PRESET_OPTS.tag])} />
      </div>
      <button className="wb-btn-primary" style={{ marginTop: 6 }} disabled={busy} onClick={gen}>{busy ? '渲染中…' : (result ? '↻ 重新生成头图' : '🖼 生成头图（双尺寸）')}</button>

      {result && result.combined && (
        <div style={{ marginTop: 14, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--sub2)', marginBottom: 5 }}>母图 · 1800×1986（上段裁公众号封面 2.35:1、下段裁转发方图 1:1）</div>
            <img src={result.combined.base64} alt="combined" style={{ width: 300, borderRadius: 8, border: '1px solid var(--line10)', display: 'block' }} />
            <button className="wb-btn-primary" style={{ marginTop: 8 }} onClick={() => dl('combined')}>⬇ 下载母图 PNG</button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--sub2)', lineHeight: 1.7, maxWidth: 220 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>也可单独下载：</div>
            <button className="wb-btn-ghost" style={{ marginBottom: 6 }} onClick={() => dl('wide')}>⬇ 上段·公众号封面 1800×766</button><br />
            <button className="wb-btn-ghost" onClick={() => dl('square')}>⬇ 下段·转发方图 2000×2000</button>
            <div style={{ marginTop: 10, color: 'var(--faint)' }}>上下段同一套设计、内容相同、互相独立——按平台各裁一段用。</div>
          </div>
        </div>
      )}
    </div>
  )
}
