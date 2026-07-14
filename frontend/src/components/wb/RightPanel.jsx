import { useState, useRef, useEffect } from 'react'
import { IconChat, IconChevronRight, IconChevronLeft, IconSend, IconStudio } from './Icons'

// 右栏：快速分析（非创作页）/ 创作助手（创作页）。可折叠为 40px 细条。
// 快速分析 list 态 = 已选中列表 + 开始分析；chat 态 = SSE 流式结构化解读 + 保存到笔记。
// 创作助手 = 已引用 / 可插入素材 / 指令改写（AI 直接改左侧草稿）。

export default function RightPanel(props) {
  const { page, collapsed, onToggle } = props
  const isStudio = page === 'studio'

  if (collapsed) {
    return (
      <aside className="wb-panel collapsed">
        <button className="wb-panel-toggle" onClick={onToggle} title="展开面板"><IconChevronLeft /></button>
      </aside>
    )
  }

  return (
    <aside className={`wb-panel${isStudio ? ' studio' : ''}`}>
      {isStudio ? <StudioAssistant {...props} /> : <QuickAnalysis {...props} />}
    </aside>
  )
}

function PanelHeader({ icon, title, sub, onToggle }) {
  return (
    <div className="wb-panel-header">
      <div style={{ flex: 1 }}>
        <div className="wb-panel-title">{icon}{title}</div>
        <div className="wb-panel-sub">{sub}</div>
      </div>
      <button className="wb-panel-toggle" onClick={onToggle}><IconChevronRight /></button>
    </div>
  )
}

/* ---------- 快速分析 ---------- */
function QuickAnalysis({
  onToggle, selectedItems, removeSel, analysisMode, backList,
  chat, startAnalysis, sendChat, saveMsg, page, topicView, activeTopic,
}) {
  const [input, setInput] = useState('')
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat])

  const onTopicPage = page === 'topics' && topicView === 'page' && activeTopic
  const sub = onTopicPage ? `上下文：本主题《${activeTopic.name}》` : '选中内容即时分析 · 对话不落库'
  const chatMode = analysisMode === 'chat'

  const send = () => {
    const t = input.trim()
    if (!t) return
    setInput('')
    sendChat(t)
  }

  return (
    <>
      <PanelHeader icon={<IconChat />} title="快速分析" sub={sub} onToggle={onToggle} />

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
              {selectedItems.map(item => (
                <div key={item.id} className="wb-sel-item">
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                  <button className="wb-sel-remove" onClick={() => removeSel(item.id)}>×</button>
                </div>
              ))}
              <button className="wb-btn-primary" style={{ marginTop: 8 }} onClick={startAnalysis}>开始分析 →</button>
              <div className="wb-panel-hint">分析基于原文；抓取失败会显式标注基于摘要。</div>
            </>
          ) : (
            <div className="wb-panel-empty">
              在 资讯 卡片点「选中分析」<br />可多选后一起解读<br /><br />对话用完即走，<br />点「保存到笔记」才沉淀
            </div>
          )}
        </div>
      )}

      {chatMode && (
        <>
          <div className="wb-panel-body">
            <div className="wb-chat-meta">
              <button className="wb-back" style={{ fontSize: 11.5 }} onClick={backList}>← 返回</button>
              基于 {selectedItems.length || 1} 篇内容 · 结构化解读
            </div>
            <div className="wb-chat">
              {chat.map((m, i) => (
                <MsgBubble key={i} msg={m} onSave={() => saveMsg(i)} />
              ))}
              <div ref={endRef} />
            </div>
          </div>
          <div className="wb-chat-inputrow">
            <textarea
              className="wb-chat-input" rows={2} value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="继续追问…"
            />
            <button className="wb-send" disabled={!input.trim()} onClick={send}><IconSend /></button>
          </div>
        </>
      )}
    </>
  )
}

function MsgBubble({ msg, onSave, hideSave = false }) {
  if (msg.role === 'user') return <div className="wb-msg user">{msg.text}</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'flex-start', maxWidth: '94%' }}>
      <div className="wb-msg ai" style={msg.error ? { color: 'var(--red)' } : undefined}>
        {msg.text || (msg.pending && <span className="wb-pending"><i /><i /><i /></span>)}
        {msg.text && msg.pending && <span className="wb-pending" style={{ marginLeft: 4 }}><i /><i /><i /></span>}
      </div>
      {!hideSave && !msg.pending && !msg.error && (
        <button className={`wb-msg-save${msg.noteId ? ' saved' : ''}`} disabled={Boolean(msg.noteId)} onClick={onSave}>
          {msg.noteId ? '✓ 已存入素材库' : '保存到笔记'}
        </button>
      )}
    </div>
  )
}

/* ---------- 创作助手 ---------- */
function StudioAssistant({ onToggle, studio, notes, insertMaterial, rewriteDraft, showToast }) {
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
      <PanelHeader icon={<IconStudio />} title="创作助手" sub="素材引用 + 指令改写，直接改左侧草稿" onToggle={onToggle} />
      <div className="wb-panel-body">
        <div className="wb-panel-label">已引用（{studio.refs.length}）</div>
        {studio.refs.length === 0 && <div style={{ fontSize: 12, color: 'var(--faint)' }}>尚未引用素材</div>}
        {studio.refs.map((r, i) => (
          <div key={i} className="wb-ref-item">📎 <b>{r.note}</b> → {r.para}</div>
        ))}

        <div className="wb-panel-label">可插入素材（{notes.length}）</div>
        {notes.length === 0 && <div style={{ fontSize: 12, color: 'var(--faint)' }}>素材库为空 · 在快速分析里「保存到笔记」</div>}
        {notes.slice(0, 8).map(n => (
          <div key={n.id} className="wb-insert-item">
            <span style={{ minWidth: 0 }}>{n.excerpt.length > 36 ? n.excerpt.slice(0, 36) + '…' : n.excerpt}</span>
            <button className="wb-insert-btn" onClick={() => insertMaterial(n)}>插入</button>
          </div>
        ))}

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
