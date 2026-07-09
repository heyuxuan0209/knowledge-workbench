import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import ReactMarkdown from 'react-markdown'

export default function ChatInterface({ conversationId, messages: initialMessages, provider, onRefresh }) {
  const [messages, setMessages] = useState(initialMessages || [])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    setMessages(initialMessages || [])
  }, [initialMessages])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingContent])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return

    const userMessage = input.trim()
    setInput('')

    // 添加用户消息到界面
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])

    setIsStreaming(true)
    setStreamingContent('')

    try {
      const response = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          conversationId,
          message: userMessage,
          provider
        })
      })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'content') {
              fullContent += data.content
              setStreamingContent(fullContent)
            } else if (data.type === 'done') {
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: fullContent,
                tokens_used: data.tokens,
                cost_yuan: data.cost
              }])
              setStreamingContent('')
              onRefresh?.()
            } else if (data.type === 'error') {
              console.error('Stream error:', data.error)
              setStreamingContent('')
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error)
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

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
    }
  }

  useEffect(() => {
    adjustTextareaHeight()
  }, [input])

  return (
    <div className="flex-1 flex flex-col">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && !streamingContent && (
          <div className="flex items-center justify-center h-full text-stone-400">
            开始对话
          </div>
        )}

        {messages.map((msg, index) => (
          <div
            key={index}
            className={`mb-6 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}
          >
            <div
              className={`inline-block max-w-3xl text-left ${
                msg.role === 'user'
                  ? 'bg-stone-900 text-white px-4 py-2 rounded-lg'
                  : 'bg-white border border-stone-200 px-4 py-2 rounded-lg'
              }`}
            >
              {msg.role === 'user' ? (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              ) : (
                <div className="prose prose-sm prose-stone max-w-none">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              )}
            </div>
            {msg.role === 'assistant' && msg.tokens_used > 0 && (
              <div className="text-xs text-stone-400 mt-1 ml-2">
                {msg.tokens_used} tokens · ¥{msg.cost_yuan.toFixed(4)}
              </div>
            )}
          </div>
        ))}

        {streamingContent && (
          <div className="mb-6 text-left">
            <div className="inline-block max-w-3xl bg-white border border-stone-200 px-4 py-2 rounded-lg">
              <div className="prose prose-sm prose-stone max-w-none">
                <ReactMarkdown>{streamingContent}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="border-t border-stone-200 bg-white px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息...（Cmd/Ctrl + Enter 发送）"
              className="flex-1 px-4 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-900 resize-none"
              rows={1}
              disabled={isStreaming}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="px-6 py-2 bg-stone-900 text-white rounded-lg hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isStreaming ? '发送中...' : '发送'}
            </button>
          </div>
          <div className="text-xs text-stone-400 mt-2">
            提示：Cmd/Ctrl + Enter 快速发送
          </div>
        </div>
      </div>
    </div>
  )
}
