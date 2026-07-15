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
  const [topics, setTopics] = useState([]) // M3 主题活页（/api/topics）

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
    // M4：草稿落库 + 活页起稿 + 段落级溯源持久化
    draftId: null, title: null, sourceTopicId: null, paragraphRefs: [],
  })
  const [drafts, setDrafts] = useState([]) // 草稿箱
  const loadDrafts = useCallback(async () => {
    try { setDrafts((await api('/api/drafts')).data || []) } catch (err) { console.error(err) }
  }, [])

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
  const loadTopics = useCallback(async () => {
    try { setTopics((await api('/api/topics')).data || []) } catch (err) { console.error(err) }
  }, [])

  useEffect(() => { loadContents(); loadBrief(); loadNotes(); loadSources(); loadTopics(); loadDrafts() }, [loadContents, loadBrief, loadNotes, loadSources, loadTopics, loadDrafts])

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
      // 保存即同化（设计本意）：命中主题时后台自动并入，用户不需要额外操作
      const matched = json.matchedTopics || []
      if (matched.length) {
        showToast(`已存为素材，AI 正在把它并入主题「${matched.map(m => m.name).join('」「')}」（约半分钟，主题页可见修订）`)
        setTimeout(loadTopics, 35000) // 同化完成后刷新主题统计
      } else {
        showToast('已存为素材卡片。想让它进入某个主题综述？在主题页建立相关主题即可自动归入')
      }
    } catch (err) { showToast(`保存失败：${err.message}`) }
  }

  // ---- 万能收口：粘贴链接 → 摄入 → 直接进入解读对话 ----
  const acquire = async (input) => {
    showToast('正在识别并抓取内容…')
    try {
      const json = await api('/api/content/ingest', { method: 'POST', body: { input } })
      if (!json.success) throw new Error(json.data?.fetchError || json.error || '摄入失败')
      const d = json.data
      const title = d.zhTitle || d.zh_title || d.enTitle || d.en_title || d.title || input.slice(0, 28)
      // 只保留解读需要的字段：完整摄入结果里的 transcript（几千段带时间戳）会把
      // 后续每轮对话请求撑到数 MB（曾触发 PayloadTooLarge）。
      // metadata（原题/作者/平台/日期）必须随行——即时分析管道要求带元数据块
      const adHoc = {
        zhTitle: title,
        enTitle: d.enTitle || d.en_title || d.title || null,
        zhBody: d.zhBody || d.zh_body || null,
        body: (d.zhBody || d.zh_body) ? null : (d.body || null),
        url: input.startsWith('http') ? input : null,
        metadata: d.metadata || null,
      }
      setSelectedItems(prev => [...prev.filter(x => x.id !== 'paste'), { id: 'paste', title: `[粘贴] ${title}`, adHoc }])
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
    setModal(null)
    try {
      const json = await api('/api/topics/from-idea', { method: 'POST', body: { ideaId: idea.id } })
      await loadTopics()
      setActiveTopic(json.data); setTopicView('page'); setPage('topics')
      showToast(`已升级为主题活页「${json.data.name}」，AI 将随素材并入持续维护综述`)
    } catch (err) {
      setPage('topics'); setTopicView('list')
      showToast(`建页失败：${err.message}`)
    }
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
    // 活页起稿（M4）：活页综述做骨架 + 已并入素材可溯源引用，生成即落库
    if (studio.sourceTopicId) {
      setStudio(s => ({ ...s, busy: true, draft: s.draft || '正在基于主题活页起稿（约 30 秒）…' }))
      try {
        const json = await api(`/api/topics/${studio.sourceTopicId}/draft`, { method: 'POST', body: { platform } })
        const d = json.data
        setStudio(s => ({
          ...s, busy: false, draft: d.body, title: d.title, draftId: d.id,
          paragraphRefs: d.paragraph_refs,
          refs: d.paragraph_refs.map(r => ({ note: r.sourceTitle || '素材', para: r.marker })),
        }))
        loadDrafts()
        showToast(`已基于活页起稿并存入草稿箱（引用 ${d.paragraph_refs.length} 条素材，¥${d.cost_yuan?.toFixed(3)}）`)
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
    setStudio(s => ({ ...s, draft: DRAFT_TEMPLATES[platform] }))
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

  // 去 AI 味（三遍审校一道工序），改写后替换草稿区，由用户决定是否保存
  const humanizeDraft = async () => {
    if (!studio.draft.trim()) { showToast('草稿为空'); return }
    setStudio(s => ({ ...s, busy: true }))
    showToast('正在去 AI 味审校（约 30 秒）…')
    try {
      const json = await api('/api/studio/humanize', { method: 'POST', body: { draft: studio.draft, platform: studio.platform } })
      setStudio(s => ({ ...s, busy: false, draft: json.data.text }))
      showToast(`已完成去 AI 味改写（¥${json.data.cost?.toFixed(3)}），满意请点保存`)
    } catch (err) {
      setStudio(s => ({ ...s, busy: false }))
      showToast(`审校失败：${err.message}`)
    }
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
    loadNotes, loadSources, loadTopics, setPage, setModal,
    topicView, setTopicView, activeTopic, setActiveTopic,
    studio, setStudio, genDraft: (...a) => genDraftRef.current(...a), exportMd,
    drafts, saveDraft, openDraft, humanizeDraft,
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
