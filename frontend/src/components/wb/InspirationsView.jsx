import { useState, useMemo } from 'react'
import { timeAgo, api } from './util'
import { IconExternal, IconTrash } from './Icons'
import InstantAnalysisHero from './InstantAnalysisHero'

// 灵感库（ADR-029）：选题种子收集箱，和素材（料）分工——灵感是"要写什么"。
// 两个视图（同一批数据换镜头）：
//   · 收集视图（默认）：你的灵感铺在上面，AI 攒的折叠——符合"攒"的状态。
//   · 写作看板：列由系统按「火候」自动判定（料厚/贴合主题/时效），你只在「可以写了」里挑一条动笔。
// 火候(readiness)由后端算好随 /api/ideas 下发；自动补料让手记灵感不再是孤岛（喂料→火候↑→自动升）。

const SRC_BADGE = {
  ai: { label: 'AI 提议', color: '#7a5cc4', bg: 'rgba(122,92,196,.12)' },
  user: { label: '我记的', color: '#3f7350', bg: 'rgba(63,115,80,.12)' },
  feed: { label: '来自资讯', color: '#b5762a', bg: 'rgba(181,118,42,.13)' },
  feishu: { label: '飞书', color: '#2a6fb5', bg: 'rgba(42,111,181,.13)' },
  external: { label: '外部', color: '#8a8478', bg: 'rgba(33,31,26,.07)' },
}
// 状态用人话（[[ux-no-raw-numbers]]）：adopted 真相是"已养成主题"，created 是"已起稿"。
const STATUS_LABEL = { suggested: '待写', adopted: '已养成主题', created: '已起稿' }

const isMine = (i) => (i.source_kind || 'ai') !== 'ai'
const srcOf = (i) => SRC_BADGE[i.source_kind || 'ai'] || SRC_BADGE.ai
const rd = (i) => i.readiness || {}

// 火候徽标（趁热 / 料够了 / 可能过期）——写作看板与收集视图共用
function HeatBadges({ idea, compact }) {
  const r = rd(idea)
  const out = []
  if (r.timeliness === 'hot') out.push(<span key="hot" className="wb-heat hot">⏰ 趁热</span>)
  if (r.timeliness === 'stale') out.push(<span key="stale" className="wb-heat stale">可能过期</span>)
  if (r.stage === 'ready') {
    out.push(<span key="ready" className="wb-heat ready">🔥 料够了：{r.noteCount} 条素材{r.relatedTopic ? ` + 主题「${r.relatedTopic.name.slice(0, 12)}」` : ''}</span>)
  }
  if (!out.length) return null
  return <div className={`wb-heat-row${compact ? ' compact' : ''}`}>{out}</div>
}

function SupportChips({ idea, gotoNote }) {
  const supports = [
    ...(idea.supporting_notes || []).map(n => ({ ...n, kind: 'note' })),
    ...(idea.supporting_contents || []).map(c => ({ ...c, kind: 'content' })),
  ]
  if (!supports.length) return null
  return (
    <div className="wb-insp-supports">
      <span style={{ color: 'var(--faint)', fontSize: 11.5 }}>🔗 手里的料（{supports.length}）：</span>
      {supports.slice(0, 4).map(s => (
        s.kind === 'note'
          ? <button key={s.id} className="wb-chip" title="去素材库看这条料" onClick={() => gotoNote?.(s.id)}>{(s.title || '素材').slice(0, 18)}</button>
          : <span key={s.id} className="wb-chip">{s.url
              ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{(s.title || '内容').slice(0, 18)} <IconExternal size={9} /></a>
              : (s.title || '内容').slice(0, 18)}</span>
      ))}
    </div>
  )
}

export default function InspirationsView({
  ideas = [], loadIdeas, saveIdea, showToast,
  createFromIdea, upgradeIdea, deleteIdea, viewIdea, gotoNote,
  acquire, uploadFile, returnPage, goBack,
}) {
  const [view, setView] = useState(() => localStorage.getItem('wb-insp-view') || 'collect') // 'collect' | 'board'（默认收集）
  const setViewP = (v) => { localStorage.setItem('wb-insp-view', v); setView(v) }
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [aiOpen, setAiOpen] = useState(false) // 收集视图：AI 攒的默认折叠
  const [linking, setLinking] = useState(null) // 正在补料的 ideaId
  const [editing, setEditing] = useState(null) // {id, val} 正在编辑标题的灵感（Q3）
  const [editingBody, setEditingBody] = useState(null) // {id, val} 正在就地展开写正文（ADR-035 · 2A）

  const live = useMemo(() => ideas.filter(i => i.status !== 'dismissed'), [ideas])
  // "该动手了"优先：可以写了 > 料厚 > 新鲜；已起稿/已养成沉后
  const rank = (a, b) => {
    const w = { ready: 0, writing: 1, seedling: 2, topic: 3 }
    const d = (w[rd(a).stage] ?? 2) - (w[rd(b).stage] ?? 2)
    if (d) return d
    const m = (rd(b).materialCount || 0) - (rd(a).materialCount || 0)
    if (m) return m
    return (b.created_at || '').localeCompare(a.created_at || '')
  }
  const mine = useMemo(() => live.filter(isMine).sort(rank), [live])
  const aiIdeas = useMemo(() => live.filter(i => !isMine(i)).sort(rank), [live])
  const aiStale = aiIdeas.filter(i => rd(i).timeliness === 'stale').length
  const staleCount = live.filter(i => rd(i).stale).length

  // 看板分栏
  const cols = useMemo(() => {
    const g = { seedling: [], ready: [], writing: [], topic: [] }
    for (const i of live) (g[rd(i).stage] || g.seedling).push(i)
    for (const k of Object.keys(g)) g[k].sort(rank)
    return g
  }, [live])
  const hotReady = cols.ready.filter(i => rd(i).timeliness === 'hot').length

  // 1A：粘长文/换行自动长高（上限 180px 内滚动）
  const autoGrow = (el) => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 180) + 'px' }
  const quickSave = async () => {
    const raw = draft.trim()
    if (!raw || saving) return
    setSaving(true)
    // ADR-035 · 1A：首行=标题，其余=正文——粘一大段不再全塞标题、不再静默截断
    const [first, ...rest] = raw.split('\n')
    const title = first.trim() || raw.slice(0, 60)
    const body = rest.join('\n').trim()
    const ok = await saveIdea({ title, body: body || undefined, sourceKind: 'user' })
    if (ok) setDraft('')
    setSaving(false)
  }
  const autolink = async (idea) => {
    setLinking(idea.id)
    try {
      const j = await api(`/api/ideas/${idea.id}/autolink`, { method: 'POST' })
      loadIdeas?.()
      showToast?.(j.added ? `找到 ${j.added} 条相关素材（在卡片里点采纳才算料）` : '素材库里暂时没找到贴合的料，先记素材或换个说法')
    } catch (err) { showToast?.(`补料失败：${err.message}`) }
    setLinking(null)
  }
  // Q4b：采纳一条相关建议为真·料（related → supporting，可能把它升到"可以写了"）
  const adoptNote = async (idea, noteId) => {
    try { await api(`/api/ideas/${idea.id}/adopt-note`, { method: 'POST', body: { noteId } }); loadIdeas?.() }
    catch (err) { showToast?.(`采纳失败：${err.message}`) }
  }
  // Q3：编辑灵感标题（点 ✏️ → 就地编辑，回车/失焦保存，Esc 取消）
  const startEdit = (idea) => setEditing({ id: idea.id, val: idea.title })
  const saveEdit = async () => {
    if (!editing) return
    const t = editing.val.trim()
    const cur = editing
    setEditing(null)
    if (t && t !== ideas.find(i => i.id === cur.id)?.title) {
      try { await api(`/api/ideas/${cur.id}/edit`, { method: 'PATCH', body: { title: t } }); loadIdeas?.() }
      catch (err) { showToast?.(`保存失败：${err.message}`) }
    }
  }
  // ADR-035 · 2A：卡片就地展开写正文——失焦 / ⌘↵ 自动存，Esc 取消。让灵感在卡片里养大，不必跳走。
  const startBodyEdit = (idea) => setEditingBody({ id: idea.id, val: idea.body || '' })
  const saveBodyEdit = async () => {
    if (!editingBody) return
    const cur = editingBody
    setEditingBody(null)
    const val = cur.val.trim()
    const orig = (ideas.find(i => i.id === cur.id)?.body || '').trim()
    if (val !== orig) {
      try { await api(`/api/ideas/${cur.id}/edit`, { method: 'PATCH', body: { body: val } }); loadIdeas?.() }
      catch (err) { showToast?.(`保存失败：${err.message}`) }
    }
  }

  // ---- 单张卡片（collect=完整；board=紧凑，按 stage 变动作） ----
  const card = (idea, { compact = false } = {}) => {
    const src = srcOf(idea)
    const r = rd(idea)
    const hasBody = !!(idea.body && idea.body.trim()) // ADR-035：有你自己的字 → 去创作带稿
    const del = () => { if (confirm('删除这条灵感？')) deleteIdea?.(idea) }
    return (
      <div key={idea.id} className={`wb-insp-card${compact ? ' mini' : ''}${r.stage === 'topic' ? ' done' : ''}`}>
        <div className="wb-insp-top">
          <span className="wb-pill" style={{ color: src.color, background: src.bg }}>{src.label}</span>
          {(idea.status === 'adopted' || idea.status === 'created') &&
            <span className="wb-pill" style={{ color: '#8a8478', background: 'rgba(33,31,26,.06)' }}>{STATUS_LABEL[idea.status]}</span>}
          <span style={{ color: 'var(--faint)', fontSize: 11, marginLeft: 'auto' }}>{timeAgo(idea.created_at)}</span>
        </div>
        {editing?.id === idea.id ? (
          <input className="wb-insp-editinput" autoFocus value={editing.val}
            onChange={(e) => setEditing(s => ({ ...s, val: e.target.value }))}
            onBlur={saveEdit}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveEdit(); if (e.key === 'Escape') setEditing(null) }} />
        ) : (
          <div className="wb-insp-title">
            <span onClick={() => viewIdea?.(idea)} title="看详情">{idea.title}</span>
            <button className="wb-insp-edit" title="编辑标题" onClick={() => startEdit(idea)}>✏️</button>
          </div>
        )}

        {/* ADR-035 · 2A：标题下的正文位——空态虚线占位，有内容显预览，点开就地写 */}
        {!compact && (
          editingBody?.id === idea.id ? (
            <div className="wb-insp-bodyedit">
              <textarea className="wb-insp-bodyinput" autoFocus rows={3} value={editingBody.val}
                placeholder="接着把想法写下来，随时来补，不丢…"
                onChange={(e) => setEditingBody(s => ({ ...s, val: e.target.value }))}
                onBlur={saveBodyEdit}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingBody(null); if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveBodyEdit() } }} />
              <div className="wb-insp-bodyhint">失焦自动保存 · Esc 收起</div>
            </div>
          ) : hasBody ? (
            <div className="wb-insp-bodyprev" title="点开继续写" onClick={() => startBodyEdit(idea)}>
              <div className="txt">{idea.body}</div>
              <div className="wb-insp-bodymore">共 {idea.body.trim().length} 字 · 点开继续写 ▾</div>
            </div>
          ) : (
            <button className="wb-insp-bodyempty" onClick={() => startBodyEdit(idea)}>＋ 展开写…（把这个想法养大）</button>
          )
        )}

        {!compact && idea.angle && <div className="wb-insp-angle">角度：{idea.angle}</div>}
        {!compact && idea.why_now && <div className="wb-insp-why">为什么是现在：{idea.why_now}</div>}

        {/* 攒着栏：说清还差多少料 + ✨补料 */}
        {r.stage === 'seedling' ? (
          <>
            <div className="wb-insp-need">
              {r.noteCount
                ? <>火候：<b>{r.noteCount} 条你的素材</b>，再挂 1 条或贴合主题就能写</>
                : r.contentCount
                  ? <>还差你的料：有 <b>{r.contentCount} 篇参考文章</b>，但缺你自己消化的素材</>
                  : <>还差料：手里 <b>0 条</b>，光一句话不好写</>}
            </div>
            {r.noteCount > 0 && <div className="wb-insp-bar"><i style={{ width: `${Math.min(100, r.noteCount * 50)}%` }} /></div>}
          </>
        ) : <HeatBadges idea={idea} compact={compact} />}

        {!compact && r.stage !== 'seedling' && <SupportChips idea={idea} gotoNote={gotoNote} />}

        {/* Q4b：相关素材是「建议」，点采纳才算料、才影响火候 */}
        {idea.related_notes?.length > 0 && (
          <div className="wb-insp-related">
            <div className="wb-insp-rellab">🔍 相关素材（AI 找的 · 点采纳才算你的料）</div>
            {idea.related_notes.slice(0, 3).map(n => (
              <div key={n.id} className="wb-insp-relrow">
                <span className="nm" title="去素材库看这条" onClick={() => gotoNote?.(n.id)}>{(n.title || '素材').slice(0, 24)}</span>
                <button className="wb-insp-adopt" title="采纳为料——料够了会自动升到「可以写了」" onClick={() => adoptNote(idea, n.id)}>采纳</button>
              </div>
            ))}
          </div>
        )}

        <div className="wb-insp-foot">
          {r.stage === 'seedling' ? (
            <>
              <button className="wb-btn-mini" disabled={linking === idea.id} onClick={() => autolink(idea)}
                title="拿标题去素材库找贴合的料挂上——料够了会自动升到「可以写了」">
                {linking === idea.id ? '找料中…' : '✨ 补料'}
              </button>
              <button className={hasBody ? 'wb-btn-primary' : 'wb-btn-ghost'} style={{ padding: hasBody ? '4px 12px' : 0, fontSize: 12 }}
                title={hasBody ? '带你写的正文进创作台当初稿' : '直接去创作台起稿'} onClick={() => createFromIdea?.(idea)}>{hasBody ? '带稿去创作 →' : '直接写'}</button>
            </>
          ) : r.stage === 'writing' ? (
            <button className="wb-btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => createFromIdea?.(idea)}>{hasBody ? '带稿去创作 →' : '继续写 →'}</button>
          ) : (
            <>
              <button className="wb-btn-primary" style={{ padding: '4px 12px', fontSize: 12 }}
                title={hasBody ? '带你写的正文进创作台当初稿' : '拿这条灵感直接去创作台起稿'} onClick={() => createFromIdea?.(idea)}>{hasBody ? '带稿去创作 →' : '去创作 →'}</button>
              {isMine(idea) && <button className="wb-btn-ghost" style={{ padding: 0, fontSize: 12 }}
                title="值得长期养 → 升级成主题页" onClick={() => upgradeIdea?.(idea)}>养成主题</button>}
            </>
          )}
          <button className="wb-insp-del" title="删除" onClick={del}><IconTrash /></button>
        </div>
      </div>
    )
  }

  return (
    <>
      {returnPage && (
        <button className="wb-back" onClick={goBack} style={{ marginBottom: 10 }}>← 返回{returnPage === 'feed' ? '资讯' : ''}</button>
      )}

      <div className="wb-page-head">
        <h2 className="wb-page-title">灵感库</h2>
        <div className="wb-page-sub">要写什么的种子。素材是「料」、灵感是「要写什么」——刷到能写的、脑里冒出的，先收下来，别忙完就忘。</div>
      </div>

      {/* 视图切换：收集（攒）/ 写作看板（管） */}
      <div className="wb-insp-viewsw">
        <button className={view === 'collect' ? 'on' : ''} onClick={() => setViewP('collect')}>收集视图</button>
        <button className={view === 'board' ? 'on' : ''} onClick={() => setViewP('board')}>写作看板</button>
      </div>

      {/* ========== 收集视图 ========== */}
      {view === 'collect' && (
        <>
          {/* 主动·即时：方案1 双入口（即时分析 消化 / 随手记 闪念） */}
          <div className="wb-insp-layertag">主动 · 即时（你此刻丢一个进来）</div>
          <div className="wb-insp-intake">
            <InstantAnalysisHero acquire={acquire} uploadFile={uploadFile} />
            <div className="wb-insp-lane quick">
              <div className="wb-lane-ttl"><span className="wb-lane-lab quick">闪念</span>随手记</div>
              <div className="wb-lane-cap">脑里冒出的一句话、一个角度 → 直接成一条灵感（存后自动找贴合素材）</div>
              <div className="wb-lane-row">
                <textarea className="wb-quick-ta" value={draft} rows={1}
                  onChange={(e) => { setDraft(e.target.value); autoGrow(e.target) }}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') quickSave() }}
                  placeholder="随手记一句…粘一大段也行，首行当标题、其余当正文" />
                <button className="wb-btn-primary" style={{ padding: '8px 12px', fontSize: 12.5 }}
                  disabled={!draft.trim() || saving} onClick={quickSave}>{saving ? '记下…' : '＋ 记'}</button>
              </div>
              {draft.trim() && (
                <div className="wb-quick-hint">
                  <span>首行 <b>{(draft.split('\n')[0] || '').trim().slice(0, 22) || '…'}</b> → 标题{draft.includes('\n') ? '，其余 → 正文' : ''}</span>
                  <span>{draft.trim().length} 字 · ⌘↵ 保存</span>
                </div>
              )}
            </div>
          </div>

          {/* 被动·持续：飞书收件箱（占位，接入后灌数据） */}
          <div className="wb-insp-layertag">被动 · 持续（系统替你收，你挑）</div>
          <details className="wb-feishu-inbox">
            <summary>
              <span className="fi">飞</span>
              <span className="txt"><b>飞书 · 待整理</b> —— 妙记 / 纪要 / 群聊 / 云文档 里的新内容</span>
              <span className="soon">未接入 ▾</span>
            </summary>
            <div className="wb-feishu-body">
              接入飞书后，新内容会落在这里待你分诊：<b>文档 / 纪要 → 采纳为素材</b>，<b>群聊 / 想法 → 提为灵感</b>，不要的忽略。
              通用接入口 <code>POST /api/ideas/ingest</code> 已就绪；<b>真接需要你的飞书开放平台 App 凭证与授权范围</b>（读云文档/妙记/消息），配好后连接器往这里灌。
            </div>
          </details>

          {staleCount > 0 && (
            <div className="wb-warnbar" style={{ marginBottom: 12 }}>
              有 {staleCount} 条灵感攒了 14 天以上还没动，要么写、要么删
              <button className="wb-brief-link" style={{ marginLeft: 8 }} onClick={() => setViewP('board')}>去看板整理 →</button>
            </div>
          )}

          {live.length === 0 ? (
            <div className="wb-empty">还没有灵感。上面随手记一句，或刷资讯时点 💡 一键收进——想到就存，写的时候不至于空手。</div>
          ) : (
            <>
              <div className="wb-insp-sec">你的灵感 <span className="cnt">{mine.length}</span><span className="line" /></div>
              {mine.length === 0
                ? <div className="wb-empty" style={{ padding: '14px' }}>还没有你自己记的灵感——AI 帮你攒的在下面。</div>
                : <div className="wb-insp-list">{mine.map(i => card(i))}</div>}

              {aiIdeas.length > 0 && (
                <>
                  <div className="wb-insp-fold" onClick={() => setAiOpen(o => !o)}>
                    <b>AI 帮你攒的 {aiIdeas.length} 条选题</b>
                    <span style={{ color: 'var(--sub2)' }}>从你的日报/周报里提炼{aiStale ? ` · 有 ${aiStale} 条可能过期` : ''}</span>
                    <span className="arw">{aiOpen ? '收起 ▴' : '展开看 ▾'}</span>
                  </div>
                  {aiOpen && <div className="wb-insp-list">{aiIdeas.map(i => card(i))}</div>}
                </>
              )}
            </>
          )}
        </>
      )}

      {/* ========== 写作看板 ========== */}
      {view === 'board' && (
        <>
          <div className="wb-quickcap" style={{ marginTop: 4 }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) quickSave() }} placeholder="随手记一句…" />
            <button className="wb-btn-primary" disabled={!draft.trim() || saving} onClick={quickSave}>{saving ? '记下…' : '＋ 记一条'}</button>
          </div>

          <div className="wb-insp-smartbar">
            <span className="ic">🧭</span>
            <span>系统按 <b>料厚 · 时效 · 是否贴合你在养的主题</b> 排了火候：
              有 <b>{cols.ready.length} 条可以写了</b>{hotReady ? `，其中 ${hotReady} 条趁热该先写` : ''}；
              <b>{cols.seedling.length} 条</b>攒着火候还不够{aiStale ? `；${aiStale} 条热点可能过期、可清理` : ''}。</span>
          </div>

          <div className="wb-insp-board">
            <div className="wb-insp-col">
              <div className="wb-insp-colh">🌱 攒着 <span className="cnt">{cols.seedling.length}</span><span className="hint">火候不够 · 差料</span></div>
              {cols.seedling.length ? cols.seedling.map(i => card(i, { compact: true })) : <div className="wb-insp-colempty">这栏空着</div>}
            </div>
            <div className="wb-insp-col ready">
              <div className="wb-insp-colh">🔥 可以写了 <span className="cnt">{cols.ready.length}</span><span className="hint">料够/有立场</span></div>
              {cols.ready.length ? cols.ready.map(i => card(i, { compact: true })) : <div className="wb-insp-colempty">还没有料够的——去「攒着」栏补料</div>}
            </div>
            <div className="wb-insp-col">
              <div className="wb-insp-colh">✍️ 在写 <span className="cnt">{cols.writing.length}</span></div>
              {cols.writing.length ? cols.writing.map(i => card(i, { compact: true })) : <div className="wb-insp-colempty">这栏空着</div>}
            </div>
          </div>

          <div className="wb-insp-donefoot">
            📘 <b>已养成主题 {cols.topic.length}</b>
            <span style={{ marginLeft: 'auto', color: 'var(--faint)', fontSize: 11.5 }}>以后这里接上「发出去 → 数据 → 复盘」，闭成完整环路</span>
          </div>
        </>
      )}

    </>
  )
}
