import { useState, useRef } from 'react'
import { IconWarn } from './Icons'
import { api } from './util'

// 创作台（视觉对齐原型 06-studio）：平台模板分段 + 衬线草稿区 + 溯源警示 + 复制/导出。
// 平台列表动态化（P1）：来自 /api/studio/platforms（reference/prompts/creation/platforms/
// 目录扫描）——加一个 md 文件，这里自动多一个按钮。
// P2 修改工具包（设计红线：AI 产出先以建议形态出现，用户点了才写入草稿）：
// - 审稿：三个批评人格通读全稿 → 批注列表，每条可「按此修改」
// - 3 个改法：草稿区选中一段 → 三个策略不同的候选卡，挑一个原位替换

export default function StudioView({ studio, setStudio, platforms, genDraft, exportMd, setPage, showToast, drafts, saveDraft, openDraft, humanizeDraft, undoRewrite, deleteCurrentDraft, suggestTitles, gotoTopic }) {
  const platformIcon = (key) => platforms.find(p => p.key === key)?.icon || '📝'

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
                {platformIcon(d.platform)} {(d.title || d.body.slice(0, 24)).slice(0, 26)} · {(d.updated_at || '').slice(5, 10)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="wb-page-sub">同一素材集，按平台分化模板 · 每段可溯源到素材卡片</div>

      <div className="wb-seg">
        {platforms.map(p => (
          <button key={p.key} className={`wb-seg-btn${studio.platform === p.key ? ' active' : ''}`}
            title={p.when || p.note}
            onClick={() => setPlatform(p.key)}>{p.icon ? `${p.icon} ` : ''}{p.label}</button>
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

      {studio.platform === 'xhs' && (
        <div style={{ display: 'flex', gap: 6, margin: '12px 0 0', alignItems: 'center', flexWrap: 'wrap' }}>
          {[['text', '✍️ 文案'], ['cards', '🖼 卡片图']].map(([m, label]) => (
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
            onKeyDown={(e) => { if (e.key === 'Enter' && studio.viewpoint.trim()) { showToast('立场已记下，点「重新生成」按它起稿'); } }}
          />
        </div>
      )}

      <textarea
        ref={draftRef}
        className="wb-draft" value={studio.draft}
        onChange={(e) => setStudio(s => ({ ...s, draft: e.target.value }))}
        placeholder="点「重新生成」按当前平台模板产出草稿，或从右侧插入素材开始写…"
      />

      {noRefs && (
        <div className="wb-warnbar" style={{ marginTop: 10 }}>
          <IconWarn />草稿中没有素材引用，创作前请在右侧补充引用（每段可溯源）
        </div>
      )}

      <div className="wb-studio-actions">
        <button className="wb-btn-outline" disabled={studio.busy} onClick={() => genDraft()}>
          {studio.busy ? '生成中…' : '重新生成'}
        </button>
        <button className="wb-btn-primary" onClick={saveDraft}>{studio.draftId ? '保存修改' : '保存草稿'}</button>
        <button className="wb-btn-outline" disabled={studio.busy} title="三遍改写让它更好读：换掉 AI 高频词 / 拆套路句式 / 加入第一人称判断"
          onClick={humanizeDraft}>润色</button>
        <button className="wb-btn-outline" disabled={critiqueBusy || studio.busy}
          title="三个批评视角（挑剔读者/结构编辑/事实核查）通读全稿，给出具体批注——只批注不改稿"
          onClick={critiqueDraft}>{critiqueBusy ? '审稿中…' : '审稿'}</button>
        <button className="wb-btn-outline" disabled={variantsBusy || studio.busy}
          title="选中草稿里的一段，给 3 个策略不同的改法（锋利/具体/简洁）供挑选"
          onClick={makeVariants}>{variantsBusy ? '生成中…' : '3 个改法'}</button>
        {studio.prevDraft && (
          <button className="wb-btn-ghost" title="改写前后两版互换" onClick={undoRewrite}>撤销改写</button>
        )}
        {studio.platform === 'long' && (
          <button className="wb-btn-ghost" title="AI 拟 5 个风格错开的标题供挑选" onClick={suggestTitles}>标题候选</button>
        )}
        <button className="wb-btn-ghost" onClick={copyAll}>复制全文</button>
        <button className="wb-btn-ghost" title="导出发布版：溯源标记转文末来源列表" onClick={exportMd}>导出 Markdown</button>
        {studio.draftId && (
          <button className="wb-note-del" style={{ marginLeft: 'auto' }} title="删除这份草稿" onClick={deleteCurrentDraft}>🗑</button>
        )}
      </div>
      <div className="wb-studio-hint">想让 AI 按你的意思改，用右侧「创作助手」：例如「开头更犀利」「压到 5 条」「加一个反方观点」。</div>
      </>)}

      {cardsMode && (
        <iframe ref={cardFrame} src="/xhs-card-studio.html" title="卡片图工作台"
          onLoad={postDraftToCards}
          style={{ width: '100%', height: '80vh', border: '1px solid var(--line08)', borderRadius: 10, marginTop: 8, background: '#2b2a27' }} />
      )}

      {critique && (
        <div className="wb-card" style={{ marginTop: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="wb-card-label" style={{ flex: 'none' }}>🧐 审稿批注（{critique.points.length}）</span>
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
