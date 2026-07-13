import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import ReactMarkdown from 'react-markdown'

// Mode 1 即兴分析弹窗（ADR-009）。无状态：不落库，关闭即丢弃，除非用户显式操作保存
// （Phase 1 暂无 Topic UI，保存动作先不做，见 SYNTHESIZED-ARCHITECTURE.md §10 Phase 3 才有 Topic）。
//
// 两种材料来源，对应同一个弹窗的两个入口：
// - contentIds：Feed 里选中的已入库内容，后端 ephemeral-chat.js 直接读原文
// - adHocInput：用户粘贴的链接/文本，这里先调 /api/content/ingest 摄入+翻译，
//   拿到的结果原样作为 adHocContents 传给 /api/chat/ephemeral（不重复摄入）
export default function EphemeralChatDialog({ contentIds = [], contentTitles = [], adHocInput = null, onClose }) {
  const [ingestStatus, setIngestStatus] = useState(adHocInput ? 'loading' : 'ready')
  const [ingestError, setIngestError] = useState(null)
  const [adHocContent, setAdHocContent] = useState(null)

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')

  const [activeContentId, setActiveContentId] = useState(contentIds.length === 1 ? contentIds[0] : null)
  const [analysisLoading, setAnalysisLoading] = useState(null) // 'summary' | 'perspectives' | null
  const [analysisResult, setAnalysisResult] = useState(null)

  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (!adHocInput) return

    let cancelled = false
    setIngestStatus('loading')
    setIngestError(null)

    axios.post('/api/content/ingest', { input: adHocInput })
      .then(res => {
        if (cancelled) return
        if (!res.data.success) {
          setIngestStatus('error')
          setIngestError(res.data.data?.fetchError || '摄入失败')
          return
        }
        setAdHocContent(res.data.data)
        setIngestStatus('ready')
      })
      .catch(err => {
        if (cancelled) return
        setIngestStatus('error')
        setIngestError(err.response?.data?.error || err.message)
      })

    return () => { cancelled = true }
  }, [adHocInput])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const materialTitle = adHocContent
    ? (adHocContent.zhTitle || adHocContent.enTitle || '（用户提供的内容）')
    : contentTitles.join('、')

  const handleSend = async () => {
    if (!input.trim() || isStreaming || ingestStatus !== 'ready') return

    const userMessage = { role: 'user', content: input.trim() }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput('')
    setIsStreaming(true)
    setStreamingContent('')

    try {
      const response = await fetch('/api/chat/ephemeral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentIds,
          adHocContents: adHocContent ? [adHocContent] : [],
          messages: nextMessages
        })
      })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n\n')) {
          if (!line.startsWith('data: ')) continue
          const data = JSON.parse(line.slice(6))

          if (data.type === 'content') {
            fullContent += data.content
            setStreamingContent(fullContent)
          } else if (data.type === 'done') {
            setMessages(prev => [...prev, { role: 'assistant', content: fullContent }])
            setStreamingContent('')
          } else if (data.type === 'error') {
            setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ 出错了：${data.error}` }])
            setStreamingContent('')
          }
        }
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ 请求失败：${error.message}` }])
      setStreamingContent('')
    } finally {
      setIsStreaming(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  // 快捷问题/分析动作只对"选中单条已入库内容"开放——摘要/观点提取是单篇内容级别的分析
  // （content-analysis.js 的范围），多选或一次性链接场景直接走对话即可，不重复建 UI
  const runAnalysis = async (type) => {
    if (!activeContentId || analysisLoading) return
    setAnalysisLoading(type)
    setAnalysisResult(null)
    try {
      const res = await axios.post(`/api/content/${activeContentId}/${type}`)
      setAnalysisResult({ type, ...res.data.data })
    } catch (error) {
      setAnalysisResult({ type, error: error.response?.data?.error || error.message })
    } finally {
      setAnalysisLoading(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <div className="text-xs text-gray-400 mb-0.5">即兴分析</div>
            <div className="text-sm font-medium text-gray-900 truncate">{materialTitle || '分析对话'}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none px-2">×</button>
        </div>

        {/* 摄入状态 */}
        {ingestStatus === 'loading' && (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            正在抓取/转写内容…
          </div>
        )}
        {ingestStatus === 'error' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-sm text-red-500">⚠️ {ingestError}</div>
            <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">关闭</button>
          </div>
        )}

        {/* 就绪：对话区 */}
        {ingestStatus === 'ready' && (
          <>
            {activeContentId && (
              <div className="flex gap-2 px-5 py-2 border-b border-gray-100 text-xs">
                <button
                  onClick={() => runAnalysis('summary')}
                  disabled={analysisLoading !== null}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 disabled:opacity-50"
                >
                  {analysisLoading === 'summary' ? '生成中…' : '生成摘要'}
                </button>
                <button
                  onClick={() => runAnalysis('perspectives')}
                  disabled={analysisLoading !== null}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 disabled:opacity-50"
                >
                  {analysisLoading === 'perspectives' ? '提取中…' : '提取观点'}
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {analysisResult && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm">
                  {analysisResult.error ? (
                    <div className="text-red-500">⚠️ {analysisResult.error}</div>
                  ) : analysisResult.type === 'summary' ? (
                    <div className="whitespace-pre-wrap text-gray-800">{analysisResult.summary}</div>
                  ) : (
                    <div className="text-gray-800">
                      <div className="font-medium mb-1">立场：{analysisResult.stance || '无'}</div>
                      <ul className="space-y-1 list-disc list-inside">
                        {analysisResult.points?.map((p, i) => (
                          <li key={i}><span className="font-medium">{p.statement}</span> — {p.evidence}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {analysisResult.note && (
                    <div className="mt-2 text-xs text-amber-600">⚠️ {analysisResult.note}</div>
                  )}
                </div>
              )}

              {messages.length === 0 && !streamingContent && (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                  基于{contentIds.length > 0 ? '选中的内容' : '这条材料'}提问吧
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`mb-4 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                  <div className={`inline-block max-w-[85%] text-left px-3 py-2 rounded-lg text-sm ${
                    msg.role === 'user' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'
                  }`}>
                    {msg.role === 'user' ? (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    ) : (
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {streamingContent && (
                <div className="mb-4 text-left">
                  <div className="inline-block max-w-[85%] px-3 py-2 rounded-lg bg-gray-100 text-sm">
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown>{streamingContent}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-gray-100 px-4 py-3">
              <div className="flex gap-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入问题…（Cmd/Ctrl + Enter 发送）"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
                  rows={1}
                  disabled={isStreaming}
                  autoFocus
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isStreaming}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50"
                >
                  {isStreaming ? '…' : '发送'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
