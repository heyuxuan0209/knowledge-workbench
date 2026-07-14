import { useState, useRef, useEffect } from 'react'

// 右侧 AI 面板：复用原型 feed-v1.js 的 quickAnalysisView / chatView 两视图 + SSE 流式对话。
// 无状态设计（架构文档 §2 Mode 1）：对话历史只在组件内存里，切走即弃，与后端「不落库」对应。
//
// 两种入口（对应 FeedPage 传入）：
// - selectedItems: 用户在 Feed 里勾选的已入库内容 → contentIds
// - adHocContent: 用户粘贴链接/文本、已过 /api/content/ingest 摄入的结果 → adHocContents
//
// SSE 解析逻辑与原型逐字节对齐：按 \n\n 切分事件，处理 content / error / done 三类。

export default function AiPanel({ selectedItems, adHocContent, onClearAdHoc }) {
  const [mode, setMode] = useState('quick') // quick | chat
  const [messages, setMessages] = useState([]) // { role, content, streaming?, error?, savedNoteId? }
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const historyRef = useRef([]) // 发给后端的纯净历史（不含 streaming/error 标记）
  const messagesEndRef = useRef(null)

  // 有 adHoc 内容进来时自动进入对话视图（粘贴分析入口）
  useEffect(() => {
    if (adHocContent) {
      setMode('chat')
      setMessages([])
      historyRef.current = []
    }
  }, [adHocContent])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const startAnalysis = () => {
    if (selectedItems.length === 0) return
    setMode('chat')
    setMessages([])
    historyRef.current = []
  }

  const backToQuick = () => {
    setMode('quick')
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || sending) return

    setInput('')
    setSending(true)

    const userMsg = { role: 'user', content: text }
    historyRef.current.push(userMsg)
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', streaming: true }])

    let fullResponse = ''

    try {
      const body = adHocContent
        ? { contentIds: [], adHocContents: [adHocContent], messages: historyRef.current }
        : { contentIds: selectedItems.map(i => i.id), adHocContents: [], messages: historyRef.current }

      const res = await fetch('/api/chat/ephemeral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() // 最后一段可能不完整，留到下一轮

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const event = JSON.parse(line.slice(6))

          if (event.type === 'content') {
            fullResponse += event.content
            setMessages(prev => {
              const next = [...prev]
              next[next.length - 1] = { role: 'assistant', content: fullResponse, streaming: true }
              return next
            })
          } else if (event.type === 'error') {
            throw new Error(event.error)
          } else if (event.type === 'done') {
            historyRef.current.push({ role: 'assistant', content: fullResponse })
          }
        }
      }

      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: fullResponse }
        return next
      })
    } catch (err) {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: `请求失败：${err.message}`, error: true }
        return next
      })
      // 失败不入历史，避免污染下一轮上下文（与原型一致）
      historyRef.current.pop()
    } finally {
      setSending(false)
    }
  }

  // 保存到笔记（M1 沉淀层，ADR-010 NotebookLM 模式）：只保存用户主动选择的回复片段。
  // 来源引用：单选内容记 contentId 可溯源；多选记拼接标题；adHoc 记标题+URL（未入库，靠冗余字段）
  const saveToNote = async (msgIndex) => {
    const msg = messages[msgIndex]
    if (!msg || msg.role !== 'assistant' || msg.streaming || msg.error || msg.savedNoteId) return

    const sourceRef = adHocContent
      ? {
          contentId: adHocContent.id || null,
          sourceTitle: adHocContent.zh_title || adHocContent.en_title || '粘贴的内容',
          sourceUrl: adHocContent.url || null
        }
      : {
          contentId: selectedItems.length === 1 ? selectedItems[0].id : null,
          sourceTitle: selectedItems.map(i => i.zh_title || i.en_title).filter(Boolean).join(' / ').slice(0, 120) || null,
          sourceUrl: selectedItems.length === 1 ? (selectedItems[0].url || null) : null
        }

    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excerpt: msg.content, noteType: 'chat', ...sourceRef })
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setMessages(prev => prev.map((m, i) => i === msgIndex ? { ...m, savedNoteId: json.data.id } : m))
    } catch (err) {
      alert(`保存失败：${err.message}`)
    }
  }

  const chatItemCount = adHocContent ? 1 : selectedItems.length

  return (
    <div className="ai-panel-content">
      {mode === 'quick' && (
        <div id="quickAnalysisView">
          <div className="ai-panel-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <h2>Quick Analysis</h2>
          </div>
          <p className="ai-panel-subtitle">选中内容即时分析</p>

          {selectedItems.length > 0 ? (
            <>
              <div className="selected-items">
                <div className="selected-items-title">已选中 ({selectedItems.length})</div>
                <div>
                  {selectedItems.map(item => (
                    <div key={item.id} style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '0.25rem 0' }}>
                      • {item.zh_title || item.en_title}
                    </div>
                  ))}
                </div>
              </div>
              <button className="btn-primary" onClick={startAnalysis}>开始分析</button>
            </>
          ) : (
            <div className="empty-state">等待选择</div>
          )}
        </div>
      )}

      {mode === 'chat' && (
        <div className="chat-view active">
          <div className="chat-header">
            <button className="btn-back" onClick={backToQuick}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span>返回</span>
            </button>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              基于 {chatItemCount} 篇内容
            </span>
          </div>

          <div className="chat-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                <div className="chat-message-header">
                  <div className="chat-message-avatar" />
                  <span className="chat-message-name">{msg.role === 'user' ? '你' : 'AI'}</span>
                </div>
                <div className={`chat-message-content${msg.streaming ? ' streaming' : ''}${msg.error ? ' error' : ''}`}>
                  {msg.content}
                </div>
                {msg.role === 'assistant' && !msg.streaming && !msg.error && (
                  <button
                    className={`btn-save-note${msg.savedNoteId ? ' saved' : ''}`}
                    onClick={() => saveToNote(i)}
                    disabled={Boolean(msg.savedNoteId)}
                  >
                    {msg.savedNoteId ? '✓ 已存入素材库' : '保存到笔记'}
                  </button>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-area">
            <textarea
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="输入你的问题..."
              rows={3}
            />
            <div className="chat-actions">
              <span className="chat-actions-hint">好的回答可点"保存到笔记"沉淀为素材</span>
              <button
                className="btn-primary"
                style={{ width: 'auto', flexShrink: 0, padding: '0.625rem 1.25rem' }}
                disabled={sending}
                onClick={sendMessage}
              >
                发送
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
