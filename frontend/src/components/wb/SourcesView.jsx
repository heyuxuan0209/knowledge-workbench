import { useState } from 'react'
import { api, MODES, sourceModeNote } from './util'

// 信息源登记处（视觉对齐原型 03-sources）：识别 → 确认登记 → 分组列表（track_mode 四色徽章）。
// 登记效果只有两个：内容进资讯流 + 高权重排序（ADR-007，不是订阅系统）。
// 2026-07-16 反馈轮：立即同步 / 官方源包 / 每源能力说明 / 添加示例引导 / 按类型分组。

// 支持的输入类型与示例（点示例填入输入框即可试）
const INPUT_EXAMPLES = [
  { type: 'X 账号', example: '@karpathy', desc: '@用户名 或 x.com 主页链接 · 借道 AI HOT 收其热门转载' },
  { type: '博客 / 官网', example: 'https://openai.com/news', desc: '粘官网栏目链接，自动探测 RSS · 每日抓取全文' },
  { type: 'RSS 地址', example: 'https://openai.com/news/rss.xml', desc: '已知 feed 地址直接粘' },
  { type: '小宇宙播客', example: 'https://www.xiaoyuzhoufm.com/podcast/61933ace1b4320461e91fd55', desc: '节目页或任意单集链接 · 每日追更新单集' },
  { type: 'B站 UP 主', example: 'https://space.bilibili.com/1556651916', desc: 'UP 主主页链接 · 每日拉最新视频' },
  { type: 'YouTube 频道', example: 'https://youtube.com/@lexfridman', desc: '频道链接（@handle）· 每日拉新，标题自动翻译' },
  { type: 'GitHub 用户', example: 'https://github.com/karpathy', desc: '追踪其最近活跃的仓库' },
  { type: '公众号', example: '晚点LatePost', desc: '直接输入公众号名称 · 无公开接口，仅登记标注' },
  { type: '其他任意网址', example: 'https://simonwillison.net/', desc: '不在上面类型里也能加：有 RSS 自动抓取，没有则降级为仅登记跳转' },
]

// 信源分类 tab（按第一个平台归组；catch-all「其他」兜住未来新增平台类型）
const GROUPS = [
  { key: 'x', label: 'X', match: p => p === 'X' },
  { key: 'rss', label: '博客/RSS', match: p => p === 'RSS' || p === 'Blog' || p === 'Newsletter' },
  { key: 'podcast', label: '播客', match: p => p === 'Podcast' },
  { key: 'video', label: 'B站/YouTube', match: p => p === 'Bilibili' || p === 'YouTube' },
  { key: 'github', label: 'GitHub', match: p => p === 'GitHub' },
  { key: 'wechat', label: '公众号', match: p => p === 'WeChat' },
  { key: 'other', label: '其他', match: () => true },
]

export default function SourcesView({ sources, loadSources, loadNotes, showToast, setModal, syncing, syncAllSources }) {
  const [input, setInput] = useState('')
  const [identifying, setIdentifying] = useState(false)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [packBusy, setPackBusy] = useState(false)
  const [helpOpen, setHelpOpen] = useState(sources.length === 0)
  const [activeTab, setActiveTab] = useState('all')

  const registerPack = async () => {
    setPackBusy(true)
    try {
      const json = await api('/api/sources/register-pack', { method: 'POST' })
      const ok = (json.data || []).filter(r => r.success).length
      loadSources()
      showToast(`官方源包已登记 ${ok} 个源（Anthropic/OpenAI/Google 系）。点「立即同步」拉取最新内容`)
    } catch (err) { showToast(`登记失败：${err.message}`) } finally { setPackBusy(false) }
  }

  const doIdentify = async (value) => {
    const v = (value ?? input).trim()
    if (!v || identifying) return
    setIdentifying(true); setError(null); setPreview(null)
    try {
      const json = await api('/api/sources/identify', { method: 'POST', body: { input: v } })
      if (!json.success) throw new Error(json.error)
      setPreview(json.data)
    } catch (err) { setError(err.message) } finally { setIdentifying(false) }
  }

  const register = async () => {
    try {
      const json = await api('/api/sources/register', { method: 'POST', body: { identified: preview } })
      if (!json.success) throw new Error(json.error)
      setPreview(null); setInput('')
      loadSources()
      showToast(`已登记信息源：${json.data.display_name}`)
    } catch (err) { setError(`登记失败：${err.message}`) }
  }

  const unfollow = async (s) => {
    if (!confirm(`取消关注「${s.display_name}」？（历史内容不受影响，只是不再加权/追踪）`)) return
    try {
      await api(`/api/sources/${s.id}/register`, { method: 'DELETE' })
      loadSources()
    } catch (err) { showToast(`操作失败：${err.message}`) }
  }

  const modeOf = (m) => MODES[m] || MODES.passive

  // 分类：每个源按其第一个平台归入第一个命中的组（tab 切换，反馈：竖排全列太长）
  const grouped = GROUPS.map(g => ({ ...g, items: [] }))
  for (const s of sources) {
    const platform = s.platforms?.[0]?.platform
    const g = grouped.find(x => x.match(platform))
    g.items.push(s)
  }
  const tabs = [{ key: 'all', label: '全部', count: sources.length }, ...grouped.filter(g => g.items.length).map(g => ({ key: g.key, label: g.label, count: g.items.length }))]
  const shown = activeTab === 'all' ? sources : (grouped.find(g => g.key === activeTab)?.items || [])

  const sourceRow = (s) => {
    const note = (s.platforms || []).map(sourceModeNote).find(Boolean)
    return (
      <div key={s.id} className="wb-card" style={{ marginTop: 0, marginBottom: 9, padding: '12px 15px', borderRadius: 10 }}>
        <div className="wb-src-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="wb-src-name">{s.display_name}</span>
          {(s.platforms || []).map(p => (
            <span key={p.id} className="wb-pill" title={p.handle}
              style={{ color: modeOf(p.track_mode).fg, background: modeOf(p.track_mode).bg, borderRadius: 6 }}>
              {p.platform} · {modeOf(p.track_mode).cn}
            </span>
          ))}
          <span className="wb-src-count">{s.content_count} 条</span>
          <button className="wb-src-unfollow" style={{ color: '#a24b3f' }} onClick={() => unfollow(s)}>取消关注</button>
        </div>
        {note && <div style={{ fontSize: 11.5, color: 'var(--sub2)', marginTop: 5, lineHeight: 1.5 }}>ⓘ {note}</div>}
      </div>
    )
  }

  return (
    <>
      <div className="wb-page-title">信息源</div>
      <div className="wb-page-sub">登记优质源：内容进 资讯流 并高权重排序 · 不是订阅系统</div>

      <div className="wb-acquire" style={{ marginTop: 16 }}>
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') doIdentify() }}
          placeholder="粘贴链接（X / 博客 / 小宇宙 / B站 / YouTube / GitHub）或输入 @用户名、公众号名…"
        />
        <button className="wb-btn-primary" disabled={!input.trim() || identifying} onClick={() => doIdentify()}>
          {identifying ? '识别中…' : '识别'}
        </button>
      </div>
      <button className="wb-brief-link" style={{ marginTop: 8 }} onClick={() => setHelpOpen(v => !v)}>
        {helpOpen ? '收起示例 ▴' : '怎么添加？看支持的类型和示例 ▾'}
      </button>

      {helpOpen && (
        <div className="wb-card" style={{ padding: '14px 18px', background: 'var(--brief-bg)', borderColor: 'rgba(61,90,128,.22)' }}>
          <div className="wb-card-label">支持 8 类输入 · 点示例自动填入试一试</div>
          {INPUT_EXAMPLES.map(e => (
            <div key={e.type} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 0', fontSize: 12.5, lineHeight: 1.5 }}>
              <b style={{ flex: 'none', width: 88 }}>{e.type}</b>
              <button className="wb-brief-link" style={{ flex: 'none', padding: 0, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title="点击填入输入框" onClick={() => { setInput(e.example); doIdentify(e.example) }}>
                {e.example}
              </button>
              <span style={{ color: 'var(--sub2)' }}>{e.desc}</span>
            </div>
          ))}
          <div style={{ fontSize: 12, color: 'var(--sub2)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line08)' }}>
            已内置、无需添加：<b>AI HOT</b>（精选推送）、<b>Hacker News</b>、<b>GitHub Trending</b> —— 每天 7:30 自动同步进资讯流
          </div>
        </div>
      )}

      {error && <div className="wb-error">{error}</div>}

      {preview && (
        <div className="wb-card wb-src-preview">
          <div className="wb-src-preview-label">识别结果（可修改名称后登记）</div>
          <div className="wb-src-preview-row">
            <input className="wb-src-preview-name" value={preview.displayName}
              onChange={(e) => setPreview({ ...preview, displayName: e.target.value })} />
            <span className="wb-pill" style={{ color: modeOf(preview.trackMode).fg, background: modeOf(preview.trackMode).bg, borderRadius: 6 }}>
              {preview.platform} · {modeOf(preview.trackMode).cn}
            </span>
          </div>
          {preview.note && <div className="wb-src-note">{preview.note}</div>}
          <div className="wb-src-actions">
            <button className="wb-btn-primary" onClick={register}>登记为信息源</button>
            <button className="wb-btn-ghost" onClick={() => setPreview(null)}>取消</button>
          </div>
        </div>
      )}

      <div className="wb-src-entries" style={{ margin: '18px 0 12px' }}>
        <button className="wb-src-entry" onClick={() => setModal('pool')}>+ 添加信源池</button>
        <button className="wb-src-entry" onClick={() => setModal('import')}>+ 批量导入</button>
        <button className="wb-src-entry" disabled={packBusy} onClick={registerPack}
          title="Anthropic News/Engineering/Research + OpenAI News（含 ChatGPT）+ Google AI/Research/DeepMind，feed 均已实测可用">
          {packBusy ? '登记中…' : '+ 官方源包（Claude/OpenAI/Google）'}
        </button>
        <button className="wb-src-entry" disabled={syncing} onClick={syncAllSources}
          title="跑全部三条同步链：AI HOT + RSS 抓取 + 主动查询（B站/YouTube/GitHub/小宇宙）">
          {syncing ? '同步中…' : '↻ 立即同步全部信源'}
        </button>
      </div>

      {sources.length === 0 && (
        <div className="wb-empty">还没有登记信息源。<br />也可以在资讯卡片上点「＋关注」从内容里发现好作者。</div>
      )}

      {sources.length > 0 && (
        <div className="wb-filterbar" style={{ margin: '0 0 12px' }}>
          {tabs.map(t => (
            <button key={t.key} className="wb-filter-chip"
              style={activeTab === t.key ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 600 } : undefined}
              onClick={() => setActiveTab(t.key)}>
              {t.label}（{t.count}）
            </button>
          ))}
        </div>
      )}

      {shown.map(sourceRow)}
    </>
  )
}
