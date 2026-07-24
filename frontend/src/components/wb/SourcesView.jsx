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

// 平台图标（与资讯/素材同款视觉）：信源保留精确平台名（RSS/Blog 要区分），只加图标前缀
const PLAT_ICON = { YouTube: '▶ ', Bilibili: '▶ ', Podcast: '🎙 ', Xiaoyuzhou: '🎙 ' }

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
  // 第2件 关注盘点面板
  const [auditOpen, setAuditOpen] = useState(false)
  const [audit, setAudit] = useState(null)
  const [keep, setKeep] = useState(() => new Set())      // 勾选保留关注的 source id
  const [rosterSel, setRosterSel] = useState(() => new Set()) // B1/A缺口：勾选新建的采集 handle（默认全勾）
  const [mediaSel, setMediaSel] = useState(() => new Set())   // B2 媒体/名人：勾选新建的 handle（默认全空）
  const [mediaOpen, setMediaOpen] = useState(false)           // B2 灰置底默认收起
  const [auditBusy, setAuditBusy] = useState(false)
  // 第4件 自助添加 X 账号 → 入 sync-x 采集名单
  const [xHandle, setXHandle] = useState('')
  const addX = async () => {
    const h = xHandle.trim(); if (!h) return
    setXHandle('')
    try {
      const j = await api('/api/sources/x-account', { method: 'POST', body: { handle: h } })
      const d = j.data
      if (d.overLimit) showToast?.(`X 采集名单已满（${d.current}/${d.cap}）——先在「关注盘点」里取舍掉几个再加`)
      else if (d.existed && !d.addedToRoster) showToast?.(`@${d.handle} 已在采集名单`)
      else { showToast?.(`已加 @${d.handle} 进 X 直连采集（下次同步开始拉取；未配 cookies 前先备着）`); loadSources?.() }
    } catch (e) { showToast?.('添加失败：' + e.message) }
  }
  const openAudit = async () => {
    setAuditOpen(true); setAudit(null)
    try {
      const j = await api('/api/sources/follow-audit'); const d = j.data
      setAudit(d)
      // 预勾：已关注 + 名单匹配的库内源；媒体（isMedia）默认不勾
      setKeep(new Set(d.items.filter(i => (i.followed || i.precheck) && !i.isMedia).map(i => i.id)))
      setRosterSel(new Set((d.toCreateRoster || []).map(c => c.handle)))  // A缺口+B1 默认全勾
      setMediaSel(new Set())                                             // B2 媒体默认全空
      setMediaOpen(false)
    } catch (e) { showToast?.('盘点加载失败：' + e.message) }
  }
  const applyAudit = async () => {
    setAuditBusy(true)
    try {
      const createRoster = (audit.toCreateRoster || []).filter(c => rosterSel.has(c.handle))
      const createMedia = (audit.toCreateMedia || []).filter(c => mediaSel.has(c.handle))
      const j = await api('/api/sources/follow-audit/apply', { method: 'POST', body: { keepIds: [...keep], createRoster, createMedia } })
      const extra = j.data.aliased ? ` · 合并同人 ${j.data.aliased}` : ''
      showToast?.(`已重设关注：保留 ${j.data.kept} 个 · 新建 ${j.data.created} 个源${extra}`)
      setAuditOpen(false); loadSources?.()
    } catch (e) { showToast?.('应用失败：' + e.message) }
    setAuditBusy(false)
  }
  // sync-x 采集名单计数（已选 N/35）：库内已选的 X active-query 源 + 勾选的采集档新建源
  const rosterCount = audit
    ? audit.items.filter(i => i.isRoster && keep.has(i.id)).length + rosterSel.size
    : 0

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

  const sourceCard = (s) => {
    const note = (s.platforms || []).map(sourceModeNote).find(Boolean)
    const p0 = s.platforms?.[0]
    return (
      <div key={s.id} className="wb-scard">
        <div className="wb-scard-name">{s.display_name}</div>
        <div className="wb-scard-badges">
          {(s.platforms || []).map(p => (
            <span key={p.id} className="wb-pill" title={p.handle}
              style={{ color: modeOf(p.track_mode).fg, background: modeOf(p.track_mode).bg, borderRadius: 6 }}>
              {PLAT_ICON[p.platform] || ''}{p.platform} · {modeOf(p.track_mode).cn}
            </span>
          ))}
        </div>
        <div className="wb-scard-foot">
          <span className="wb-src-count">{s.content_count} 条进 Feed</span>
          <button className="wb-src-unfollow" style={{ color: '#a24b3f' }} onClick={() => unfollow(s)}>取消关注</button>
        </div>
        {note && <div className="wb-scard-note">ⓘ {note}</div>}
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div className="wb-page-title">信息源</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={xHandle} onChange={e => setXHandle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) addX() }}
            placeholder="加 X 账号采集（@handle）…" title="输入 X handle → 建作者源 → 纳入每日 X 直连采集（≤35）"
            style={{ fontSize: 12, padding: '5px 9px', width: 180, border: '1px solid var(--line10)', borderRadius: 7, background: 'var(--surface)', color: 'var(--body)' }} />
          <button className="wb-btn-ghost" onClick={addX}>＋ X</button>
          <button className="wb-btn-ghost" title="重设关注名单：勾选真正想关注的作者，其余取消（喂 feed 组2「你关注的 Builder」）" onClick={openAudit}>🧭 关注盘点</button>
        </div>
      </div>
      <div className="wb-page-sub">登记优质源：内容进 资讯流 并高权重排序 · 不是订阅系统</div>

      <div className="wb-acquire" style={{ marginTop: 16 }}>
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) doIdentify() }}
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
              {PLAT_ICON[preview.platform] || ''}{preview.platform} · {modeOf(preview.trackMode).cn}
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

      <div className="wb-src-grid">{shown.map(sourceCard)}</div>

      {/* 第2件 · 关注盘点面板 */}
      {auditOpen && (
        <div className="wb-modal-mask" onClick={(e) => { if (e.target === e.currentTarget) setAuditOpen(false) }}>
          <div className="wb-modal" style={{ maxWidth: 640, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
            <div className="wb-modal-head">
              <div className="wb-modal-title">🧭 关注盘点</div>
              <button className="wb-modal-close" style={{ marginLeft: 'auto' }} onClick={() => setAuditOpen(false)}>×</button>
            </div>
            {!audit && <div style={{ padding: 24, textAlign: 'center', color: 'var(--sub2)' }}>加载中…</div>}
            {audit && (<>
              <div style={{ fontSize: 12.5, color: 'var(--sub)', lineHeight: 1.6, padding: '2px 2px 10px' }}>
                勾选你<b>真正想长期关注</b>的作者——它们进 feed 组2「你关注的 Builder」。取消勾选的会撤销关注（不删源、内容还在）。
                v2 完整重拉你 X 关注 95 个；<b>X 关注 ≠ 工作台信源</b>，媒体/名人默认不采集（防非 AI 噪音灌库）。
                已预勾：库内匹配 <b>{audit.precheckCount}</b> 个 + 建议采集 {(audit.toCreateRoster || []).length} 个。
                {(audit.aliasNotes || []).length > 0 && <span style={{ color: 'var(--faint)' }}> · 同人已合并：{audit.aliasNotes.map(a => `@${a.alias}→${a.name}`).join('、')}。</span>}
              </div>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {/* A缺口 + B1：建议采集，默认全勾，建 active-query 采集源 */}
                {(audit.toCreateRoster || []).length > 0 && (
                  <div style={{ border: '1px dashed rgba(61,90,128,.4)', borderRadius: 9, padding: '9px 12px', marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 6 }}>🆕 库里还没有、建议采集的 {audit.toCreateRoster.length} 个（AI/科技作者 + 官方主号）——勾上会新建作者源并纳入 X 直连采集：</div>
                    {audit.toCreateRoster.map(c => (
                      <label key={c.handle} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 12.5, cursor: 'pointer' }}>
                        <input type="checkbox" checked={rosterSel.has(c.handle)} onChange={() => setRosterSel(s => { const n = new Set(s); n.has(c.handle) ? n.delete(c.handle) : n.add(c.handle); return n })} />
                        <b>{c.name}</b><span style={{ color: 'var(--faint)' }}>@{c.handle}</span>
                        {c.kind === 'matched' && <span className="wb-pill" style={{ fontSize: 9, color: 'var(--green)', background: 'rgba(63,115,80,.1)', flex: 'none' }}>官方/主号</span>}
                      </label>
                    ))}
                  </div>
                )}
                {audit.items.map(it => (
                  <label key={it.id} style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '6px 4px', fontSize: 12.5, borderBottom: '1px solid var(--line08)', cursor: 'pointer', opacity: keep.has(it.id) ? 1 : 0.55 }}>
                    <input type="checkbox" checked={keep.has(it.id)} onChange={() => setKeep(s => { const n = new Set(s); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n })} />
                    <span style={{ flex: 'none', fontWeight: 600, minWidth: 0, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                    {it.precheck && <span className="wb-pill" style={{ fontSize: 9.5, color: 'var(--accent)', background: 'rgba(61,90,128,.1)', flex: 'none' }}>X 名单</span>}
                    {it.isMedia && <span className="wb-pill" style={{ fontSize: 9.5, color: 'var(--faint)', background: 'var(--surface)', flex: 'none' }}>媒体</span>}
                    {it.isRoster && <span className="wb-pill" style={{ fontSize: 9, color: 'var(--amber)', background: 'rgba(169,121,31,.1)', flex: 'none' }}>采集中</span>}
                    {it.platform && <span style={{ fontSize: 10.5, color: 'var(--faint)', flex: 'none' }}>{it.platform}</span>}
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--sub2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.latest || '（近期无内容）'}</span>
                    <span style={{ fontSize: 11, color: 'var(--faint)', flex: 'none' }}>30天 {it.count30d} 条</span>
                  </label>
                ))}
                {/* B2 媒体/名人：灰置底、默认收起、默认不勾；勾了只建 passive 不采集 */}
                {(audit.toCreateMedia || []).length > 0 && (
                  <div style={{ marginTop: 10, borderTop: '1px dashed var(--line14)', paddingTop: 8 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--faint)', cursor: 'pointer', userSelect: 'none' }} onClick={() => setMediaOpen(o => !o)}>
                      {mediaOpen ? '▾' : '▸'} 大众媒体/名人 {audit.toCreateMedia.length} 个（默认不采集——X 关注≠信源，勾了只登记不进 X 采集）
                    </div>
                    {mediaOpen && <div style={{ opacity: 0.7, marginTop: 4 }}>{audit.toCreateMedia.map(c => (
                      <label key={c.handle} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0', fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={mediaSel.has(c.handle)} onChange={() => setMediaSel(s => { const n = new Set(s); n.has(c.handle) ? n.delete(c.handle) : n.add(c.handle); return n })} />
                        {c.name}<span style={{ color: 'var(--faint)' }}>@{c.handle}</span>
                      </label>
                    ))}</div>}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 12, borderTop: '1px solid var(--line08)', marginTop: 8 }}>
                <span style={{ fontSize: 11.5, color: rosterCount > audit.rosterCap ? 'var(--red)' : 'var(--faint)' }}>
                  X 采集名单 已选 <b>{rosterCount}/{audit.rosterCap}</b>{rosterCount > audit.rosterCap ? ` · 超 ${rosterCount - audit.rosterCap} 个，去掉几个冷门再确认` : ''}
                </span>
                <button className="wb-btn-primary" style={{ marginLeft: 'auto' }} disabled={auditBusy} onClick={applyAudit}>{auditBusy ? '应用中…' : `确认关注（保留 ${keep.size} + 新建 ${rosterSel.size + mediaSel.size}）`}</button>
              </div>
            </>)}
          </div>
        </div>
      )}
    </>
  )
}
