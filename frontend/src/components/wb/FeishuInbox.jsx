import { useState } from 'react'
import { api } from './util'
import { IconFeishu } from './Icons'

// 飞书私信收件箱（ADR-039，用户拍板：私信直连 + 默认静默 + 问句才回）。
// 你在飞书私信这个机器人一句 → 长连接实时捕获进这里，待你挑进灵感。
//   · 陈述句：静默记（机器人不吭声、不花钱）
//   · 问句(？结尾)：它回你一句（DeepSeek），这里标「你问过它·已回」并带上回复
// 分诊：采纳为灵感 / 忽略。未接凭证或机器人没连上时给配置指引。

export default function FeishuInbox({ showToast, loadIdeas }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(null) // { configured, botStarted, pending }
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const s = await api('/api/feishu/status')
      setStatus(s.data)
      if (s.data?.configured) setItems((await api('/api/feishu/inbox')).data || [])
    } catch (err) { showToast?.(`飞书状态读取失败：${err.message}`) }
    setLoading(false)
  }
  const onToggle = (e) => { const n = e.target.open; setOpen(n); if (n && !status) refresh() }

  const triage = async (item, action) => {
    setBusy(item.id)
    try {
      const j = await api(`/api/feishu/inbox/${item.id}/triage`, { method: 'POST', body: { action } })
      if (!j.success) { showToast?.(j.error || '处理失败'); setBusy(null); return }
      setItems(prev => prev.filter(x => x.id !== item.id))
      if (action === 'idea') { loadIdeas?.(); showToast?.('已提为灵感（在你的灵感里）') }
      else showToast?.('已忽略')
    } catch (err) { showToast?.(`处理失败：${err.message}`) }
    setBusy(null)
  }

  const cfg = status?.configured
  const online = status?.botStarted
  const summary = !status ? '未接入 ▾'
    : !cfg ? '未接入 ▾'
    : status.pending ? `${status.pending} 条待挑 ▾`
    : (online ? '机器人在线 ▾' : '机器人未连上 ▾')

  return (
    <details className="wb-feishu-inbox" onToggle={onToggle}>
      <summary>
        <span className="fi-logo"><IconFeishu size={22} /></span>
        <span className="txt"><b>飞书私信 · 随手记</b> —— 私信机器人一句，自动躺进这里待挑</span>
        <span className="soon">{summary}</span>
      </summary>

      <div className="wb-feishu-body">
        {loading && <div style={{ color: 'var(--faint)', fontSize: 12 }}>读取中…</div>}

        {status && !cfg && (
          <>
            <b>还差你的飞书配置</b>，配好后：私信这个机器人一句 → 自动进这里待挑进灵感。
            <div style={{ marginTop: 8, lineHeight: 1.9 }}>
              ① 开放平台给应用加权限 <code>im:message</code>（收+发，做"问句才回"）、<code>docx/wiki/minutes readonly</code>（取料用）；<br />
              ② 事件订阅切「<b>长连接</b>」模式、订阅 <code>接收消息 im.message.receive_v1</code>；<br />
              ③ <code>FEISHU_APP_ID / FEISHU_APP_SECRET</code> 填进 <code>backend/.env</code>，重启后端。
            </div>
          </>
        )}

        {cfg && (
          <>
            <div className="wb-feishu-bar">
              <span style={{ fontSize: 12, color: online ? 'var(--green)' : 'var(--amber)' }}>
                {online ? '● 机器人在线，私信实时收' : '○ 机器人没连上（检查长连接/事件订阅）'}
              </span>
              <button className="wb-btn-mini" style={{ marginLeft: 'auto' }} disabled={loading} onClick={refresh}>↻ 刷新</button>
            </div>
            <div className="hint-line">陈述句<b>静默记</b>、问句（<b>？结尾</b>）它才回你一句（DeepSeek，几乎不花钱）。</div>

            {items.length === 0 ? (
              <div style={{ color: 'var(--faint)', fontSize: 12, marginTop: 10 }}>
                还没有。去飞书<b>私信这个机器人</b>随手记一句，几秒后点「刷新」就在这。
              </div>
            ) : (
              <div className="wb-feishu-list">
                {items.map(it => (
                  <div key={it.id} className="wb-feishu-item">
                    <div className="wb-feishu-item-top">
                      <span className="wb-pill pill-idea">待挑进灵感</span>
                      {it.extra?.asked && <span className="wb-pill pill-ask">🗨 你问过它·已回</span>}
                      <span className="time">{it.feishu_time ? '' : ''}{timeAgo(it.created_at)}</span>
                    </div>
                    <div className="wb-feishu-title">{it.snippet || it.title}</div>
                    {it.extra?.reply && <div className="wb-feishu-reply">它回：{it.extra.reply}</div>}
                    <div className="wb-feishu-actions">
                      <button className="wb-btn-primary" style={{ padding: '3px 12px', fontSize: 11.5 }}
                        disabled={busy === it.id} onClick={() => triage(it, 'idea')}>采纳为灵感</button>
                      <button className="wb-btn-ghost" style={{ padding: '3px 10px', fontSize: 11.5, marginLeft: 'auto' }}
                        disabled={busy === it.id} onClick={() => triage(it, 'ignore')}>忽略</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </details>
  )
}

// 轻量相对时间（避免多依赖）
function timeAgo(iso) {
  if (!iso) return ''
  const t = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime()
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
