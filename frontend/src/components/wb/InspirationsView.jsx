import { useState, useMemo } from 'react'
import { timeAgo } from './util'
import { IconBulb, IconExternal, IconTrash } from './Icons'
import InstantAnalysisHero from './InstantAnalysisHero'

// 灵感库（ADR-029，2026-07-20）：选题种子的收集箱，和素材（料）分工——灵感是"要写什么"。
// 三种收录姿势：随手记一句(user) / 从资讯一键收进(feed) / 即时分析提炼(hero) / 飞书等外部连接器(feishu)。
// AI 从周报涌现的选题(ai) 也在这里统一收口。别让灵感沉底（[[state-not-time-for-status]]）：
// "该动手了"优先排序（料够厚+新鲜往上顶）+ 攒太久的种子催办条。

const SRC_BADGE = {
  ai: { label: 'AI 提议', color: '#7a5cc4', bg: 'rgba(122,92,196,.12)' },
  user: { label: '我记的', color: '#3f7350', bg: 'rgba(63,115,80,.12)' },
  feed: { label: '来自资讯', color: '#b5762a', bg: 'rgba(181,118,42,.13)' },
  feishu: { label: '飞书', color: '#2a6fb5', bg: 'rgba(42,111,181,.13)' },
  external: { label: '外部', color: '#8a8478', bg: 'rgba(33,31,26,.07)' },
}
// 状态用人话（[[ux-no-raw-numbers]]）：去掉"种子/采纳"黑话。adopted 的真相是"已养成主题"（由养成主题动作设置），
// created 是"已起稿"（由去创作设置），suggested 就是还没动的"待写"。
const STATUS_LABEL = { suggested: '待写', adopted: '已养成主题', created: '已起稿' }
const STALE_DAYS = 14

const daysSince = (s) => {
  if (!s) return 0
  const t = new Date(`${s.replace(' ', 'T')}Z`).getTime()
  return t ? Math.floor((Date.now() - t) / 86400000) : 0
}

export default function InspirationsView({
  ideas = [], loadIdeas, saveIdea, showToast,
  createFromIdea, upgradeIdea, dismissIdea, deleteIdea, viewIdea, gotoNote, setPage,
  acquire, uploadFile, returnPage, goBack,
}) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all') // all | suggested | adopted | created
  const [srcFilter, setSrcFilter] = useState('all')       // all | ai | user | feed | feishu

  const supportCount = (i) => (i.supporting_notes?.length || 0) + (i.supporting_contents?.length || 0)

  const filtered = useMemo(() => {
    let list = ideas.filter(i => i.status !== 'dismissed')
    if (statusFilter !== 'all') list = list.filter(i => i.status === statusFilter)
    if (srcFilter !== 'all') list = list.filter(i => (i.source_kind || 'ai') === srcFilter)
    // "该动手了"优先：料够厚的往上顶，其次新鲜。已起稿的沉到最后。
    return [...list].sort((a, b) => {
      const done = (a.status === 'created' ? 1 : 0) - (b.status === 'created' ? 1 : 0)
      if (done) return done
      const sc = supportCount(b) - supportCount(a)
      if (sc) return sc
      return (b.created_at || '').localeCompare(a.created_at || '')
    })
  }, [ideas, statusFilter, srcFilter])

  const staleCount = ideas.filter(i => i.status === 'suggested' && daysSince(i.created_at) >= STALE_DAYS).length
  const srcCounts = ideas.reduce((a, i) => { const k = i.source_kind || 'ai'; a[k] = (a[k] || 0) + 1; return a }, {})

  const quickSave = async () => {
    const t = draft.trim()
    if (!t || saving) return
    setSaving(true)
    const ok = await saveIdea({ title: t, sourceKind: 'user' })
    if (ok) setDraft('')
    setSaving(false)
  }

  return (
    <>
      {returnPage && (
        <button className="wb-back" onClick={goBack} style={{ marginBottom: 10 }}>← 返回{returnPage === 'feed' ? '资讯' : ''}</button>
      )}

      <div className="wb-page-head">
        <h2 className="wb-page-title"><IconBulb size={16} /> 灵感库</h2>
        <div className="wb-page-sub">要写什么的种子。素材是「料」，灵感是「要写什么」——刷到能写的、脑里冒出的、群里聊到的，先收下来，别等忙完就忘。</div>
      </div>

      {/* ① 即时分析：丢个东西进来消化（料落素材，可提为灵感） */}
      <InstantAnalysisHero acquire={acquire} uploadFile={uploadFile} />

      {/* ② 随手记一句：最低摩擦的手动入口 */}
      <div className="wb-quickcap">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') quickSave() }}
          placeholder="随手记一句：一个观点、一个角度、一句以后能写的话…"
        />
        <button className="wb-btn-primary" disabled={!draft.trim() || saving} onClick={quickSave}>
          {saving ? '记下…' : '＋ 记一条'}
        </button>
      </div>

      {/* ③ 催办条：攒太久的种子别沉底 */}
      {staleCount > 0 && (
        <div className="wb-warnbar" style={{ marginBottom: 12 }}>
          有 {staleCount} 条灵感攒了 {STALE_DAYS} 天以上还没动
          <button className="wb-brief-link" style={{ marginLeft: 8 }}
            onClick={() => { setStatusFilter('suggested'); setSrcFilter('all') }}>翻出来看看 →</button>
        </div>
      )}

      {/* ④ 筛选：状态 + 来源 */}
      <div className="wb-feedbar" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div className="wb-seg-toggle">
          {['all', 'suggested', 'created', 'adopted'].map(s => (
            <button key={s} className={statusFilter === s ? 'active' : ''} onClick={() => setStatusFilter(s)}>
              {s === 'all' ? '全部' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="wb-seg-toggle">
          <button className={srcFilter === 'all' ? 'active' : ''} onClick={() => setSrcFilter('all')}>全部来源</button>
          {['user', 'ai', 'feed', 'feishu'].filter(k => srcCounts[k]).map(k => (
            <button key={k} className={srcFilter === k ? 'active' : ''} onClick={() => setSrcFilter(k)}>
              {SRC_BADGE[k].label} {srcCounts[k]}
            </button>
          ))}
        </div>
      </div>

      {/* ⑤ 灵感卡列表 */}
      {filtered.length === 0 ? (
        <div className="wb-empty">
          {ideas.length === 0
            ? '还没有灵感。上面随手记一句，或刷资讯时点 💡 一键收进——想到就存，写的时候不至于空手。'
            : '这个筛选下没有灵感。'}
        </div>
      ) : (
        <div className="wb-insp-list">
          {filtered.map(idea => {
            const src = SRC_BADGE[idea.source_kind || 'ai'] || SRC_BADGE.ai
            const supports = [...(idea.supporting_notes || []).map(n => ({ ...n, kind: 'note' })),
              ...(idea.supporting_contents || []).map(c => ({ ...c, kind: 'content' }))]
            const days = daysSince(idea.created_at)
            return (
              <div key={idea.id} className={`wb-insp-card${idea.status === 'created' ? ' done' : ''}`}>
                <div className="wb-insp-top">
                  <span className="wb-pill" style={{ color: src.color, background: src.bg }}>{src.label}</span>
                  {idea.status !== 'suggested' && <span className="wb-pill" style={{ color: '#8a8478', background: 'rgba(33,31,26,.06)' }}>{STATUS_LABEL[idea.status]}</span>}
                  <span style={{ color: 'var(--faint)', fontSize: 11, marginLeft: 'auto' }}>{timeAgo(idea.created_at)}</span>
                </div>

                <div className="wb-insp-title" onClick={() => viewIdea?.(idea)} title="看详情">{idea.title}</div>
                {idea.angle && <div className="wb-insp-angle">角度：{idea.angle}</div>}
                {idea.why_now && <div className="wb-insp-why">为什么是现在：{idea.why_now}</div>}

                {supports.length > 0 && (
                  <div className="wb-insp-supports">
                    <span style={{ color: 'var(--faint)', fontSize: 11.5 }}>🔗 手里的料（{supports.length}）：</span>
                    {supports.slice(0, 4).map(s => (
                      s.kind === 'note'
                        ? <button key={s.id} className="wb-chip" title="去素材库看这条料" onClick={() => gotoNote?.(s.id)}>{(s.title || '素材').slice(0, 20)}</button>
                        : <span key={s.id} className="wb-chip">{s.url
                            ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{(s.title || '内容').slice(0, 20)} <IconExternal size={9} /></a>
                            : (s.title || '内容').slice(0, 20)}</span>
                    ))}
                  </div>
                )}

                <div className="wb-insp-foot">
                  <button className="wb-btn-primary" style={{ padding: '4px 12px', fontSize: 12 }}
                    title="拿这条灵感直接去创作台起稿" onClick={() => createFromIdea?.(idea)}>去创作 →</button>
                  <button className="wb-btn-ghost" style={{ padding: 0, fontSize: 12 }}
                    title="值得长期养 → 升级成主题页，随素材持续维护综述" onClick={() => upgradeIdea?.(idea)}>养成主题</button>
                  <button className="wb-btn-ghost" style={{ padding: 0, fontSize: 12, marginLeft: 'auto', color: 'var(--faint)' }}
                    title="不写了，从灵感库移除" onClick={() => { if (confirm('删除这条灵感？')) deleteIdea?.(idea) }}><IconTrash /></button>
                </div>
                {days >= STALE_DAYS && idea.status === 'suggested' && (
                  <div className="wb-insp-nudge">攒了 {days} 天了 · 要么写、要么删，别让它压着</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ⑥ 飞书 / 外部连接器接入（占位说明——连接器接好后自动往灵感库灌） */}
      <details className="wb-connect-note">
        <summary>接入飞书 / 备忘录 / 微信 等外部灵感源 ▾</summary>
        <div className="wb-connect-body">
          你的很多灵感散在飞书对话、会议纪要、妙记、群聊、云文档、知识库里。灵感库留好了通用接入口
          <code>POST /api/ideas/ingest</code>（source_kind='feishu'，source_ref 存文档/消息回链）——
          任何连接器、快捷指令、甚至一句话跟 agent 说，都能把一条灵感灌进来。
          <b>飞书连接器需要你的飞书开放平台 App 凭证与授权范围</b>（读云文档/妙记/消息），配好后即可定时拉取或事件订阅落库。
        </div>
      </details>
    </>
  )
}
