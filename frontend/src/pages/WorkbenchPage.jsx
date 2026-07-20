import { useState, useEffect, useCallback, useRef } from 'react'
import '../styles/workbench.css'
import { api, streamEphemeralChat, sourceCapability } from '../components/wb/util'
import {
  IconFeed, IconNotes, IconTopics, IconStudio, IconSources, IconSettings,
  IconChevronLeft, IconBulb,
} from '../components/wb/Icons'
import FeedView from '../components/wb/FeedView'
import NotesView from '../components/wb/NotesView'
import InspirationsView from '../components/wb/InspirationsView'
import SourcesView from '../components/wb/SourcesView'
import TopicsView from '../components/wb/TopicsView'
import StudioView from '../components/wb/StudioView'
import ReportsView from '../components/wb/ReportsView'
import SettingsView from '../components/wb/SettingsView'
import RightPanel from '../components/wb/RightPanel'
import { IdeaModal, PoolModal, ImportModal } from '../components/wb/Modals'

// 知识工作台主壳（视觉规格：prototype/design_handoff_knowledge_workbench）。
// 三栏：左导航（可折叠 62px）/ 中栏页面 / 右栏快速分析·创作助手（可折叠 40px）。
// 六阶段是心智模型不是导航：资讯(①④)/素材(③)/主题(④M3)/灵感(选题种子)/创作(⑤⑥M4)/信源(①)/设置。
// 心智动线：看→存料(素材)→沉淀(主题)→要写什么(灵感)→写(创作)。

const NAV_TOP = [
  { key: 'feed', label: '资讯', Icon: IconFeed },
  { key: 'notes', label: '素材', Icon: IconNotes },
  { key: 'topics', label: '主题', Icon: IconTopics },
  { key: 'inspirations', label: '灵感', Icon: IconBulb },
  { key: 'studio', label: '创作', Icon: IconStudio },
]
const NAV_BOTTOM = [
  { key: 'sources', label: '信源', Icon: IconSources },
  { key: 'settings', label: '设置', Icon: IconSettings },
]

export default function WorkbenchPage() {
  const [page, setPage] = useState('feed')
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [toast, setToast] = useState('')
  const [toastAction, setToastAction] = useState(null) // {label,onClick} 可选，toast 里的按钮
  const toastTimer = useRef(null)

  // 可拖拽三栏（2026-07-16 反馈 #3，修订 ADR-004 固定宽）：宽度记 localStorage；
  // 右栏另有"展开至半屏"一键切换——长解读比逐像素拖更常用
  const [leftW, setLeftW] = useState(() => parseInt(localStorage.getItem('wb-left-w')) || 196)
  const [rightW, setRightW] = useState(() => parseInt(localStorage.getItem('wb-right-w')) || 322)
  const [rightWide, setRightWide] = useState(false)
  const startDrag = (side) => (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = side === 'left' ? leftW : rightW
    const calc = (ev) => side === 'left'
      ? Math.min(340, Math.max(150, startW + ev.clientX - startX))
      : Math.min(680, Math.max(262, startW - ev.clientX + startX))
    const move = (ev) => (side === 'left' ? setLeftW : setRightW)(calc(ev))
    const up = (ev) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      localStorage.setItem(side === 'left' ? 'wb-left-w' : 'wb-right-w', String(calc(ev)))
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // 数据
  const [contents, setContents] = useState([])
  const [report, setReport] = useState(null)
  const [stories, setStories] = useState([])
  const [ghTrending, setGhTrending] = useState({ repos: [], trend: null })
  const [notes, setNotes] = useState([])
  const [sources, setSources] = useState([])
  const [topics, setTopics] = useState([]) // M3 主题活页（/api/topics）
  const [ideas, setIdeas] = useState([]) // 灵感库（ADR-029，/api/ideas）——选题种子收口

  // 右栏（快速分析）
  const [selectedItems, setSelectedItems] = useState([]) // {id,title,adHoc?,capability}
  const [analysisMode, setAnalysisMode] = useState('list')
  const [chat, setChat] = useState([]) // {role:'user'|'ai', text, pending?, saved?, noteId?}
  const [degraded, setDegraded] = useState([]) // 本轮对话中降级为摘要的材料清单（SSE meta）
  const [libraryHits, setLibraryHits] = useState([]) // 问素材库/知识体系时纳入的素材或主题（SSE meta.retrieved）
  const [chatKind, setChatKind] = useState(null) // 'library' | 'knowledge' | null——右栏对话头部据此显示不同标签
  const chatHistory = useRef([]) // 发给后端的纯净历史

  // 弹窗
  const [modal, setModal] = useState(null) // 'pool'|'import'|'idea'
  const [ideaDetail, setIdeaDetail] = useState(null)

  // 站内定位：从创作台/主题页点素材标题 → 跳素材库并高亮该卡片；
  // returnPage 记住出发页，素材库顶部给「← 返回」（左导航主动切页时清除）
  const [highlightNoteId, setHighlightNoteId] = useState(null)
  const [returnPage, setReturnPage] = useState(null)
  const gotoNote = (noteId) => { setReturnPage(page); setHighlightNoteId(noteId); setPage('notes') }
  const goBack = () => { if (returnPage) { setPage(returnPage); setReturnPage(null) } }
  // 从创作台来源芯片/周报跳到主题详情；remember=true 时记住来路（周报里点主题跳走要能返回）
  const gotoTopic = (topicId, { remember = false } = {}) => {
    const tp = topics.find(t => t.id === topicId)
    if (!tp) { showToast('该主题页已被删除'); return }
    if (remember) setReturnPage(page)
    setActiveTopic(tp); setTopicView('page'); setPage('topics')
  }

  // 主题 / 创作台
  const [topicView, setTopicView] = useState('list')
  const [activeTopic, setActiveTopic] = useState(null)
  const [studio, setStudio] = useState({
    platform: 'thread', source: null, refs: [], draft: '', busy: false,
    // M4：草稿落库 + 活页起稿 + 段落级溯源持久化 + 观点入口（作者立场）
    draftId: null, title: null, sourceTopicId: null, paragraphRefs: [], viewpoint: '',
  })
  const [drafts, setDrafts] = useState([]) // 草稿箱
  const loadDrafts = useCallback(async () => {
    try { setDrafts((await api('/api/drafts')).data || []) } catch (err) { console.error(err) }
  }, [])
  // 平台模板动态化（P1 文件化）：列表来自 reference/prompts/creation/platforms/ 目录，
  // 加文件=加平台；接口失败时回落内置三平台，创作台不至于空白
  const [platforms, setPlatforms] = useState(FALLBACK_PLATFORMS)
  const loadPlatforms = useCallback(async () => {
    try {
      const list = (await api('/api/studio/platforms')).data
      if (list?.length) setPlatforms(list)
    } catch (err) { console.error('platforms:', err) }
  }, [])

  // action 可选：{ label, onClick } —— 在 toast 里带一个可点按钮（如「去素材页看看 →」）
  const showToast = useCallback((msg, action = null) => {
    setToast(msg)
    setToastAction(action)
    clearTimeout(toastTimer.current)
    // 长文案（如 link-only 的解释）2.6 秒读不完，按长度自适应；带按钮的多给点时间
    const ms = Math.min(action ? 9000 : 7000, Math.max(action ? 5000 : 2600, msg.length * 90))
    toastTimer.current = setTimeout(() => { setToast(''); setToastAction(null) }, ms)
  }, [])

  // ---- 数据加载 ----
  const loadContents = useCallback(async () => {
    try {
      const json = await api('/api/contents?limit=30')
      setContents((json.data || []).map(c => ({ ...c, tags: safeParse(c.tags) })))
    } catch (err) { console.error('contents:', err) }
  }, [])
  const loadBrief = useCallback(async () => {
    try {
      const [r, s, g] = await Promise.all([
        api('/api/reports/latest'), api('/api/stories?limit=3'), api('/api/github-trending'),
      ])
      setReport(r.data)
      setStories(s.data || [])
      setGhTrending(g.data || { repos: [], trend: null })
    } catch (err) { console.error('brief:', err) }
  }, [])
  const loadNotes = useCallback(async () => {
    try { setNotes((await api('/api/notes?limit=100')).data || []) } catch (err) { console.error(err) }
  }, [])
  const loadSources = useCallback(async () => {
    try { setSources((await api('/api/sources?registered=1')).data || []) } catch (err) { console.error(err) }
  }, [])
  const loadTopics = useCallback(async () => {
    try { setTopics((await api('/api/topics')).data || []) } catch (err) { console.error(err) }
  }, [])
  const loadIdeas = useCallback(async () => {
    try { setIdeas((await api('/api/ideas')).data || []) } catch (err) { console.error(err) }
  }, [])

  // 收录一条灵感（随手记 / 资讯一键收进 / 外部连接器）。payload: {title, sourceKind, sourceRef, supporting*}
  // 带「撤销」——feed 上点错 💡 能当场反悔（误触保护发生在误触当下，而不是逼你事后去别页删）
  const saveIdea = useCallback(async (payload) => {
    try {
      const json = await api('/api/ideas', { method: 'POST', body: payload })
      loadIdeas()
      const newId = json.data?.id
      const undo = newId ? {
        label: '撤销',
        onClick: async () => { try { await api(`/api/ideas/${newId}`, { method: 'DELETE' }); loadIdeas() } catch { /* 忽略 */ } },
      } : null
      const where = page === 'inspirations' ? '已收进灵感库' : '已收进灵感库（在左侧「灵感」里）'
      showToast(where, undo)
      return true
    } catch (err) { showToast(`收录失败：${err.message}`); return false }
  }, [loadIdeas, page, showToast])

  const deleteIdea = useCallback(async (idea) => {
    try { await api(`/api/ideas/${idea.id}`, { method: 'DELETE' }); loadIdeas() }
    catch (err) { showToast(`删除失败：${err.message}`) }
  }, [loadIdeas, showToast])

  // 星标切换（M7 轻量收藏）：返回新状态供 FeedView 同步本地筛选列表
  const toggleStar = useCallback(async (id) => {
    try {
      const json = await api(`/api/contents/${id}/star`, { method: 'POST' })
      setContents(prev => prev.map(c => c.id === id ? { ...c, starred: json.data.starred } : c))
      return json.data.starred
    } catch (err) { showToast(`星标失败：${err.message}`); return null }
  }, [showToast])

  // 素材库 tab（2026-07-16 反馈：选题建议迁入素材库，Feed 一行入口跳过来）
  const [notesTab, setNotesTab] = useState('mine') // 'mine' | 'ideas'

  // 素材卡选中解读（2026-07-16 反馈：素材要能用右侧 AI 助手）：
  // 有原文回链的走 Feed 同款管道（全文获取）；多篇聚合产物把摘录本身作 adHoc 材料
  const toggleSelectNote = (note) => {
    if (note.content_id) {
      toggleSelect({
        id: note.content_id,
        zh_title: note.title || note.content_zh_title || note.source_title,
        content_type: note.content_content_type,
        url: note.content_url,
      })
      return
    }
    const id = `note-${note.id}`
    setSelectedItems(prev => prev.find(x => x.id === id)
      ? prev.filter(x => x.id !== id)
      : [...prev, {
          id,
          title: `[素材] ${(note.title || note.source_title || '摘录').slice(0, 24)}`,
          adHoc: { zhTitle: note.title || note.source_title || '素材摘录', zhBody: note.excerpt, url: note.source_url || null, metadata: null },
          capability: { level: 'full', label: '素材' },
        }])
  }

  useEffect(() => { loadContents(); loadBrief(); loadNotes(); loadSources(); loadTopics(); loadIdeas(); loadDrafts(); loadPlatforms() }, [loadContents, loadBrief, loadNotes, loadSources, loadTopics, loadIdeas, loadDrafts, loadPlatforms])

  // ---- 快速分析 ----
  const toggleSelect = (c) => {
    setSelectedItems(prev => prev.find(x => x.id === c.id)
      ? prev.filter(x => x.id !== c.id)
      : [...prev, { id: c.id, title: c.zh_title || c.en_title || '(无标题)', capability: sourceCapability(c) }])
  }
  const removeSel = (id) => setSelectedItems(prev => prev.filter(x => x.id !== id))

  // 对话上下文指纹：主题探讨与选中内容分析共用一个右栏对话区，上下文变了
  // （换主题 / 主题↔选中切换）就自动重开对话，避免材料串台
  const chatContextRef = useRef(null)

  const libraryNoteIdsRef = useRef([]) // 当前"问素材库"会话首轮检索到的素材 id，供多轮追问复用

  const runChat = async (userText, { fresh = false, library = false, knowledge = false } = {}) => {
    const items = selectedItems
    // 主题详情页 = 探讨模式（P0，V3「沉淀=探讨」入口）：材料为主题综述+已收进素材。
    const onTopicPage = page === 'topics' && topicView === 'page' && activeTopic
    // library = 问素材库（原始弹药）；knowledge = 问知识体系（全部主题综述）。追问（sendChat）不带标志，
    // 但若当前会话就是该模式（chatContextRef）且没选中别的材料，则延续为多轮
    const knowledgeTurn = knowledge || (chatContextRef.current === 'knowledge' && !onTopicPage && !items.length)
    const libraryTurn = !knowledgeTurn && (library || (chatContextRef.current === 'library' && !onTopicPage && !items.length))
    if (!items.length && !onTopicPage && !libraryTurn && !knowledgeTurn) return
    const topicId = onTopicPage ? activeTopic.id : null

    const contextKey = knowledgeTurn ? 'knowledge' : libraryTurn ? 'library' : topicId ? `topic:${topicId}` : `items:${items.map(x => x.id).join(',')}`
    if (chatContextRef.current !== contextKey) { fresh = true; chatContextRef.current = contextKey }

    const history = fresh ? [] : chatHistory.current
    const userMsg = { role: 'user', content: userText }
    chatHistory.current = [...history, userMsg]
    setAnalysisMode('chat')
    setChat(prev => [...(fresh ? [] : prev), { role: 'user', text: userText }, { role: 'ai', text: '', pending: true }])
    try {
      // 首轮问素材库（library 显式且 fresh）走语义检索；追问复用首轮 noteIds（不重搜）。知识体系每轮喂全部主题综述
      const doSearch = library && fresh
      const special = libraryTurn || knowledgeTurn || topicId
      const contentIds = special ? [] : items.filter(x => !x.adHoc).map(x => x.id)
      const adHocContents = special ? [] : items.filter(x => x.adHoc).map(x => x.adHoc)
      const full = await streamEphemeralChat(
        {
          contentIds, adHocContents, topicId, messages: chatHistory.current,
          librarySearch: doSearch,
          noteIds: (libraryTurn && !doSearch) ? libraryNoteIdsRef.current : undefined,
          knowledgeBase: knowledgeTurn,
        },
        (text) => setChat(prev => patchLast(prev, { text, pending: true })),
        (deg, retrieved, kind) => {
          setDegraded(deg)
          if (kind) setChatKind(kind)
          if ((doSearch || knowledgeTurn) && retrieved?.length) {
            setLibraryHits(retrieved)
            if (doSearch) libraryNoteIdsRef.current = retrieved.map(n => n.id)
          }
        }
      )
      chatHistory.current.push({ role: 'assistant', content: full })
      setChat(prev => patchLast(prev, { text: full, pending: false }))
    } catch (err) {
      chatHistory.current.pop()
      setChat(prev => patchLast(prev, { text: `请求失败：${err.message}`, pending: false, error: true }))
    }
  }
  // 问素材库 / 问知识体系入口（右栏空态调用）——每次都是新会话
  const askLibrary = (q) => { if (q?.trim()) { chatContextRef.current = null; setChatKind(null); runChat(q.trim(), { library: true, fresh: true }) } }
  const askKnowledge = (q) => { if (q?.trim()) { chatContextRef.current = null; setChatKind(null); runChat(q.trim(), { knowledge: true, fresh: true }) } }

  // 即时分析模板（HANDOFF-2026-07-15）：prompt 维护在 reference/prompts/instant-analysis.md，
  // 经 /api/prompts/instant-analysis 拉取（首次拉取后缓存），改文件即改行为。
  // 拉取失败时用内置精简版兜底（不阻塞分析）。
  const analysisPromptRef = useRef(null)
  const FALLBACK_ANALYSIS_PROMPT =
    '请基于材料的元数据和正文写一篇结构化中文精读稿，让我不看原文也能完整理解：' +
    '讲述脉络（详尽）/ 关键案例与细节 / 值得记住的表述（限量直引）/ 局限与存疑 / 给我的 idea 钩子。' +
    '只写材料里真实存在的内容，无法确认的标注"存疑"。'
  const startAnalysis = async () => {
    if (!analysisPromptRef.current) {
      try {
        analysisPromptRef.current = (await api('/api/prompts/instant-analysis')).data.prompt
      } catch { analysisPromptRef.current = FALLBACK_ANALYSIS_PROMPT }
    }
    runChat(analysisPromptRef.current, { fresh: true })
  }

  const saveMsg = async (index) => {
    const msg = chat[index]
    if (!msg || msg.role !== 'ai' || msg.pending || msg.error || msg.noteId) return
    const real = selectedItems.filter(x => !x.adHoc)
    const single = real.length === 1 ? contents.find(c => c.id === real[0].id) : null
    // 粘贴内容的素材也要记源链接（唯一材料是 adHoc 时取它的 url），否则素材永远回不到原文
    const adHocs = selectedItems.filter(x => x.adHoc)
    const adHocUrl = !real.length && adHocs.length === 1 ? adHocs[0].adHoc.url : null
    try {
      const json = await api('/api/notes', {
        method: 'POST',
        body: {
          excerpt: msg.text, noteType: 'chat',
          contentId: single?.id || null,
          sourceTitle: selectedItems.map(x => x.title).join(' / ').slice(0, 120) || null,
          sourceUrl: single?.url || adHocUrl || null,
        },
      })
      setChat(prev => prev.map((m, i) => i === index ? { ...m, noteId: json.data.id } : m))
      loadNotes()
      // 存好后给个「去素材页看看 →」入口（gotoNote 会记住当前页，素材页顶部可一键返回）；
      // 已在素材页时不重复提示
      const goAction = page !== 'notes' ? { label: '去素材页看看 →', onClick: () => gotoNote(json.data.id) } : null
      // 保存即同化：高置信匹配（≥0.15）自动收进；弱匹配挂待收进等用户在主题页确认
      const matched = json.matchedTopics || []
      const strong = matched.filter(m => m.relevance >= 0.15)
      const weak = matched.filter(m => m.relevance < 0.15)
      if (strong.length) {
        showToast(`已存为素材，AI 正在收进主题「${strong.map(m => m.name).join('」「')}」${weak.length ? `；「${weak[0].name}」疑似相关，去主题页确认` : ''}`, goAction)
        setTimeout(loadTopics, 35000) // 同化完成后刷新主题统计
      } else if (weak.length) {
        loadTopics()
        showToast(`已存为素材，疑似与主题「${weak.map(m => m.name).join('」「')}」相关——去主题页确认是否收进`, goAction)
      } else {
        showToast('已存为素材卡片。想让它进入某个主题综述？在主题页建立相关主题即可自动归入', goAction)
      }
    } catch (err) { showToast(`保存失败：${err.message}`) }
  }

  // 把当前解读提为一条灵感（ADR-029：即时分析产物落素材，同时一键提成"要写什么"的种子）。
  // 标题取被解读内容的标题（去掉 "[类型]" 前缀），关联到当前选中的原始内容作支撑料。
  const saveMsgAsIdea = async (index) => {
    const msg = chat[index]
    if (!msg || msg.role !== 'ai' || msg.pending || msg.error || msg.ideaId) return
    const rawTitle = selectedItems[0]?.title?.replace(/^\[[^\]]+\]\s*/, '') || msg.text.split('\n')[0]
    const contentIds = selectedItems.filter(x => !x.adHoc).map(x => x.id)
    try {
      const json = await api('/api/ideas', {
        method: 'POST',
        body: { title: rawTitle.slice(0, 200), sourceKind: 'user', supportingContentIds: contentIds },
      })
      setChat(prev => prev.map((m, i) => i === index ? { ...m, ideaId: json.data.id } : m))
      loadIdeas()
      showToast('已提为灵感（在左侧「灵感」里）', { label: '去灵感库 →', onClick: () => setPage('inspirations') })
    } catch (err) { showToast(`提为灵感失败：${err.message}`) }
  }

  // 摄入结果 → 送入右栏解读（粘链接/文字 和 上传文件 共用）。
  // 只保留解读需要的字段：完整结果里的 transcript（几千段带时间戳）会把后续每轮对话请求
  // 撑到数 MB（曾触发 PayloadTooLarge）。metadata 必须随行——即时分析管道要求带元数据块。
  const beginAnalysisWith = (d, label, sourceUrl = null) => {
    const title = d.zhTitle || d.zh_title || d.enTitle || d.en_title || d.title || label
    const adHoc = {
      zhTitle: title,
      enTitle: d.enTitle || d.en_title || d.title || null,
      zhBody: d.zhBody || d.zh_body || null,
      body: (d.zhBody || d.zh_body) ? null : (d.body || null),
      url: sourceUrl,
      metadata: d.metadata || null,
    }
    setSelectedItems(prev => [...prev.filter(x => x.id !== 'paste'), { id: 'paste', title: `[${label}] ${title}`, adHoc }])
    setRightCollapsed(false)
    setTimeout(() => setAnalysisMode('chat'), 0)
  }

  // ---- 万能收口：粘贴链接/文字 → 摄入 → 进入解读 ----
  const acquire = async (input) => {
    showToast('正在识别并抓取内容…')
    try {
      const json = await api('/api/content/ingest', { method: 'POST', body: { input } })
      if (!json.success) throw new Error(json.data?.fetchError || json.error || '摄入失败')
      beginAnalysisWith(json.data, '粘贴', input.startsWith('http') ? input : null)
      return true
    } catch (err) {
      showToast(`摄入失败：${err.message}`)
      return false
    }
  }

  // ---- 上传文件（音频→转写全程 / PDF→抽文字）：异步任务，轮询进度，完成后进解读 ----
  const uploadFile = async (file, onStatus) => {
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/content/upload', { method: 'POST', body: fd })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || '上传失败')
      const { jobId, kind } = j.data
      onStatus?.({ status: 'processing', kind, filename: file.name, elapsedSec: 0 })
      // 轮询：音频转写可能几分钟，PDF 秒级
      for (;;) {
        await new Promise(r => setTimeout(r, kind === 'pdf' ? 1200 : 3000))
        const pj = await api(`/api/content/upload/${jobId}`)
        const job = pj.data
        onStatus?.(job)
        if (job.status === 'done') { beginAnalysisWith(job.result, kind === 'pdf' ? 'PDF' : '音频'); return true }
        if (job.status === 'error') throw new Error(job.error || '处理失败')
      }
    } catch (err) {
      showToast(`处理失败：${err.message}`)
      onStatus?.({ status: 'error', error: err.message })
      return false
    }
  }

  // selectedItems 更新后若含 paste 且 chat 为空 → 自动开始解读
  useEffect(() => {
    if (selectedItems.some(x => x.id === 'paste') && analysisMode === 'chat' && chat.length === 0) {
      startAnalysis()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItems, analysisMode])

  // 资讯页右栏：没选中内容时默认收起（UI 改造：空面板别白占 20% 屏），选中即自动展开。
  // 只作用于 feed（素材/主题页右栏有「问素材库/知识体系」入口，仍默认展开）。
  useEffect(() => {
    if (page === 'feed') setRightCollapsed(selectedItems.length === 0)
  }, [page, selectedItems.length])

  // ---- 信源 ----
  // 全量同步（反馈 #7：旧"刷新"只走 AI HOT，登记的 RSS/主动查询源永远不出新内容）
  const [syncing, setSyncing] = useState(false)
  const syncAllSources = async () => {
    if (syncing) return
    setSyncing(true)
    showToast('正在同步全部信源（AI HOT + RSS + 主动查询），可能需要 1-3 分钟…')
    try {
      const json = await api('/api/sync-all', { method: 'POST' })
      const ch = json.data.channels || {}
      const skipped = ch.activeQuery?.skipped?.length || 0
      showToast(`同步完成：AI HOT ${ch.aihot?.count ?? 0} 条 · RSS ${ch.rss?.count ?? 0} 条 · 主动查询新增 ${ch.activeQuery?.inserted ?? 0} 条${skipped ? `；${skipped} 个源暂不支持直接抓取（见信源页说明）` : ''}`)
      loadContents(); loadSources(); loadBrief()
    } catch (err) { showToast(`同步失败：${err.message}`) } finally { setSyncing(false) }
  }

  // 2026-07-17 反馈："点了没反应"——慢路径（首次识别的站点）后端要抓网页 + 探测 RSS，
  // 可达十几秒，必须有即时反馈 + 按钮态；结果按 track_mode 差异化说明，仅跳转不能装成追更成功
  const [followingIds, setFollowingIds] = useState(() => new Set())
  const followSource = async (contentId) => {
    if (followingIds.has(contentId)) return
    setFollowingIds(prev => new Set(prev).add(contentId))
    showToast('正在识别来源（新站点需抓取网页探测 RSS，可能要十几秒）…')
    try {
      const json = await api(`/api/contents/${contentId}/follow-source`, { method: 'POST' })
      setContents(prev => prev.map(c =>
        (c.id === contentId || (c.source_id && c.source_id === json.data.id))
          ? { ...c, source_id: json.data.id, source_registered: 1 } : c))
      loadSources()
      const modeText = {
        'active-rss': '，RSS 自动追更新内容',
        'active-query': '，每日主动追更',
        'passive': '，借道 AI HOT 收录其热门内容',
        'link-only': '。注意：该站无 RSS 且无法抓取，只登记跳转，不会自动追更',
      }[json.data.platforms?.[0]?.track_mode] || ''
      showToast(`已关注 ${json.data.display_name}（进 Feed · 加权）${modeText}`)
    } catch (err) { showToast(`关注失败：${err.message}`) }
    finally { setFollowingIds(prev => { const s = new Set(prev); s.delete(contentId); return s }) }
  }

  // ---- 日报 ----
  const [generating, setGenerating] = useState(false)
  const generateReport = async () => {
    setGenerating(true)
    showToast('正在生成今日简报（约 30 秒，调用 Deepseek）…')
    try {
      const json = await api('/api/reports/generate', { method: 'POST' })
      if (!json.success) throw new Error(json.error)
      setReport(json.data)
      loadBrief()
      showToast('今日简报已生成')
    } catch (err) { showToast(`生成失败：${err.message}`) } finally { setGenerating(false) }
  }

  // ---- 选题 ----
  const viewIdea = (idea) => { setIdeaDetail(idea); setModal('idea') }
  const upgradeIdea = async (idea) => {
    setModal(null); setReturnPage(page) // 记住来路（灵感库/素材页），主题页顶部可一键返回
    try {
      const json = await api('/api/topics/from-idea', { method: 'POST', body: { ideaId: idea.id } })
      await loadTopics(); loadIdeas()
      setActiveTopic(json.data); setTopicView('page'); setPage('topics')
      showToast(`已升级为主题页「${json.data.name}」，AI 将随素材收进持续维护综述`)
    } catch (err) {
      setPage('topics'); setTopicView('list')
      showToast(`建页失败：${err.message}`)
    }
  }
  const dismissIdea = async (idea) => {
    try { await api(`/api/ideas/${idea.id}`, { method: 'PATCH', body: { status: 'dismissed' } }) } catch { /* 忽略 */ }
    setModal(null); loadBrief(); loadIdeas()
  }
  const createFromIdea = async (idea, platform = 'thread') => {
    setModal(null); setReturnPage(page); setPage('studio') // 记住来路（灵感库/素材页），创作台顶部可一键返回
    const supportId = (idea.supporting_content_ids || [])[0]
    setStudio(s => ({ ...s, platform, source: `选题：${idea.title}`, sourceContentId: supportId || null, draft: '', refs: [] }))
    api(`/api/ideas/${idea.id}`, { method: 'PATCH', body: { status: 'created' } }).then(() => loadIdeas()).catch(() => {})
    setTimeout(() => genDraftRef.current(platform, supportId), 0)
  }

  // ---- 创作台 ----
  const genDraftRef = useRef(() => {})
  genDraftRef.current = async (platform = studio.platform, sourceContentId = studio.sourceContentId) => {
    // 活页起稿（M4）：活页综述做骨架 + 已收进素材可溯源引用，生成即落库
    if (studio.sourceTopicId) {
      setStudio(s => ({ ...s, busy: true, draft: s.draft || '正在基于主题页起稿（约 30 秒）…' }))
      try {
        const json = await api(`/api/topics/${studio.sourceTopicId}/draft`, { method: 'POST', body: { platform, viewpoint: studio.viewpoint || null } })
        const d = json.data
        setStudio(s => ({
          ...s, busy: false, draft: d.body, title: d.title, draftId: d.id,
          paragraphRefs: d.paragraph_refs,
          refs: d.paragraph_refs.map(r => ({ note: r.sourceTitle || '素材', para: r.marker })),
        }))
        loadDrafts()
        showToast(`已基于主题页起稿并存入草稿箱（引用 ${d.paragraph_refs.length} 条素材，¥${d.cost_yuan?.toFixed(3)}）`)
        return
      } catch (err) {
        setStudio(s => ({ ...s, busy: false }))
        showToast(`起稿失败：${err.message}，已填入模板`)
      }
    }
    if (platform === 'thread' && sourceContentId) {
      setStudio(s => ({ ...s, busy: true, draft: s.draft || '正在基于原文生成 thread…' }))
      try {
        const json = await api(`/api/contents/${sourceContentId}/thread`, { method: 'POST' })
        const text = json.data.tweets.map((t, i) => `${i + 1}/ ${t}`).join('\n\n')
        setStudio(s => ({ ...s, busy: false, draft: text }))
        showToast(json.data.basedOnOriginal ? '已基于原文生成 thread' : '未获取到原文，本稿基于摘要生成')
        return
      } catch (err) {
        setStudio(s => ({ ...s, busy: false }))
        showToast(`生成失败：${err.message}，已填入模板`)
      }
    }
    // 手动/粘贴稿（无生成来源）：有实质内容 → 平台裂变（把当前稿改写为目标平台版，
    // 2026-07-16 用户实测：粘贴文章点「小红书图文」曾无反应）；内容太短 → 占位模板。
    // 转换成功后 draftId 置空 = 成为新稿——保存时另存，不覆盖草稿箱里的原稿
    if (studio.draft.trim().length >= 50) {
      const label = platforms.find(p => p.key === platform)?.label || platform
      if (!confirm(`把当前草稿改写为「${label}」版本？\n改写后是一份新稿（原稿仍在草稿箱），也可「撤销改写」回退`)) return
      setStudio(s => ({ ...s, busy: true }))
      try {
        const json = await api('/api/studio/adapt', { method: 'POST', body: { draft: studio.draft, platform } })
        setStudio(s => ({ ...s, busy: false, prevDraft: s.draft, draft: json.data.draft, draftId: null, source: s.source || '平台转换稿' }))
        showToast(json.data.note + '，点「保存草稿」另存')
      } catch (err) {
        setStudio(s => ({ ...s, busy: false }))
        showToast(`平台转换失败：${err.message}`)
      }
      return
    }
    setStudio(s => ({ ...s, draft: DRAFT_TEMPLATES[platform] || '' }))
  }

  // 保存草稿（已有 draftId 则更新，否则新建）
  const saveDraft = async () => {
    if (!studio.draft.trim()) { showToast('草稿为空'); return }
    try {
      if (studio.draftId) {
        await api(`/api/drafts/${studio.draftId}`, { method: 'PATCH', body: { body: studio.draft, title: studio.title, paragraphRefs: studio.paragraphRefs } })
      } else {
        const json = await api('/api/drafts', {
          method: 'POST',
          body: {
            platform: studio.platform, title: studio.title || studio.draft.split('\n')[0].slice(0, 60),
            body: studio.draft, paragraphRefs: studio.paragraphRefs,
            sourceKind: studio.sourceTopicId ? 'topic' : 'manual',
            sourceId: studio.sourceTopicId, sourceLabel: studio.source,
          },
        })
        setStudio(s => ({ ...s, draftId: json.data.id }))
      }
      loadDrafts()
      showToast('草稿已保存（关页不丢）')
    } catch (err) { showToast(`保存失败：${err.message}`) }
  }

  // 打开草稿箱中的稿件
  const openDraft = (d) => {
    setStudio(s => ({
      ...s, platform: d.platform, draft: d.body, title: d.title, draftId: d.id,
      source: d.source_label, sourceTopicId: d.source_kind === 'topic' ? d.source_id : null,
      paragraphRefs: d.paragraph_refs || [],
      refs: (d.paragraph_refs || []).map(r => ({ note: r.sourceTitle || '素材', para: r.marker })),
    }))
  }

  // 润色（三遍改写一道工序，让它更好读），改写后替换草稿区，由用户决定是否保存。
  // 覆盖前把上一版存进 prevDraft —— 改坏了可一步撤销
  const humanizeDraft = async () => {
    if (!studio.draft.trim()) { showToast('草稿为空'); return }
    setStudio(s => ({ ...s, busy: true }))
    showToast('正在润色（约 30 秒）…')
    try {
      const json = await api('/api/studio/humanize', { method: 'POST', body: { draft: studio.draft, platform: studio.platform } })
      setStudio(s => ({ ...s, busy: false, prevDraft: s.draft, draft: json.data.text }))
      showToast(`已完成润色（¥${json.data.cost?.toFixed(3)}），不满意可点「撤销改写」`)
    } catch (err) {
      setStudio(s => ({ ...s, busy: false }))
      showToast(`审校失败：${err.message}`)
    }
  }

  // 一步撤销：换回改写前的版本（再点一次可换回来，两版互换）
  const undoRewrite = () => {
    setStudio(s => (s.prevDraft ? { ...s, draft: s.prevDraft, prevDraft: s.draft } : s))
    showToast('已切换到另一版（可再点切回）')
  }

  // 删除当前打开的草稿
  const deleteCurrentDraft = async () => {
    if (!studio.draftId) return
    if (!confirm('删除这份草稿？（不可恢复）')) return
    try {
      await api(`/api/drafts/${studio.draftId}`, { method: 'DELETE' })
      setStudio(s => ({ ...s, draftId: null, draft: '', title: null, refs: [], paragraphRefs: [], prevDraft: null }))
      loadDrafts()
      showToast('草稿已删除')
    } catch (err) { showToast(`删除失败：${err.message}`) }
  }
  // 草稿箱批量删除（勾选后一次删多份）
  const deleteDrafts = async (ids) => {
    if (!ids?.length) return
    if (!confirm(`删除选中的 ${ids.length} 份草稿？（不可恢复）`)) return
    try {
      for (const id of ids) await api(`/api/drafts/${id}`, { method: 'DELETE' })
      if (studio.draftId && ids.includes(studio.draftId)) setStudio(s => ({ ...s, draftId: null, draft: '', title: null, refs: [], paragraphRefs: [], prevDraft: null }))
      loadDrafts()
      showToast(`已删除 ${ids.length} 份草稿`)
    } catch (err) { showToast(`删除失败：${err.message}`) }
  }

  // 标题候选（长文）：5 个风格错开的标题供挑选
  const suggestTitles = async () => {
    if (!studio.draft.trim()) { showToast('草稿为空'); return }
    showToast('AI 正在拟 5 个标题…')
    try {
      const titles = (await api('/api/studio/titles', { method: 'POST', body: { draft: studio.draft } })).data
      const input = prompt(`标题候选：\n${titles.map((t, i) => `${i + 1}) ${t}`).join('\n')}\n\n输入数字选用，或直接输入自己的标题：`, '')
      if (!input?.trim()) return
      const picked = /^[1-5]$/.test(input.trim()) ? titles[parseInt(input.trim()) - 1] : input.trim()
      if (!picked) return
      setStudio(s => {
        // 长文首行是标题：替换首行；否则插到最前
        const lines = s.draft.split('\n')
        const firstLineIsTitle = /^#?\s*.{4,60}$/.test(lines[0]) && !lines[0].startsWith('>')
        const draft = firstLineIsTitle ? [`# ${picked}`, ...lines.slice(1)].join('\n') : `# ${picked}\n\n${s.draft}`
        return { ...s, title: picked, draft }
      })
      showToast(`已换标题：「${picked}」`)
    } catch (err) { showToast(`标题生成失败：${err.message}`) }
  }

  // 可插入素材按「与当前草稿的相关度」排序（2026-07-16 用户实测：原来按保存时间倒序，
  // 写 A 主题却推 B 主题素材）。本地 TF 余弦，debounce 600ms 避免每次击键都请求。
  const [rankedNotes, setRankedNotes] = useState(null)
  useEffect(() => {
    if (page !== 'studio') return
    const t = setTimeout(async () => {
      try {
        const draftText = `${studio.title || ''}\n${studio.draft || ''}`.slice(0, 4000)
        const json = await api('/api/studio/rank-materials', { method: 'POST', body: { draft: draftText, topicId: studio.sourceTopicId || null } })
        setRankedNotes(json.data || [])
      } catch (err) { console.error('rank-materials:', err); setRankedNotes(null) }
    }, 600)
    return () => clearTimeout(t)
  }, [page, studio.draft, studio.title, studio.sourceTopicId, notes])

  const insertMaterial = (note) => {
    const label = note.content_zh_title || note.source_title || '素材'
    setStudio(s => ({
      ...s,
      draft: (s.draft ? s.draft + '\n\n' : '') + `> ${note.excerpt}\n  —— 引自《${label}》（可溯源）`,
      refs: [...s.refs, { note: label, para: '引块' }],
      // 手动插入也进持久化引用链（保存草稿时随稿落库）
      paragraphRefs: [...s.paragraphRefs, { marker: '引块', noteId: note.id, sourceTitle: label, contentId: note.content_id || null }],
    }))
  }

  // 删除引用：从引用链移除，并尽力把对应文本从草稿里清掉
  // （[素材N] 标记删标记本身、句子保留；手动引块按摘录前缀匹配整块删除）
  const removeRef = (index) => {
    setStudio(s => {
      const ref = s.paragraphRefs[index]
      let draft = s.draft
      if (ref) {
        if (ref.marker?.startsWith('[素材')) {
          draft = draft.split(ref.marker).join('')
        } else {
          const note = notes.find(n => n.id === ref.noteId)
          if (note) {
            const block = `> ${note.excerpt}\n  —— 引自《${ref.sourceTitle}》（可溯源）`
            draft = draft.replace('\n\n' + block, '').replace(block, '')
          }
        }
      }
      return {
        ...s, draft,
        refs: s.refs.filter((_, i) => i !== index),
        paragraphRefs: s.paragraphRefs.filter((_, i) => i !== index),
      }
    })
    showToast('已移除该引用（草稿中的对应标记/引块已清理）')
  }

  const rewriteDraft = async (instruction) => {
    const json = await api('/api/studio/rewrite', { method: 'POST', body: { draft: studio.draft, instruction, platform: studio.platform } })
    setStudio(s => ({ ...s, prevDraft: s.draft, draft: json.data.draft }))
    return json.data.note || `已按要求改写草稿：${instruction}`
  }

  // 导出发布版：剥掉 [素材N] 行内标记（对读者是噪音），文末附参考来源列表。
  // 草稿原文不动——工作台里保留溯源标记，导出物才做清洗
  const exportMd = () => {
    let text = studio.draft.replace(/\s*\[素材\d+\]/g, '')
    const markers = [...new Set([...studio.draft.matchAll(/\[素材\d+\]/g)].map(m => m[0]))]
    const usedRefs = studio.paragraphRefs.filter(r => r.marker === '引块' || markers.includes(r.marker))
    if (usedRefs.length) {
      text += '\n\n---\n\n**参考来源**\n\n' + usedRefs.map((r, i) => {
        const note = notes.find(n => n.id === r.noteId)
        const url = note?.content_url || note?.source_url
        return `${i + 1}. ${note?.title || r.sourceTitle || '素材'}${url ? `：${url}` : ''}`
      }).join('\n')
    }
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `draft-${studio.platform}-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(a.href)
    showToast(`已导出发布版 Markdown（溯源标记已转为文末来源列表${usedRefs.length ? `，${usedRefs.length} 条` : ''}）`)
  }

  // ---- 渲染 ----
  const navItem = (n) => (
    <button key={n.key} className={`wb-nav-item${page === n.key ? ' active' : ''}`} onClick={() => { setPage(n.key); setModal(null); setReturnPage(null) }}>
      <span className="wb-nav-icon"><n.Icon /></span>
      <span className="wb-nav-label">{n.label}</span>
    </button>
  )

  const pageProps = {
    showToast, contents, report, stories, ghTrending, notes, sources, topics, ideas, toggleStar,
    selectedItems, toggleSelect, followSource, followingIds, acquire, uploadFile, syncing, syncAllSources,
    generateReport, generating, viewIdea, upgradeIdea, createFromIdea, dismissIdea, deleteIdea, saveIdea, loadIdeas,
    loadNotes, loadSources, loadTopics, loadBrief, setPage, setModal,
    notesTab, setNotesTab, toggleSelectNote,
    topicView, setTopicView, activeTopic, setActiveTopic,
    studio, setStudio, platforms, genDraft: (...a) => genDraftRef.current(...a), exportMd,
    drafts, saveDraft, openDraft, humanizeDraft, undoRewrite, deleteCurrentDraft, deleteDrafts, suggestTitles, removeRef,
    highlightNoteId, setHighlightNoteId, gotoNote, gotoTopic, returnPage, goBack, setReturnPage,
  }

  return (
    <div className="wb-app">
      <header className="wb-header">
        <div className="wb-brand">
          <div className="wb-brand-dot" />
          <div className="wb-brand-name">知识工作台</div>
        </div>
        <div className="wb-avatar">Z</div>
      </header>

      <div className="wb-body">
        <nav className={`wb-nav${leftCollapsed ? ' collapsed' : ''}`} style={leftCollapsed ? undefined : { width: leftW, transition: 'none' }}>
          <button className="wb-nav-toggle" onClick={() => setLeftCollapsed(v => !v)} title={leftCollapsed ? '展开导航' : '折叠导航'}>
            <IconChevronLeft />
          </button>
          <div className="wb-nav-group">{NAV_TOP.map(navItem)}</div>
          <div className="wb-nav-group wb-nav-bottom">{NAV_BOTTOM.map(navItem)}</div>
        </nav>
        {!leftCollapsed && <div className="wb-resizer" onMouseDown={startDrag('left')} title="拖拽调整宽度" />}

        <main className="wb-main">
          <div className={`wb-main-inner${page === 'studio' ? ' studio-wide' : ((page === 'reports' || (page === 'topics' && topicView === 'page')) ? ' narrow' : '')}`} key={page + topicView}>
            {page === 'feed' && <FeedView {...pageProps} />}
            {page === 'notes' && <NotesView {...pageProps} />}
            {page === 'inspirations' && <InspirationsView {...pageProps} />}
            {page === 'sources' && <SourcesView {...pageProps} />}
            {page === 'topics' && <TopicsView {...pageProps} />}
            {page === 'studio' && <StudioView {...pageProps} />}
            {page === 'reports' && <ReportsView {...pageProps} />}
            {page === 'settings' && <SettingsView />}
          </div>
        </main>

        {!rightCollapsed && <div className="wb-resizer" onMouseDown={startDrag('right')} title="拖拽调整宽度" />}
        <RightPanel
          width={rightWide ? '55vw' : rightW} wide={rightWide} onToggleWide={() => setRightWide(v => !v)}
          page={page} collapsed={rightCollapsed} onToggle={() => setRightCollapsed(v => !v)}
          selectedItems={selectedItems} removeSel={removeSel}
          analysisMode={analysisMode} backList={() => { setAnalysisMode('list'); setLibraryHits([]); setChatKind(null) }}
          chat={chat} degraded={degraded} startAnalysis={startAnalysis} sendChat={(t) => runChat(t)} saveMsg={saveMsg} saveMsgAsIdea={saveMsgAsIdea}
          askLibrary={askLibrary} askKnowledge={askKnowledge} libraryHits={libraryHits} chatKind={chatKind}
          topicView={topicView} activeTopic={activeTopic}
          studio={studio} notes={notes} rankedNotes={rankedNotes} insertMaterial={insertMaterial} removeRef={removeRef} gotoNote={gotoNote} rewriteDraft={rewriteDraft}
          showToast={showToast}
        />
      </div>

      {modal === 'idea' && ideaDetail && (
        <IdeaModal idea={ideaDetail} onClose={() => setModal(null)}
          onUpgrade={() => upgradeIdea(ideaDetail)}
          onCreate={(p) => createFromIdea(ideaDetail, p)}
          onDismiss={() => dismissIdea(ideaDetail)} />
      )}
      {modal === 'pool' && <PoolModal onClose={() => setModal(null)} showToast={showToast} />}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} showToast={showToast} onDone={loadSources} />}

      {toast && (
        <div className="wb-toast">
          {toast}
          {toastAction && (
            <button className="wb-toast-action" onClick={() => { const a = toastAction; setToast(''); setToastAction(null); a.onClick() }}>
              {toastAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// /api/studio/platforms 不可达时的兜底列表（与 platforms/ 目录内置三平台一致）
const FALLBACK_PLATFORMS = [
  { key: 'thread', label: 'thread', icon: '𝕏' },
  { key: 'long', label: '公众号长文', icon: '📄' },
  { key: 'script', label: '口播脚本', icon: '🎬' },
]

const DRAFT_TEMPLATES = {
  thread: '1/ （钩子：制造好奇缺口，60 字内）\n\n2/ （第一个独立观点）\n\n3/ （第二个独立观点 + 数据/对比）\n\n4/ （分歧点：最值得聊的争议）\n\n5/ （收尾：一句总结 + 互动提问）',
  long: '# （标题）\n\n## 导语\n（为什么现在写这个）\n\n## 一、背景\n\n## 二、共识与分歧\n\n## 三、我的判断\n[你的观点]\n\n## 结语\n[收束]',
  script: '【钩子·前3秒】\n（反直觉的一句话）\n\n【主体·60s，口语化】\n（三个要点，短句）\n\n【结尾·引导关注】\n关注我，一起把 AI 用明白。',
}

function safeParse(s) { try { return JSON.parse(s || '[]') } catch { return [] } }
function patchLast(arr, patch) {
  if (!arr.length) return arr
  const next = [...arr]
  next[next.length - 1] = { ...next[next.length - 1], ...patch }
  return next
}
