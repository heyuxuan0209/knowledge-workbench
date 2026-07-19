import { useState, useRef, useEffect } from 'react'
import { IconWarn, IconBolt } from './Icons'
import { api } from './util'

// 创作台（视觉对齐原型 06-studio）：平台模板分段 + 衬线草稿区 + 溯源警示 + 复制/导出。
// 平台列表动态化（P1）：来自 /api/studio/platforms（reference/prompts/creation/platforms/
// 目录扫描）——加一个 md 文件，这里自动多一个按钮。
// P2 修改工具包（设计红线：AI 产出先以建议形态出现，用户点了才写入草稿）：
// - 审稿：三个批评人格通读全稿 → 批注列表，每条可「按此修改」
// - 3 个改法：草稿区选中一段 → 三个策略不同的候选卡，挑一个原位替换

export default function StudioView({ studio, setStudio, platforms, genDraft, exportMd, setPage, showToast, drafts, saveDraft, openDraft, humanizeDraft, undoRewrite, deleteCurrentDraft, suggestTitles, gotoTopic }) {
  const platformIcon = (key) => platforms.find(p => p.key === key)?.icon || '📝'

  // ── ADR-026 试新版：文体(genre) × 平台形态(platform-form)，与老平台行完全并存 ──
  const [v2Mode, setV2Mode] = useState(false)
  const [genres, setGenres] = useState([])
  const [pforms, setPforms] = useState([])
  const [v2Genre, setV2Genre] = useState('读书精读体')   // 默认=推荐
  const [v2Pform, setV2Pform] = useState('gzh-long')
  const [openDD, setOpenDD] = useState(null)            // 'genre' | 'platform' | null
  const [combosOpen, setCombosOpen] = useState(false)
  const gLabel = k => genres.find(g => g.key === k)?.label || k
  const pLabel = k => pforms.find(p => p.key === k)?.label || k
  useEffect(() => {
    if (!v2Mode || genres.length) return
    ;(async () => {
      try {
        const [g, p] = await Promise.all([api('/api/studio/genres'), api('/api/studio/platform-forms')])
        setGenres(g.data || []); setPforms(p.data || [])
      } catch (err) { showToast('文体/平台形态加载失败：' + err.message) }
    })()
  }, [v2Mode])
  // 阶段1·B：从整个素材库挑（不必先有主题），默认不选，可搜；生成只用勾中的
  const [mats, setMats] = useState([])
  const [selMat, setSelMat] = useState(new Set())
  const [matQ, setMatQ] = useState('')
  useEffect(() => {
    if (!v2Mode) return
    ;(async () => {
      try { const j = await api('/api/materials'); setMats(j.data || []) } catch { /* 静默 */ }
    })()
  }, [v2Mode])
  const toggleMat = id => setSelMat(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const matsShown = matQ.trim()
    ? mats.filter(m => (`${m.sourceTitle} ${m.excerpt}`).toLowerCase().includes(matQ.trim().toLowerCase()))
    : mats
  const genDraftV2 = async () => {
    if (!v2Genre || !v2Pform) { showToast('先选文体和平台形态'); return }
    if (selMat.size === 0) { showToast('先从素材库勾选至少 1 条素材'); return }
    setStudio(s => ({ ...s, busy: true, draft: s.draft || '正在按 文体×平台 起稿（约 30 秒）…' }))
    try {
      const json = await api('/api/materials/draft-v2', { method: 'POST', body: { genre: v2Genre, platformForm: v2Pform, viewpoint: studio.viewpoint || null, selectedNoteIds: [...selMat] } })
      const d = json.data
      setStudio(s => ({
        ...s, busy: false, draft: d.body, title: d.title, draftId: d.id, platform: d.platform,
        paragraphRefs: d.paragraph_refs,
        refs: (d.paragraph_refs || []).map(r => ({ note: r.sourceTitle || '素材', para: r.marker })),
      }))
      const gl = genres.find(g => g.key === v2Genre)?.label, pl = pforms.find(p => p.key === v2Pform)?.label
      showToast(`已按「${gl}×${pl}」起稿（引用 ${d.paragraph_refs?.length || 0} 条，¥${d.cost_yuan?.toFixed(3)}）`)
    } catch (err) {
      setStudio(s => ({ ...s, busy: false }))
      showToast(`起稿失败：${err.message}`)
    }
  }

  // ---- P2：批评人格审稿 ----
  const [critique, setCritique] = useState(null) // {verdict, points:[{persona,quote,problem,suggestion}]}
  const [critiqueBusy, setCritiqueBusy] = useState(false)
  const [applyingIdx, setApplyingIdx] = useState(null)
  const critiqueDraft = async () => {
    if (!studio.draft.trim()) { showToast('草稿为空'); return }
    setCritiqueBusy(true)
    showToast('三位审稿人正在通读草稿（约 30 秒）…')
    try {
      const json = await api('/api/studio/critique', { method: 'POST', body: { draft: studio.draft, platform: studio.platform } })
      setCritique(json.data)
      showToast(json.data.points.length ? `收到 ${json.data.points.length} 条批注（¥${json.data.cost?.toFixed(3)}）` : '审稿人没挑出问题')
    } catch (err) { showToast(`审稿失败：${err.message}`) }
    setCritiqueBusy(false)
  }
  // 应用批注 = 记录该次改写的前后快照，撤销按钮跟在条目后面（2026-07-16 反馈：
  // 连续应用多条后，全局撤销分不清撤的是哪次）。全局「撤销改写」只管整稿类操作
  const applyCritique = async (point, idx) => {
    setApplyingIdx(idx)
    try {
      const before = studio.draft
      const json = await api('/api/studio/rewrite', {
        method: 'POST',
        body: { draft: before, instruction: `${point.problem}——${point.suggestion}`, platform: studio.platform },
      })
      setStudio(s => ({ ...s, draft: json.data.draft }))
      setCritique(c => c && { ...c, points: c.points.map((p, i) => i === idx ? { ...p, applied: { before, after: json.data.draft } } : p) })
      showToast('已按批注改写，该条后面可「撤销」')
    } catch (err) { showToast(`改写失败：${err.message}`) }
    setApplyingIdx(null)
  }
  const undoCritique = (point, idx) => {
    if (studio.draft !== point.applied.after &&
      !confirm('这次改写之后草稿又有过修改，撤销会回到这次改写前的版本、丢掉之后的修改。继续？')) return
    setStudio(s => ({ ...s, draft: point.applied.before }))
    setCritique(c => c && { ...c, points: c.points.map((p, i) => i === idx ? { ...p, applied: null } : p) })
    showToast('已撤销该条改写')
  }

  // ---- P2：选段 3 个改法 ----
  // 选区在点按钮那一刻直接从 textarea DOM 读（失焦后 selectionStart/End 仍保留）——
  // 比 onSelect 事件跟踪可靠：键盘选择/程序化选区不会丢
  const draftRef = useRef(null)
  const [variants, setVariants] = useState(null) // {start, end, text, options:[]}
  const [variantsBusy, setVariantsBusy] = useState(false)
  const VARIANT_TAGS = ['🔪 更锋利', '🎯 更具体', '✂️ 更简洁']
  const makeVariants = async () => {
    const start = draftRef.current?.selectionStart ?? 0
    const end = draftRef.current?.selectionEnd ?? 0
    const text = studio.draft.slice(start, end)
    if (text.trim().length < 10) { showToast('先在草稿里选中一段（≥10 字），再点「3 个改法」'); return }
    setVariantsBusy(true)
    showToast('正在生成 3 个改法（约 20 秒）…')
    try {
      const json = await api('/api/studio/variants', { method: 'POST', body: { draft: studio.draft, selection: text, platform: studio.platform } })
      setVariants({ start, end, text, options: json.data.variants })
    } catch (err) { showToast(`生成失败：${err.message}`) }
    setVariantsBusy(false)
  }
  const applyVariant = (opt, idx) => {
    const before = studio.draft
    const after = before.slice(0, variants.start) + opt + before.slice(variants.end)
    setStudio(s => ({ ...s, draft: after }))
    setVariants(v => ({ ...v, applied: { idx, before, after } }))
    showToast('已替换选段，该改法后面可「撤销」')
  }
  const undoVariant = () => {
    if (studio.draft !== variants.applied.after &&
      !confirm('替换之后草稿又有过修改，撤销会回到替换前的版本、丢掉之后的修改。继续？')) return
    setStudio(s => ({ ...s, draft: variants.applied.before }))
    setVariants(v => ({ ...v, applied: null })) // 撤销后三个候选恢复可选
    showToast('已撤销替换')
  }
  // ---- 「⋯ 更多」下拉（按钮墙降级：主操作+3打磨键留在外面，低频项收进来）----
  const [moreOpen, setMoreOpen] = useState(false)
  // ---- 卡片图 tab（小红书专属）：iframe 嵌入卡片工作台，切过去自动灌入当前草稿 ----
  const [xhsMode, setXhsMode] = useState('text')  // 'text' 文案 | 'cards' 卡片图
  const cardFrame = useRef(null)
  const cardsMode = studio.platform === 'xhs' && xhsMode === 'cards'
  const postDraftToCards = () => {
    try { cardFrame.current?.contentWindow?.postMessage({ type: 'kw-fill-cards', text: studio.draft }, '*') } catch { /* 跨窗口受限时忽略 */ }
  }

  const setPlatform = (p) => {
    setXhsMode('text')
    setStudio(s => ({ ...s, platform: p }))
    setTimeout(() => genDraft(p), 0)
  }

  const copyAll = async () => {
    try { await navigator.clipboard.writeText(studio.draft) } catch { /* 剪贴板受限时忽略 */ }
    showToast('已复制全文')
  }

  // 溯源检查：草稿有内容但没有任何 [素材N]/引用标记时提示
  const noRefs = studio.draft.trim() && !/\[素材|—— 引自/.test(studio.draft)
  // 冷启动态：还没有草稿 → 出三步向导 + 一个明确的「生成初稿」，而不是空框+按钮墙
  const isEmpty = !studio.draft.trim()
  const selPlatform = platforms.find(p => p.key === studio.platform)

  return (
    <>
      <button className="wb-back" onClick={() => setPage('topics')}>← 返回主题库</button>
      <div className="wb-topic-head" style={{ marginTop: 6 }}>
        <span className="wb-topic-name">创作台</span>
        <span style={{ fontSize: 12, color: 'var(--sub2)' }}>来源</span>
        <span className="wb-studio-src" style={studio.sourceTopicId ? { cursor: 'pointer', textDecoration: 'underline dotted' } : undefined}
          title={studio.sourceTopicId ? '打开来源主题页' : undefined}
          onClick={() => studio.sourceTopicId && gotoTopic(studio.sourceTopicId)}>
          {studio.source || '手选素材（右侧插入）'}
        </span>
        {drafts?.length > 0 && (
          <select
            style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 8px', border: '1px solid var(--line08)', borderRadius: 8, background: 'var(--surface)', color: 'var(--body2)', maxWidth: 220 }}
            value={studio.draftId || ''}
            onChange={(e) => { const d = drafts.find(x => x.id === e.target.value); if (d) openDraft(d) }}>
            <option value="">草稿箱（{drafts.length}）…</option>
            {drafts.map(d => (
              <option key={d.id} value={d.id}>
                {(d.title || d.body.slice(0, 24)).slice(0, 26)} · {(d.updated_at || '').slice(5, 10)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="wb-page-sub">同一素材集，按平台分化模板 · 每段可溯源到素材卡片</div>

      {/* ADR-026 试新版：文体 × 平台形态（并行，不影响下面的老平台行；关掉即恢复原样） */}
      <div style={{ margin: '10px 0 0' }}>
        <button className={v2Mode ? 'wb-btn-primary' : 'wb-btn-outline'}
          style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
          onClick={() => setV2Mode(v => !v)}>
          <IconBolt />试新版（文体 × 平台形态）
        </button>
      </div>
      {v2Mode && (
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '236px 1fr', border: '1px solid var(--line10)', borderRadius: 12, margin: '10px 0', background: 'var(--surface)', minHeight: 300 }}>
          {/* 左：素材台（贯穿到底 + 改稿说明） */}
          <aside style={{ borderRight: '1px solid var(--line08)', padding: 14, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 12, color: 'var(--sub2)', fontWeight: 600, marginBottom: 3 }}>素材（已选 {selMat.size}）</div>
            <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 8 }}>从素材库挑，生成只用勾中的</div>
            <input value={matQ} onChange={e => setMatQ(e.target.value)} placeholder="搜索素材…"
              style={{ width: '100%', marginBottom: 8, padding: '6px 10px', fontSize: 12.5, border: '1px solid var(--line10)', borderRadius: 6, background: 'var(--surface)', color: 'var(--body)' }} />
            <div style={{ flex: 1, minHeight: 120, maxHeight: 360, overflowY: 'auto', border: '1px solid var(--line10)', borderRadius: 6, padding: '4px 8px' }}>
              {matsShown.length === 0 && <div style={{ fontSize: 12, color: 'var(--faint)', padding: '8px 2px' }}>{mats.length ? '没有匹配的素材' : '素材库为空 / 加载中…'}</div>}
              {matsShown.map(m => (
                <label key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', fontSize: 12.5, cursor: 'pointer', borderBottom: '1px solid var(--line08)' }}>
                  <input type="checkbox" checked={selMat.has(m.id)} onChange={() => toggleMat(m.id)} style={{ marginTop: 3 }} />
                  <span><b style={{ color: 'var(--body)' }}>{m.sourceTitle}</b>{m.excerpt ? <span style={{ color: 'var(--faint)' }}> · {m.excerpt}</span> : null}</span>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line08)', fontSize: 11, color: 'var(--sub2)', lineHeight: 1.55 }}>
              <b style={{ color: 'var(--sub)' }}>右侧「创作助手」= 改稿</b><br />起稿在中间；某段不满意，选中它用底部「审稿 / 改一段」调。
            </div>
          </aside>

          {/* 右：推荐卡 + 换文体/换平台/更多组合 */}
          <section style={{ padding: 14 }}>
            <div style={{ fontSize: 12.5, color: 'var(--sub2)', marginBottom: 9 }}>
              {selMat.size > 0 ? `基于你选的 ${selMat.size} 条素材，建议：` : '勾选左侧素材后，按下面的组合生成：'}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1.9, border: '1px solid rgba(61,90,128,.35)', borderRadius: 11, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 10.5, color: 'var(--accent)', background: 'rgba(61,90,128,.09)', borderRadius: 5, padding: '2px 7px' }}>推荐</span>
                  <h3 style={{ fontFamily: 'var(--serif)', fontSize: 15.5, fontWeight: 600, margin: 0, color: 'var(--text)' }}>{gLabel(v2Genre)} · {pLabel(v2Pform)}</h3>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--sub)', lineHeight: 1.55 }}>用「{gLabel(v2Genre)}」的骨架 +「{pLabel(v2Pform)}」的形态起稿；想换见下面「换文体 / 换平台」。</p>
                <button className="wb-btn-primary" disabled={studio.busy || selMat.size === 0} onClick={genDraftV2}>用这个生成</button>
              </div>
              <div style={{ flex: 1, border: '1px solid var(--line10)', borderRadius: 11, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 10.5, color: 'var(--sub2)', background: 'var(--line07)', borderRadius: 5, padding: '2px 7px' }}>备选</span>
                  <h3 style={{ fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--text)' }}>读书精读体 · 小红书卡片</h3>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--sub)', lineHeight: 1.55 }}>拆成收藏卡，接图卡工具。</p>
                <button className="wb-btn-ghost" onClick={() => { setV2Genre('读书精读体'); setV2Pform('xhs-card') }}>选它</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 12.5, color: 'var(--sub)' }}>
              <div style={{ position: 'relative' }}>
                <span style={{ cursor: 'pointer' }} onClick={() => { setCombosOpen(false); setOpenDD(openDD === 'genre' ? null : 'genre') }}>换文体 ▾</span>
                {openDD === 'genre' && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 20, background: 'var(--surface)', border: '1px solid var(--line10)', borderRadius: 10, boxShadow: '0 8px 24px rgba(33,31,26,.14)', padding: 5, minWidth: 180 }}>
                    {genres.map(g => (
                      <div key={g.key} onClick={() => { setV2Genre(g.key); setOpenDD(null) }}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7, fontSize: 13, cursor: 'pointer', color: v2Genre === g.key ? 'var(--accent)' : 'var(--body)', background: v2Genre === g.key ? 'rgba(61,90,128,.07)' : 'transparent' }}>
                        {g.label}{g.key === '读书精读体' && <span style={{ fontSize: 10, color: 'var(--accent)', background: 'rgba(61,90,128,.11)', borderRadius: 4, padding: '1px 6px' }}>推荐</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <span style={{ cursor: 'pointer' }} onClick={() => { setCombosOpen(false); setOpenDD(openDD === 'platform' ? null : 'platform') }}>换平台 ▾</span>
                {openDD === 'platform' && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 20, background: 'var(--surface)', border: '1px solid var(--line10)', borderRadius: 10, boxShadow: '0 8px 24px rgba(33,31,26,.14)', padding: 5, minWidth: 170, maxHeight: 260, overflowY: 'auto' }}>
                    {pforms.map(p => (
                      <div key={p.key} onClick={() => { setV2Pform(p.key); setOpenDD(null) }}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7, fontSize: 13, cursor: 'pointer', color: v2Pform === p.key ? 'var(--accent)' : 'var(--body)', background: v2Pform === p.key ? 'rgba(61,90,128,.07)' : 'transparent' }}>
                        {p.label}{p.key === 'gzh-long' && <span style={{ fontSize: 10, color: 'var(--accent)', background: 'rgba(61,90,128,.11)', borderRadius: 4, padding: '1px 6px' }}>推荐</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <span style={{ cursor: 'pointer' }} onClick={() => { setOpenDD(null); setCombosOpen(o => !o) }}>更多组合 ▾</span>
            </div>

            {combosOpen && (
              <div style={{ marginTop: 12, border: '1px solid var(--line10)', borderRadius: 11, padding: 13, background: 'var(--brief-bg)' }}>
                <div style={{ fontSize: 11, color: 'var(--sub2)', marginBottom: 7 }}>文体</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
                  {genres.map(g => (
                    <span key={g.key} onClick={() => setV2Genre(g.key)}
                      style={{ border: '1px solid var(--line10)', background: v2Genre === g.key ? 'var(--accent)' : 'var(--surface)', color: v2Genre === g.key ? '#fff' : 'var(--body)', borderRadius: 16, padding: '5px 11px', fontSize: 12.5, cursor: 'pointer' }}>{g.label}</span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--sub2)', marginBottom: 7 }}>平台形态</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {pforms.map(p => (
                    <span key={p.key} onClick={() => setV2Pform(p.key)}
                      style={{ border: '1px solid var(--line10)', background: v2Pform === p.key ? 'var(--accent)' : 'var(--surface)', color: v2Pform === p.key ? '#fff' : 'var(--body)', borderRadius: 16, padding: '5px 11px', fontSize: 12.5, cursor: 'pointer' }}>{p.label}</span>
                  ))}
                </div>
              </div>
            )}
          </section>

          {openDD && <div onClick={() => setOpenDD(null)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />}
        </div>
      )}

      {!v2Mode && (<>
        <div className="wb-seg">
          {platforms.map(p => (
            <button key={p.key} className={`wb-seg-btn${studio.platform === p.key ? ' active' : ''}`}
              title={p.when || p.note}
              onClick={() => setPlatform(p.key)}>{p.label}</button>
          ))}
        </div>

        {(() => {
          const sel = platforms.find(p => p.key === studio.platform)
          return sel?.when ? (
            <div style={{ fontSize: 12, color: 'var(--sub2)', margin: '8px 0 0', lineHeight: 1.5 }}>
              <span style={{ opacity: 0.7 }}>何时用 · </span>{sel.when}
            </div>
          ) : null
        })()}
      </>)}

      {studio.platform === 'xhs' && (
        <div style={{ display: 'flex', gap: 6, margin: '12px 0 0', alignItems: 'center', flexWrap: 'wrap' }}>
          {[['text', '文案'], ['cards', '卡片图']].map(([m, label]) => (
            <button key={m} className={xhsMode === m ? 'wb-btn-primary' : 'wb-btn-outline'}
              onClick={() => { setXhsMode(m); if (m === 'cards') setTimeout(postDraftToCards, 80) }}>{label}</button>
          ))}
          {cardsMode && <span style={{ fontSize: 12, color: 'var(--sub2)' }}>已填入当前文案 · 切风格/比例、点着改字、下载图</span>}
        </div>
      )}

      {!cardsMode && (<>
      {studio.sourceTopicId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 0' }}>
          <span style={{ fontSize: 12, color: 'var(--sub2)', flex: 'none' }}>你的观点</span>
          <input
            value={studio.viewpoint}
            onChange={(e) => setStudio(s => ({ ...s, viewpoint: e.target.value }))}
            placeholder="这篇你想说什么？一句话立场（如「同化式采纳被高估了」）· 留空则 AI 提议判断并明确标注"
            style={{ flex: 1, fontSize: 12.5, padding: '7px 10px', border: '1px solid var(--line08)', borderRadius: 8, background: 'var(--surface)' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && studio.viewpoint.trim()) { showToast('立场已记下，生成时按它起稿'); } }}
          />
        </div>
      )}

      {isEmpty && !v2Mode && (
        <div className="wb-guide">
          <div className="wb-guide-steps">
            <span className="wb-guide-step on"><span className="n">1</span>起稿<span className="cap">你在这</span></span>
            <span className="wb-guide-arrow">→</span>
            <span className="wb-guide-step"><span className="n">2</span>打磨<span className="cap">润色·审稿·改一段</span></span>
            <span className="wb-guide-arrow">→</span>
            <span className="wb-guide-step"><span className="n">3</span>产出<span className="cap">复制·导出</span></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <button className="wb-btn-primary" disabled={studio.busy} onClick={() => genDraft()}
              style={{ fontSize: 15, padding: '12px 26px' }}>
              {studio.busy ? '生成中…' : `生成${selPlatform?.label || ''}初稿`}
            </button>
            <span style={{ fontSize: 12.5, color: 'var(--sub2)' }}>或直接在下面空白处自己写</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 10 }}>
            素材已就位（{studio.source || '手选素材'}）· 生成后第 2、3 步自动亮起
          </div>
        </div>
      )}

      <textarea
        ref={draftRef}
        className="wb-draft" value={studio.draft}
        onChange={(e) => setStudio(s => ({ ...s, draft: e.target.value }))}
        placeholder="点上方「生成初稿」，或直接在这里手写；从右侧可插入素材…"
      />

      {noRefs && (
        <div className="wb-warnbar" style={{ marginTop: 10 }}>
          <IconWarn />草稿中没有素材引用，创作前请在右侧补充引用（每段可溯源）
        </div>
      )}

      {(!isEmpty || v2Mode) && (<>
      {/* 方案2b：左侧次级（改/存）+ 右侧 context-aware 主行动（文字→复制全文 / 卡片→生成图文卡片）；无 emoji。试新版下常驻，空稿时打磨/产出键置灰 */}
      <div className="wb-studio-actions">
        <button className="wb-btn-outline" disabled={studio.busy} title="用同样的素材·文体·平台再出一版"
          onClick={() => v2Mode ? genDraftV2() : genDraft()}>{isEmpty ? '生成' : '重新生成'}</button>
        <button className="wb-btn-outline" disabled={studio.busy || isEmpty} title="整篇改得更顺更好读：换掉 AI 高频词 / 拆套路句式 / 加入第一人称判断"
          onClick={humanizeDraft}>润色</button>
        <button className="wb-btn-outline" disabled={critiqueBusy || studio.busy || isEmpty}
          title="三个批评视角通读全稿，给出批注——只批注不改稿"
          onClick={critiqueDraft}>{critiqueBusy ? '审稿中…' : '审稿'}</button>
        <button className="wb-btn-outline" disabled={variantsBusy || studio.busy || isEmpty}
          title="选中一段，给 3 个策略不同的改法"
          onClick={makeVariants}>{variantsBusy ? '生成中…' : '改一段'}</button>
        {studio.prevDraft && (
          <button className="wb-btn-ghost" title="改写前后两版互换" onClick={undoRewrite}>撤销改写</button>
        )}
        <span className="wb-studio-sep" />
        <button className="wb-btn-ghost" disabled={isEmpty} onClick={saveDraft}>{studio.draftId ? '保存修改' : '存草稿'}</button>
        <div className="wb-more-wrap">
          <button className="wb-btn-ghost" onClick={() => setMoreOpen(o => !o)}>更多</button>
          {moreOpen && (<>
            <div className="wb-more-backdrop" onClick={() => setMoreOpen(false)} />
            <div className="wb-more-menu">
              <button className="wb-more-item" title="导出发布版：溯源标记转文末来源列表"
                onClick={() => { setMoreOpen(false); exportMd() }}>导出 Markdown</button>
              {(v2Mode ? (v2Pform === 'gzh-long' || v2Pform === 'xhs-long') : studio.platform === 'long') && (
                <button className="wb-more-item" onClick={() => { setMoreOpen(false); suggestTitles() }}>标题候选</button>
              )}
              {studio.draftId && (
                <button className="wb-more-item danger" onClick={() => { setMoreOpen(false); deleteCurrentDraft() }}>删除草稿</button>
              )}
            </div>
          </>)}
        </div>
        <span style={{ marginLeft: 'auto' }} />
        {(v2Mode ? (v2Pform || '').includes('card') : studio.platform === 'xhs') ? (
          <button className="wb-btn-primary" disabled={isEmpty} title="把卡片文字渲染成图（复用图卡工具）"
            onClick={() => { if (studio.platform === 'xhs') { setXhsMode('cards'); setTimeout(postDraftToCards, 80) } else { showToast('图卡工具接入中（阶段4）') } }}>生成图文卡片</button>
        ) : (
          <button className="wb-btn-primary" disabled={isEmpty} onClick={copyAll}>复制全文</button>
        )}
      </div>
      <div className="wb-studio-hint">想让 AI 按你的意思改，用右侧「创作助手」：例如「开头更犀利」「压到 5 条」「加一个反方观点」。</div>
      </>)}
      </>)}

      {cardsMode && (
        <iframe ref={cardFrame} src="/xhs-card-studio.html" title="卡片图工作台"
          onLoad={postDraftToCards}
          style={{ width: '100%', height: '80vh', border: '1px solid var(--line08)', borderRadius: 10, marginTop: 8, background: '#2b2a27' }} />
      )}

      {critique && (
        <div className="wb-card" style={{ marginTop: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="wb-card-label" style={{ flex: 'none' }}>审稿批注（{critique.points.length}）</span>
            <span style={{ fontSize: 12.5, color: 'var(--sub2)', flex: 1 }}>{critique.verdict}</span>
            <button className="wb-note-del" style={{ flex: 'none' }} title="关闭批注" onClick={() => setCritique(null)}>✕</button>
          </div>
          {critique.points.length === 0 && (
            <div style={{ fontSize: 13, marginTop: 8, color: 'var(--body2)' }}>三位审稿人都没挑出值得改的问题。</div>
          )}
          {critique.points.map((p, i) => (
            <div key={i} style={{ borderTop: '1px solid var(--line08)', padding: '10px 0 8px', fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="wb-pill" style={{ color: '#3d5a80', background: 'rgba(61,90,128,.12)', flex: 'none' }}>{p.persona}</span>
                <span style={{ color: 'var(--sub2)', fontSize: 12 }}>引「{p.quote}」</span>
              </div>
              <div style={{ margin: '6px 0 4px', color: 'var(--body2)' }}>{p.problem}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ color: 'var(--sub2)', fontSize: 12.5, flex: 1 }}>建议：{p.suggestion}</span>
                {p.applied ? (
                  <>
                    <span className="wb-pill" style={{ color: '#3f7350', background: 'rgba(63,115,80,.12)', flex: 'none' }}>✅ 已应用</span>
                    <button className="wb-btn-ghost" style={{ flex: 'none' }} title="回到这条改写之前的版本"
                      onClick={() => undoCritique(p, i)}>撤销</button>
                  </>
                ) : (
                  <button className="wb-btn-ghost" style={{ flex: 'none' }} disabled={applyingIdx !== null}
                    onClick={() => applyCritique(p, i)}>{applyingIdx === i ? '改写中…' : '按此修改'}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {variants && (
        <div className="wb-card" style={{ marginTop: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="wb-card-label" style={{ flex: 'none' }}>✨ 选段改法</span>
            <span style={{ fontSize: 12, color: 'var(--sub2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              原文：「{variants.text.slice(0, 40)}{variants.text.length > 40 ? '…' : ''}」
            </span>
            <button className="wb-note-del" style={{ flex: 'none' }} title="全部放弃" onClick={() => setVariants(null)}>✕</button>
          </div>
          {variants.options.map((opt, i) => (
            <div key={i} style={{ borderTop: '1px solid var(--line08)', padding: '10px 0 8px', fontSize: 13, opacity: variants.applied && variants.applied.idx !== i ? 0.5 : 1 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span className="wb-pill" style={{ color: '#3f7350', background: 'rgba(63,115,80,.12)', flex: 'none' }}>{VARIANT_TAGS[i] || `改法${i + 1}`}</span>
                {variants.applied?.idx === i ? (
                  <>
                    <span className="wb-pill" style={{ marginLeft: 'auto', color: '#3f7350', background: 'rgba(63,115,80,.12)', flex: 'none' }}>✅ 已替换</span>
                    <button className="wb-btn-ghost" style={{ flex: 'none' }} title="撤销这次替换，三个候选恢复可选"
                      onClick={undoVariant}>撤销</button>
                  </>
                ) : !variants.applied && (
                  <button className="wb-btn-ghost" style={{ marginLeft: 'auto', flex: 'none' }} onClick={() => applyVariant(opt, i)}>用这个替换</button>
                )}
              </div>
              <div style={{ marginTop: 6, color: 'var(--body2)', whiteSpace: 'pre-wrap' }}>{opt}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
