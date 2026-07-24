import { useState, useEffect } from 'react'
import { api } from './util'

// P2 大扫除面板（HANDOFF §P2）：两块「提议→用户裁决」——
// ① 关联清理：AI 乱挂的弱关联重算后建议移除（每素材 top-3 封顶），归档不删素材；
// ② 主题收编：碎片/泛词/文章名主题建议 解散(归档)/并入/改名。
// 一切默认勾选=接受提议，用户可逐条反选保留；应用后才落库。
export default function CleanupPanel({ onClose, showToast, reload }) {
  const [tab, setTab] = useState('assoc')
  const [assoc, setAssoc] = useState(null)
  const [topics, setTopics] = useState(null)
  const [keep, setKeep] = useState(() => new Set())   // 关联：反选保留的 key（默认全移除）
  const [tstate, setTstate] = useState({})             // 主题：topicId -> {skip, action, targetId, newName}
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('/api/cleanup/associations').then(j => setAssoc(j.data)).catch(e => showToast?.('关联提议加载失败：' + e.message))
    api('/api/cleanup/topics').then(j => {
      setTopics(j.data)
      const init = {}
      for (const p of j.data.proposals) init[p.topicId] = { skip: false, action: p.action === 'dissolve' && p.mergeInto ? 'dissolve' : p.action, targetId: p.mergeInto?.id || '', newName: p.suggestedName || '' }
      setTstate(init)
    }).catch(e => showToast?.('主题提议加载失败：' + e.message))
  }, []) // eslint-disable-line

  const pairKey = (it) => `${it.noteId}|${it.topicId}`
  const toggleKeep = (it) => setKeep(s => { const n = new Set(s); const k = pairKey(it); n.has(k) ? n.delete(k) : n.add(k); return n })

  const applyAssoc = async () => {
    const pairs = (assoc?.groups || []).flatMap(g => g.items).filter(it => !keep.has(pairKey(it))).map(it => ({ noteId: it.noteId, topicId: it.topicId }))
    if (!pairs.length) { showToast?.('没有选中要移除的关联'); return }
    setBusy(true)
    try { const j = await api('/api/cleanup/associations/apply', { method: 'POST', body: { pairs } }); showToast?.(`已移除 ${j.data.removed} 条弱关联`); reload?.(); const r = await api('/api/cleanup/associations'); setAssoc(r.data); setKeep(new Set()) }
    catch (e) { showToast?.('应用失败：' + e.message) }
    setBusy(false)
  }

  const applyTopics = async () => {
    const actions = (topics?.proposals || []).filter(p => !tstate[p.topicId]?.skip).map(p => {
      const s = tstate[p.topicId]
      if (s.action === 'merge' && s.targetId) return { topicId: p.topicId, action: 'merge', targetId: s.targetId }
      if (s.action === 'rename') return { topicId: p.topicId, action: 'rename', newName: (s.newName || '').trim() }
      return { topicId: p.topicId, action: 'dissolve' }
    }).filter(a => a.action !== 'rename' || a.newName)
    if (!actions.length) { showToast?.('没有选中的主题操作'); return }
    setBusy(true)
    try { const j = await api('/api/cleanup/topics/apply', { method: 'POST', body: { actions } }); showToast?.(`已收编 ${j.data.applied} 个主题`); reload?.(); const r = await api('/api/cleanup/topics'); setTopics(r.data); const init = {}; for (const p of r.data.proposals) init[p.topicId] = { skip: false, action: p.action === 'dissolve' && p.mergeInto ? 'dissolve' : p.action, targetId: p.mergeInto?.id || '', newName: p.suggestedName || '' }; setTstate(init) }
    catch (e) { showToast?.('应用失败：' + e.message) }
    setBusy(false)
  }

  const setTS = (id, patch) => setTstate(s => ({ ...s, [id]: { ...s[id], ...patch } }))
  const removeSelectedCount = (assoc?.groups || []).flatMap(g => g.items).filter(it => !keep.has(pairKey(it))).length
  const survivors = (topics?.proposals || []) // 供 merge 下拉：非本条、非 dissolve 的都算候选（简化用 mergeInto 建议）

  return (
    <div className="wb-modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wb-modal" style={{ maxWidth: 720, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="wb-modal-head">
          <div className="wb-modal-title">🧹 素材库大扫除</div>
          <div className="wb-seg-toggle" style={{ marginLeft: 'auto', marginRight: 10 }}>
            <button className={tab === 'assoc' ? 'active' : ''} onClick={() => setTab('assoc')}>关联清理{assoc ? `（${assoc.removeCount}）` : ''}</button>
            <button className={tab === 'topics' ? 'active' : ''} onClick={() => setTab('topics')}>主题收编{topics ? `（${topics.proposals.length}）` : ''}</button>
          </div>
          <button className="wb-modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ overflowY: 'auto', padding: '4px 4px 0' }}>
          {tab === 'assoc' && (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--sub)', lineHeight: 1.6, marginBottom: 10 }}>
                AI 按词面把每条素材平均挂了 6 个主题（大多弱相关）。按语义重算后，建议移除下面这些弱关联——
                <b>每条素材只留最贴的 3 个</b>。<b style={{ color: 'var(--accent)' }}>只解绑关联，不删素材本身</b>；不想移的取消勾选即可。
              </div>
              {!assoc && <div style={{ padding: 20, textAlign: 'center', color: 'var(--sub2)' }}>重算中…（给主题算语义中心 + 逐条比对）</div>}
              {assoc && (
                <div style={{ fontSize: 12, color: 'var(--sub2)', marginBottom: 8 }}>
                  总关联 <b>{assoc.totalBefore}</b> → 建议移除 <b style={{ color: 'var(--red)' }}>{assoc.removeCount}</b> → 留下约 <b>{assoc.totalBefore - removeSelectedCount}</b>
                </div>
              )}
              {(assoc?.groups || []).map(g => (
                <div key={g.topicId} style={{ border: '1px solid var(--line10)', borderRadius: 9, marginBottom: 8, padding: '9px 11px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                    《{g.topicName}》<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--faint)' }}>移除 {g.items.length} 条弱关联</span>
                  </div>
                  {g.items.map(it => {
                    const removing = !keep.has(pairKey(it))
                    return (
                      <label key={pairKey(it)} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 12.5, opacity: removing ? 1 : 0.5, cursor: 'pointer' }}>
                        <input type="checkbox" checked={removing} onChange={() => toggleKeep(it)} />
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.noteTitle}</span>
                        <span className="wb-pill" style={{ fontSize: 10, color: it.reason === 'low' ? '#8a8478' : '#8a6a1a', background: it.reason === 'low' ? 'rgba(33,31,26,.06)' : 'rgba(169,121,31,.12)' }}>
                          {it.reason === 'low' ? `弱相关 ${it.relevance}` : `超出前3（${it.relevance}）`}
                        </span>
                      </label>
                    )
                  })}
                </div>
              ))}
            </>
          )}

          {tab === 'topics' && (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--sub)', lineHeight: 1.6, marginBottom: 10 }}>
                主题太碎（≤2 条）/ 太泛（Agent、Context）/ 名字是文章标题 → 建议收编成有边界的话题。
                <b style={{ color: 'var(--accent)' }}>解散 = 归档可恢复</b>，不删素材。
              </div>
              {!topics && <div style={{ padding: 20, textAlign: 'center', color: 'var(--sub2)' }}>分析中…</div>}
              {topics && <div style={{ fontSize: 12, color: 'var(--sub2)', marginBottom: 8 }}>当前 <b>{topics.before}</b> 个主题 → 收编后约 <b>{topics.before - (topics.proposals || []).filter(p => !tstate[p.topicId]?.skip && (tstate[p.topicId]?.action === 'dissolve' || tstate[p.topicId]?.action === 'merge')).length}</b> 个</div>}
              {(topics?.proposals || []).map(p => {
                const s = tstate[p.topicId] || {}
                return (
                  <div key={p.topicId} style={{ border: '1px solid var(--line10)', borderRadius: 9, marginBottom: 8, padding: '9px 11px', opacity: s.skip ? 0.5 : 1 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                      <input type="checkbox" checked={!s.skip} onChange={() => setTS(p.topicId, { skip: !s.skip })} />
                      <b style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>《{p.name}》</b>
                      <span style={{ fontSize: 11, color: 'var(--faint)', flex: 'none' }}>{p.assoc} 条 · {p.reason}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 7, marginLeft: 24, flexWrap: 'wrap' }}>
                      {p.action === 'dissolve' ? (
                        <>
                          <select className="wb-filter-chip" value={s.action} onChange={e => setTS(p.topicId, { action: e.target.value })}>
                            <option value="dissolve">解散（归档）</option>
                            {p.mergeInto && <option value="merge">并入《{p.mergeInto.name.slice(0, 14)}》（{p.mergeInto.score}）</option>}
                          </select>
                          {s.action === 'merge' && p.mergeInto && <span style={{ fontSize: 11.5, color: 'var(--sub2)' }}>→ 素材迁到《{p.mergeInto.name.slice(0, 16)}》，本主题归档</span>}
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 12, color: 'var(--sub2)' }}>改名为</span>
                          <input value={s.newName || ''} onChange={e => setTS(p.topicId, { newName: e.target.value })} placeholder="话题名"
                            style={{ flex: 1, minWidth: 120, fontSize: 12.5, padding: '5px 9px', border: '1px solid var(--line10)', borderRadius: 6, background: 'var(--surface)', color: 'var(--body)' }} />
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 4px 4px', borderTop: '1px solid var(--line08)', marginTop: 8 }}>
          <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>所有操作可恢复；裁决只应用你选中的</span>
          {tab === 'assoc'
            ? <button className="wb-btn-primary" style={{ marginLeft: 'auto' }} disabled={busy || !assoc || removeSelectedCount === 0} onClick={applyAssoc}>{busy ? '处理中…' : `移除选中的 ${removeSelectedCount} 条关联`}</button>
            : <button className="wb-btn-primary" style={{ marginLeft: 'auto' }} disabled={busy || !topics} onClick={applyTopics}>{busy ? '处理中…' : '应用主题收编'}</button>}
        </div>
      </div>
    </div>
  )
}
