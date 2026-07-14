import { useState, useEffect, useCallback, useRef } from 'react'
import '../styles/workbench.css'
import { api, streamEphemeralChat, sourceCapability } from '../components/wb/util'
import {
  IconFeed, IconNotes, IconTopics, IconStudio, IconSources, IconSettings,
  IconChevronLeft,
} from '../components/wb/Icons'
import FeedView from '../components/wb/FeedView'
import NotesView from '../components/wb/NotesView'
import SourcesView from '../components/wb/SourcesView'
import TopicsView from '../components/wb/TopicsView'
import StudioView from '../components/wb/StudioView'
import ReportsView from '../components/wb/ReportsView'
import SettingsView from '../components/wb/SettingsView'
import RightPanel from '../components/wb/RightPanel'
import { IdeaModal, PoolModal, ImportModal } from '../components/wb/Modals'

// 知识工作台主壳（视觉规格：prototype/design_handoff_knowledge_workbench）。
// 三栏：左导航（可折叠 62px）/ 中栏页面 / 右栏快速分析·创作助手（可折叠 40px）。
// 六阶段是心智模型不是导航：资讯(①④)/素材(③)/主题(④M3)/创作(⑤⑥M4)/信源(①)/设置。

const NAV_TOP = [
  { key: 'feed', label: '资讯', Icon: IconFeed },
  { key: 'notes', label: '素材', Icon: IconNotes },
  { key: 'topics', label: '主题', Icon: IconTopics },
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
  const toastTimer = useRef(null)

  // 数据
  const [contents, setContents] = useState([])
  const [report, setReport] = useState(null)
  const [stories, setStories] = useState([])
  const [ghTrending, setGhTrending] = useState({ repos: [], trend: null })
  const [notes, setNotes] = useState([])
  const [sources, setSources] = useState([])
  const topics = [] // M3：主题活页后端未上线，列表空态

  // 右栏（快速分析）
  const [selectedItems, setSelectedItems] = useState([]) // {id,title,adHoc?,capability}
  const [analysisMode, setAnalysisMode] = useState('list')
  const [chat, setChat] = useState([]) // {role:'user'|'ai', text, pending?, saved?, noteId?}
  const [degraded, setDegraded] = useState([]) // 本轮对话中降级为摘要的材料清单（SSE meta）
  const chatHistory = useRef([]) // 发给后端的纯净历史

  // 弹窗
  const [modal, setModal] = useState(null) // 'pool'|'import'|'idea'
  const [ideaDetail, setIdeaDetail] = useState(null)

  // 主题 / 创作台
  const [topicView, setTopicView] = useState('list')
  const [activeTopic, setActiveTopic] = useState(null)
  const [studio, setStudio] = useState({
    platform: 'thread', source: null, refs: [], draft: '', busy: false,
  })

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2600)
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

  useEffect(() => { loadContents(); loadBrief(); loadNotes(); loadSources() }, [loadContents, loadBrief, loadNotes, loadSources])

  // ---- 快速分析 ----
  const toggleSelect = (c) => {
    setSelectedItems(prev => prev.find(x => x.id === c.id)
      ? prev.filter(x => x.id !== c.id)
      : [...prev, { id: c.id, title: c.zh_title || c.en_title || '(无标题)', capability: sourceCapability(c) }])
  }
  const removeSel = (id) => setSelectedItems(prev => prev.filter(x => x.id !== id))

  const runChat = async (userText, { fresh = false } = {}) => {
    const items = selectedItems
    if (!items.length) return
    const history = fresh ? [] : chatHistory.current
    const userMsg = { role: 'user', content: userText }
    chatHistory.current = [...history, userMsg]
    setAnalysisMode('chat')
    setChat(prev => [...(fresh ? [] : prev), { role: 'user', text: userText }, { role: 'ai', text: '', pending: true }])
    try {
      const contentIds = items.filter(x => !x.adHoc).map(x => x.id)
      const adHocContents = items.filter(x => x.adHoc).map(x => x.adHoc)
      const full = await streamEphemeralChat(
        { contentIds, adHocContents, messages: chatHistory.current },
        (text) => setChat(prev => patchLast(prev, { text, pending: true })),
        (deg) => setDegraded(deg)
      )
      chatHistory.current.push({ role: 'assistant', content: full })
      setChat(prev => patchLast(prev, { text: full, pending: false }))
    } catch (err) {
      chatHistory.current.pop()
      setChat(prev => patchLast(prev, { text: `请求失败：${err.message}`, pending: false, error: true }))
    }
  }

  const startAnalysis = () => runChat(
    '请对以上内容做结构化解读：\n① 核心论点（分条）\n② 论据/案例\n③ 金句（可直接引用）\n④ 观点之间的异同或冲突',
    { fresh: true }
  )

  const saveMsg = async (index) => {
    const msg = chat[index]
    if (!msg || msg.role !== 'ai' || msg.pending || msg.error || msg.noteId) return
    const real = selectedItems.filter(x => !x.adHoc)
    const single = real.length === 1 ? contents.find(c => c.id === real[0].id) : null
    try {
      const json = await api('/api/notes', {
        method: 'POST',
        body: {
          excerpt: msg.text, noteType: 'chat',
          contentId: single?.id || null,
          sourceTitle: selectedItems.map(x => x.title).join(' / ').slice(0, 120) || null,
          sourceUrl: single?.url || null,
        },
      })
      setChat(prev => prev.map((m, i) => i === index ? { ...m, noteId: json.data.id } : m))
      loadNotes()
      showToast('已存为素材卡片（对话本身不落库）')
    } catch (err) { showToast(`保存失败：${err.message}`) }
  }

  // ---- 万能收口：粘贴链接 → 摄入 → 直接进入解读对话 ----
  const acquire = async (input) => {
    showToast('正在识别并抓取内容…')
    try {
      const json = await api('/api/content/ingest', { method: 'POST', body: { input } })
      if (!json.success) throw new Error(json.data?.fetchError || json.error || '摄入失败')
      const title = json.data.zh_title || json.data.en_title || input.slice(0, 28)
      setSelectedItems(prev => [...prev.filter(x => x.id !== 'paste'), { id: 'paste', title: `[粘贴] ${title}`, adHoc: json.data }])
      setRightCollapsed(false)
      setTimeout(() => {
        setAnalysisMode('chat')
        // 单独走一次全新解读（selectedItems 状态更新后由用户消息触发）
      }, 0)
      return true
    } catch (err) {
      showToast(`摄入失败：${err.message}`)
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

  // ---- 信源 ----
  const followSource = async (contentId) => {
    try {
      const json = await api(`/api/contents/${contentId}/follow-source`, { method: 'POST' })
      setContents(prev => prev.map(c =>
        (c.id === contentId || (c.source_id && c.source_id === json.data.id))
          ? { ...c, source_id: json.data.id, source_registered: 1 } : c))
      loadSources()
      showToast(`已把 ${json.data.display_name} 加为信息源（进 Feed · 加权）`)
    } catch (err) { showToast(`加为信息源失败：${err.message}`) }
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
    try { await api(`/api/ideas/${idea.id}`, { method: 'PATCH', body: { status: 'adopted' } }) } catch { /* 忽略 */ }
    setModal(null); setPage('topics'); setTopicView('list')
    showToast('已采纳选题（主题活页 M3 上线后自动建页）')
  }
  const dismissIdea = async (idea) => {
    try { await api(`/api/ideas/${idea.id}`, { method: 'PATCH', body: { status: 'dismissed' } }) } catch { /* 忽略 */ }
    setModal(null); loadBrief()
  }
  const createFromIdea = async (idea, platform = 'thread') => {
    setModal(null); setPage('studio')
    const supportId = (idea.supporting_content_ids || [])[0]
    setStudio(s => ({ ...s, platform, source: `选题：${idea.title}`, sourceContentId: supportId || null, draft: '', refs: [] }))
    api(`/api/ideas/${idea.id}`, { method: 'PATCH', body: { status: 'created' } }).catch(() => {})
    setTimeout(() => genDraftRef.current(platform, supportId), 0)
  }

  // ---- 创作台 ----
  const genDraftRef = useRef(() => {})
  genDraftRef.current = async (platform = studio.platform, sourceContentId = studio.sourceContentId) => {
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
    setStudio(s => ({ ...s, draft: DRAFT_TEMPLATES[platform] }))
  }

  const insertMaterial = (note) => {
    setStudio(s => ({
      ...s,
      draft: (s.draft ? s.draft + '\n\n' : '') + `> ${note.excerpt}\n  —— 引自《${note.content_zh_title || note.source_title || '素材'}》（可溯源）`,
      refs: [...s.refs, { note: note.content_zh_title || note.source_title || '素材', para: '新段落' }],
    }))
  }

  const rewriteDraft = async (instruction) => {
    const json = await api('/api/studio/rewrite', { method: 'POST', body: { draft: studio.draft, instruction, platform: studio.platform } })
    setStudio(s => ({ ...s, draft: json.data.draft }))
    return json.data.note || `已按要求改写草稿：${instruction}`
  }

  const exportMd = () => {
    const blob = new Blob([studio.draft], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `draft-${studio.platform}-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(a.href)
    showToast('已导出 Markdown')
  }

  // ---- 渲染 ----
  const navItem = (n) => (
    <button key={n.key} className={`wb-nav-item${page === n.key ? ' active' : ''}`} onClick={() => { setPage(n.key); setModal(null) }}>
      <span className="wb-nav-icon"><n.Icon /></span>
      <span className="wb-nav-label">{n.label}</span>
    </button>
  )

  const pageProps = {
    showToast, contents, report, stories, ghTrending, notes, sources, topics,
    selectedItems, toggleSelect, followSource, acquire,
    generateReport, generating, viewIdea, upgradeIdea, createFromIdea,
    loadNotes, loadSources, setPage, setModal,
    topicView, setTopicView, activeTopic, setActiveTopic,
    studio, setStudio, genDraft: (...a) => genDraftRef.current(...a), exportMd,
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
        <nav className={`wb-nav${leftCollapsed ? ' collapsed' : ''}`}>
          <button className="wb-nav-toggle" onClick={() => setLeftCollapsed(v => !v)} title={leftCollapsed ? '展开导航' : '折叠导航'}>
            <IconChevronLeft />
          </button>
          <div className="wb-nav-group">{NAV_TOP.map(navItem)}</div>
          <div className="wb-nav-group wb-nav-bottom">{NAV_BOTTOM.map(navItem)}</div>
        </nav>

        <main className="wb-main">
          <div className="wb-main-inner" key={page + topicView}>
            {page === 'feed' && <FeedView {...pageProps} />}
            {page === 'notes' && <NotesView {...pageProps} />}
            {page === 'sources' && <SourcesView {...pageProps} />}
            {page === 'topics' && <TopicsView {...pageProps} />}
            {page === 'studio' && <StudioView {...pageProps} />}
            {page === 'reports' && <ReportsView {...pageProps} />}
            {page === 'settings' && <SettingsView />}
          </div>
        </main>

        <RightPanel
          page={page} collapsed={rightCollapsed} onToggle={() => setRightCollapsed(v => !v)}
          selectedItems={selectedItems} removeSel={removeSel}
          analysisMode={analysisMode} backList={() => setAnalysisMode('list')}
          chat={chat} degraded={degraded} startAnalysis={startAnalysis} sendChat={(t) => runChat(t)} saveMsg={saveMsg}
          topicView={topicView} activeTopic={activeTopic}
          studio={studio} notes={notes} insertMaterial={insertMaterial} rewriteDraft={rewriteDraft}
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

      {toast && <div className="wb-toast">{toast}</div>}
    </div>
  )
}

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
