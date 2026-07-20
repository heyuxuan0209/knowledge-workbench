import { useState, useRef, useEffect } from 'react'
import { IconChat, IconChevronRight, IconChevronLeft, IconSend, IconStudio } from './Icons'

// 右栏：快速分析（非创作页）/ 创作助手（创作页）。可折叠为 40px 细条。
// 快速分析 list 态 = 已选中列表 + 开始分析；chat 态 = SSE 流式结构化解读 + 保存到笔记。
// 创作助手 = 已引用 / 可插入素材 / 指令改写（AI 直接改左侧草稿）。

export default function RightPanel(props) {
  const { page, collapsed, onToggle, width } = props
  const isStudio = page === 'studio'

  if (collapsed) {
    // 细条自说明（方案 A）：闲时不占地，但竖排写清用途——选中卡片即自动展开成面板
    const railHint = isStudio ? '创作助手'
      : page === 'topics' ? '跨主题 AI 助手'
      : page === 'notes' ? '选中卡片 → 解读 · 问素材库'
      : '选中卡片 → 即时解读'
    return (
      <aside className="wb-panel collapsed">
        <button className="wb-panel-rail" onClick={onToggle} title="展开面板">
          <IconChevronLeft />
          <span className="wb-panel-rail-hint">{railHint}</span>
        </button>
      </aside>
    )
  }

  // width 来自 WorkbenchPage（拖拽/半屏切换，2026-07-16 反馈 #3）；transition 关掉避免拖拽回弹
  return (
    <aside className={`wb-panel${isStudio ? ' studio' : ''}`} style={width ? { width, transition: 'none' } : undefined}>
      {isStudio ? <StudioAssistant {...props} /> : <QuickAnalysis {...props} />}
    </aside>
  )
}

function PanelHeader({ icon, title, sub, onToggle, onToggleWide, wide }) {
  return (
    <div className="wb-panel-header">
      <div style={{ flex: 1 }}>
        <div className="wb-panel-title">{icon}{title}</div>
        <div className="wb-panel-sub">{sub}</div>
      </div>
      {onToggleWide && (
        <button className="wb-panel-toggle" onClick={onToggleWide} title={wide ? '恢复常规宽度' : '展开至半屏（长内容更好读）'}>
          {wide ? '⇥' : '⇤'}
        </button>
      )}
      <button className="wb-panel-toggle" onClick={onToggle}><IconChevronRight /></button>
    </div>
  )
}

/* ---------- 快速分析 ---------- */
const CAP_STYLE = {
  full: { color: '#3f7350', background: 'rgba(63,115,80,.12)' },
  summary: { color: '#8a6a1a', background: 'rgba(169,121,31,.12)' },
  video: { color: '#3d5a80', background: 'rgba(61,90,128,.12)' },
}

function QuickAnalysis({
  onToggle, onToggleWide, wide, selectedItems, removeSel, analysisMode, backList,
  chat, degraded, startAnalysis, sendChat, saveMsg, saveMsgAsIdea, page, topicView, activeTopic,
  askLibrary, askKnowledge, libraryHits = [], chatKind,
}) {
  const [input, setInput] = useState('')
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat])

  const onTopicPage = page === 'topics' && topicView === 'page' && activeTopic
  const onTopicsList = page === 'topics' && !onTopicPage // 主题库列表层 → 问知识体系
  const sub = onTopicPage ? `上下文：本主题《${activeTopic.name}》`
    : onTopicsList ? '问你的知识体系 · 跨主题综合' : '选中内容即时分析 · 对话不落库'
  const chatMode = analysisMode === 'chat'

  const send = () => {
    const t = input.trim()
    if (!t) return
    setInput('')
    sendChat(t)
  }

  return (
    <>
      <PanelHeader icon={<IconChat />} title="快速分析" sub={sub} onToggle={onToggle} onToggleWide={onToggleWide} wide={wide} />

      {!chatMode && (
        <div className="wb-panel-body">
          {onTopicPage ? (
            <>
              <div className="wb-panel-label">快捷问题</div>
              {['核心争议', '演进脉络', '适合引用的观点'].map(q => (
                <button key={q} className="wb-quick-chip" onClick={() => sendChat(q)}>{q}</button>
              ))}
            </>
          ) : selectedItems.length > 0 ? (
            <>
              <div className="wb-panel-label">已选中（{selectedItems.length}）</div>
              {selectedItems.map(item => {
                const cap = item.capability
                return (
                  <div key={item.id} className="wb-sel-item">
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                    {cap && (
                      <span className="wb-pill" style={{ ...CAP_STYLE[cap.level], flexShrink: 0 }}>{cap.label}</span>
                    )}
                    <button className="wb-sel-remove" onClick={() => removeSel(item.id)}>×</button>
                  </div>
                )
              })}
              {selectedItems.some(x => x.capability?.level !== 'full') && (
                <div className="wb-panel-hint" style={{ marginTop: 4 }}>
                  「仅摘要」来源（公众号等）无法抓取原文，解读基于摘要；「依赖字幕」的视频抓取到字幕才算原文。
                </div>
              )}
              <button className="wb-btn-primary" style={{ marginTop: 8 }} onClick={startAnalysis}>开始分析 →</button>
              <div className="wb-panel-hint">分析基于原文；抓取失败会显式标注基于摘要。</div>
            </>
          ) : (page === 'notes' && askLibrary) ? (
            // 问整个素材库只在【素材页】出现。分工：中间搜索框=找卡片（出列表）；这里=问问题（出答案+溯源）
            <>
              <AskBox label="问整个素材库（出答案，不是列表）" cta="语义检索并回答 →" onAsk={askLibrary}
                placeholder="用大白话问，如「我攒过哪些关于降低用户操作摩擦的素材？」"
                hint="回车换行，点按钮或 ⌘/Ctrl+回车发送，可多轮追问。框可拖右下角放大；想更宽就拖面板左边框或点右上 ⇤ 半屏。" />
              <div className="wb-panel-empty" style={{ marginTop: 0 }}>或在素材卡片点「选中解读」<br />可多选后一起解读</div>
            </>
          ) : (onTopicsList && askKnowledge) ? (
            // 问知识体系只在【主题库列表层】出现；单个主题的探讨在主题详情页右栏
            <>
              <AskBox label="问我的知识体系（跨主题综合）" cta="综合我的主题作答 →" onAsk={askKnowledge}
                placeholder="跨主题地问，如「我在哪些主题里聊过 agent 可靠性？串一下」「哪两个主题其实在讲同一件事？」"
                hint="基于你全部主题的综述作答，会标注参考了哪几个主题，可多轮追问。想深挖单个主题，点开它的详情页。" />
              <div className="wb-panel-empty" style={{ marginTop: 0 }}>想深挖某一个主题？<br />点开主题详情页，右栏会带上那个主题的综述+素材做弹药</div>
            </>
          ) : (
            <div className="wb-panel-empty">
              在卡片点「选中解读」<br />可多选后一起解读<br /><br />对话用完即走，<br />点「保存到笔记」才沉淀
            </div>
          )}
        </div>
      )}

      {chatMode && (
        <>
          <div className="wb-panel-body">
            <div className="wb-chat-meta">
              <button className="wb-back" style={{ fontSize: 11.5 }} onClick={backList}>← 返回</button>
              {chatKind === 'knowledge'
                ? `问知识体系 · 基于 ${libraryHits.length} 个主题综合`
                : chatKind === 'library' || libraryHits.length > 0
                ? `问素材库 · 检索到 ${libraryHits.length} 条相关素材`
                : onTopicPage ? `探讨主题《${activeTopic.name}》· 综述+素材做弹药` : `基于 ${selectedItems.length || 1} 篇内容 · 结构化解读`}
            </div>
            {libraryHits.length > 0 && (
              <div className="wb-panel-hint" style={{ marginBottom: 8 }}>
                {chatKind === 'knowledge' ? '参考主题：' : '引用素材：'}
                {libraryHits.map(h => `《${(h.title || h.source_title || '素材').slice(0, 14)}》`).join('、')}
              </div>
            )}
            {degraded?.length > 0 && (
              <div className="wb-warnbar" style={{ marginBottom: 8, fontSize: 11.5 }}>
                其中 {degraded.length} 篇未获取到原文，以下基于摘要：{degraded.map(d => `《${d.title.slice(0, 16)}》`).join('')}
              </div>
            )}
            <div className="wb-chat">
              {chat.map((m, i) => (
                <MsgBubble key={i} msg={m} onSave={() => saveMsg(i)} onSaveIdea={saveMsgAsIdea ? () => saveMsgAsIdea(i) : null} />
              ))}
              <div ref={endRef} />
            </div>
          </div>
          <div className="wb-chat-inputrow">
            <textarea
              className="wb-chat-input" rows={2} value={input}
              onChange={(e) => setInput(e.target.value)}
              // 输入法组合中（中文/候选未定）不提交，避免打一半被回车提交
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
              placeholder="继续追问…"
            />
            <button className="wb-send" disabled={!input.trim()} onClick={send}><IconSend /></button>
          </div>
        </>
      )}
    </>
  )
}

// 问答输入框（问素材库 / 问知识体系共用）：大框、可拖拽、回车换行、⌘/Ctrl+回车 或按钮发送、输入法安全
function AskBox({ label, cta, placeholder, hint, onAsk }) {
  const [q, setQ] = useState('')
  const submit = () => { const t = q.trim(); if (t) { onAsk(t); setQ('') } }
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="wb-panel-label">{label}</div>
      <textarea className="wb-chat-input" style={{ minHeight: 120, height: 120, resize: 'both', width: '100%', lineHeight: 1.6 }} value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }}
        placeholder={placeholder} />
      <button className="wb-btn-primary" style={{ marginTop: 6, width: '100%' }} disabled={!q.trim()} onClick={submit}>{cta}</button>
      <div className="wb-panel-hint">{hint}</div>
    </div>
  )
}

function MsgBubble({ msg, onSave, onSaveIdea = null, hideSave = false }) {
  if (msg.role === 'user') return <div className="wb-msg user">{msg.text}</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'flex-start', maxWidth: '94%' }}>
      <div className="wb-msg ai" style={msg.error ? { color: 'var(--red)' } : undefined}>
        {msg.text || (msg.pending && <span className="wb-pending"><i /><i /><i /></span>)}
        {msg.text && msg.pending && <span className="wb-pending" style={{ marginLeft: 4 }}><i /><i /><i /></span>}
      </div>
      {!hideSave && !msg.pending && !msg.error && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className={`wb-msg-save${msg.noteId ? ' saved' : ''}`} disabled={Boolean(msg.noteId)} onClick={onSave}>
            {msg.noteId ? '✓ 已存入素材库' : '保存到笔记'}
          </button>
          {onSaveIdea && (
            <button className={`wb-msg-save${msg.ideaId ? ' saved' : ''}`} disabled={Boolean(msg.ideaId)} onClick={onSaveIdea}
              title="这篇值得写 → 提为一条灵感（要写什么）">
              {msg.ideaId ? '✓ 已提为灵感' : '💡 提为灵感'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- 创作助手 ---------- */
function StudioAssistant({ onToggle, onToggleWide, wide, studio, notes, rankedNotes, insertMaterial, removeRef, gotoNote, rewriteDraft, showToast }) {
  const [input, setInput] = useState('')
  const [chat, setChat] = useState([]) // {role, text, pending?}
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat])

  const send = async (textArg) => {
    const t = (textArg ?? input).trim()
    if (!t) return
    if (!studio.draft.trim()) { showToast('先生成或写一段草稿，再让 AI 改'); return }
    setInput('')
    setChat(prev => [...prev, { role: 'user', text: t }, { role: 'ai', text: '', pending: true }])
    try {
      const note = await rewriteDraft(t)
      setChat(prev => patchLast(prev, { text: note, pending: false }))
    } catch (err) {
      setChat(prev => patchLast(prev, { text: `改写失败：${err.message}`, pending: false, error: true }))
    }
  }

  return (
    <>
      <PanelHeader icon={<IconStudio />} title="创作助手" sub="素材引用 + 指令改写，直接改左侧草稿" onToggle={onToggle} onToggleWide={onToggleWide} wide={wide} />
      <div className="wb-panel-body">
        <div className="wb-panel-label">已引用（{studio.refs.length}）</div>
        {studio.refs.length === 0 && <div style={{ fontSize: 12, color: 'var(--faint)' }}>尚未引用素材</div>}
        {studio.refs.map((r, i) => {
          const src = notes.find(n => n.id === studio.paragraphRefs[i]?.noteId)
          const label = src?.title || r.note
          const url = src?.content_url || src?.source_url
          return (
            <div key={i} className="wb-ref-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                📎 <b style={src ? { cursor: 'pointer' } : undefined} title={src ? '在素材库中查看' : undefined}
                  onClick={() => src && gotoNote(src.id)}>{label}</b> → {r.para}
                {url && <a href={url} target="_blank" rel="noreferrer" title="新标签打开原文" style={{ marginLeft: 4, color: 'var(--accent)', textDecoration: 'none' }}>↗</a>}
              </span>
              <button className="wb-note-del" style={{ marginLeft: 'auto', flex: 'none' }} title="移除引用（同时清理草稿中的标记/引块）"
                onClick={() => removeRef(i)}>✕</button>
            </div>
          )
        })}

        {(() => {
          // 相关度排序（后端 TF 余弦，rankedNotes）；未就绪时回落到时间序 + 本主题优先
          const tid = studio.sourceTopicId
          const isMine = n => n.isMine ?? (tid && (n.topic_ids || '').split(',').includes(tid))
          const ranked = rankedNotes || (tid ? [...notes].sort((a, b) => isMine(b) - isMine(a)) : notes)
          const hasDraft = studio.draft.trim().length > 0
          const relLabel = rankedNotes && hasDraft
            ? ' · 按与当前草稿的相关度排序'
            : (tid ? ' · 本主题的排在前' : '')
          return <>
            <div className="wb-panel-label">可插入素材（{ranked.length}）{relLabel}</div>
            {ranked.length === 0 && <div style={{ fontSize: 12, color: 'var(--faint)' }}>素材库为空 · 在快速分析里「保存到笔记」</div>}
            {ranked.slice(0, 12).map(n => {
              const url = n.content_url || n.source_url
              return (
                <div key={n.id} className="wb-insert-item" style={{ alignItems: 'flex-start' }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                      title="在素材库中查看" onClick={() => gotoNote(n.id)}>
                      {isMine(n) && <span style={{ color: 'var(--accent)' }}>[本主题] </span>}
                      {(n.title || n.content_zh_title || n.source_title || '未命名素材').slice(0, 22)}
                      {url && <a href={url} target="_blank" rel="noreferrer" title="新标签打开原文"
                        style={{ marginLeft: 4, color: 'var(--accent)', textDecoration: 'none' }}>↗</a>}
                      <span style={{ color: 'var(--faint)', fontWeight: 400 }}> · {(n.created_at || '').slice(5, 10)}</span>
                    </span>
                    <span style={{ display: 'block', color: 'var(--sub2)', fontSize: 11.5, marginTop: 2 }}>
                      {n.excerpt.replace(/[#>*\n-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 42)}…
                    </span>
                    {n.topic_names && !isMine(n) && (
                      <span style={{ display: 'block', color: 'var(--faint)', fontSize: 11, marginTop: 2 }}>主题：{n.topic_names.slice(0, 20)}</span>
                    )}
                    {rankedNotes && hasDraft && (
                      n.related
                        ? n.relTerms?.length > 0 && <span style={{ display: 'block', color: '#3f7350', fontSize: 11, marginTop: 2 }}>相关：{n.relTerms.slice(0, 4).join('·')}</span>
                        : <span style={{ display: 'block', color: 'var(--faint)', fontSize: 11, marginTop: 2 }}>与当前草稿关联弱</span>
                    )}
                  </span>
                  <button className="wb-insert-btn" onClick={() => insertMaterial(n)}>插入</button>
                </div>
              )
            })}
          </>
        })()}

        <div className="wb-panel-hint" style={{ borderTop: '1px solid var(--line07)', paddingTop: 10 }}>
          让 AI 按你的意思改：例如「开头更犀利」「压到 5 条」「加一个反方观点」「改成口语」——它会直接改写左侧草稿。
        </div>
        <div className="wb-chat" style={{ flex: 'none', marginTop: 8 }}>
          {chat.map((m, i) => <MsgBubble key={i} msg={m} hideSave onSave={() => {}} />)}
          <div ref={endRef} />
        </div>
      </div>
      <div className="wb-chat-inputrow">
        <textarea
          className="wb-chat-input" rows={1} value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="告诉 AI 怎么改…"
        />
        <button className="wb-send" disabled={!input.trim()} onClick={() => send()}><IconSend /></button>
      </div>
    </>
  )
}

function patchLast(arr, patch) {
  if (!arr.length) return arr
  const next = [...arr]
  next[next.length - 1] = { ...next[next.length - 1], ...patch }
  return next
}
