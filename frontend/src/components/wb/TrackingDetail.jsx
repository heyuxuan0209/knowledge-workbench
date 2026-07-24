import { useState, useEffect } from 'react'
import { api } from './util'

// P3 追踪主题详情页（mock D · ADR-040 补充）：本月总览 + 主线四槽位（脉络[#n]句级溯源 / 判断 /
// 待追 / 钩子）+ 零散动态 + 追踪范围 chips + 「这一页怎么工作」策略注释。状态自适应：回访先看增量。
export default function TrackingDetail({ trackingId, goBack, showToast, saveIdea, gotoContent }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const load = () => api(`/api/tracking-topics/${trackingId}`).then(j => setData(j.data)).catch(e => showToast?.('加载失败：' + e.message))
  useEffect(() => { load() }, [trackingId]) // eslint-disable-line

  const refresh = async () => {
    setBusy(true); showToast?.('正在重新收录 + 归线 + 综述（约 1-2 分钟）…')
    try { await api(`/api/tracking-topics/${trackingId}/refresh`, { method: 'POST' }); await load(); showToast?.('已更新') }
    catch (e) { showToast?.('刷新失败：' + e.message) }
    setBusy(false)
  }
  const eject = async (m) => {
    try { await api(`/api/tracking-topics/${trackingId}/eject`, { method: 'POST', body: { contentId: m.id } }); showToast?.('已踢出（记为不感兴趣，不自动学习）'); load() }
    catch (e) { showToast?.('踢出失败：' + e.message) }
  }

  if (!data) return <div style={{ padding: 30, color: 'var(--sub2)' }}>加载追踪综述…</div>
  const active = (data.storylines || []).filter(s => s.status === 'active')
  const scattered = (data.storylines || []).find(s => s.status === 'scattered')
  const dedup = data.memberCount // 去重后件数近似
  const weekNew = (data.storylines || []).flatMap(s => s.members || []).filter(m => (Date.now() - new Date((m.ts || '').replace(' ', 'T') + (/[zZ]/.test(m.ts || '') ? '' : 'Z')).getTime()) < 7 * 864e5).length

  // 把脉络里的 [#n] 渲染成可点角标 → 该主线第 n 条成员的原文
  const renderNarrative = (text, members) => String(text || '').split(/(\[#\d+\])/g).map((seg, i) => {
    const m = seg.match(/^\[#(\d+)\]$/)
    if (!m) return <span key={i}>{seg}</span>
    const idx = parseInt(m[1]) - 1
    const mem = members[idx]
    return <sup key={i} onClick={() => mem && (mem.url ? window.open(mem.url, '_blank', 'noopener') : gotoContent?.(mem.id))}
      title={mem ? `出处：${(mem.title || '').slice(0, 40)}（点击核验原文）` : '出处'}
      style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: 10, fontWeight: 700, margin: '0 1px' }}>[{m[1]}]</sup>
  })

  return (
    <>
      <button className="wb-back" onClick={goBack}>← 返回主题库</button>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
        <span className="wb-topic-name">{data.name}</span>
        <span className="wb-pill" style={{ color: '#3d5a80', background: 'rgba(61,90,128,.1)' }}>🛰 追踪中</span>
        <span style={{ fontSize: 12, color: 'var(--sub2)' }}>收录 {data.memberCount} 条 · 去重约 {dedup} 件事 · {active.length} 条主线</span>
        <button className="wb-btn-ghost" style={{ marginLeft: 'auto' }} disabled={busy} onClick={refresh}>{busy ? '更新中…' : '↻ 重新生成'}</button>
      </div>

      {/* 追踪范围 chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0 4px' }}>
        <span style={{ fontSize: 12, color: 'var(--sub2)', marginRight: 2 }}>追踪范围</span>
        {(data.aliases || []).map(a => <span key={a} className="wb-chip">{a}</span>)}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 10 }}>内容的<b>主角</b>命中这些词才收录——只提一句的不算，员工发的无关内容也不算。</div>

      {/* 怎么工作 折叠 */}
      <div style={{ border: '1px solid var(--line10)', borderRadius: 9, marginBottom: 12, overflow: 'hidden' }}>
        <div onClick={() => setRulesOpen(o => !o)} style={{ cursor: 'pointer', padding: '9px 12px', fontSize: 12.5, color: 'var(--sub)', display: 'flex', alignItems: 'center', gap: 6 }}>
          ⓘ 这一页是怎么工作的（收录 / 主线 / 观点 / 更新 的规则）<span style={{ marginLeft: 'auto', color: 'var(--faint)' }}>{rulesOpen ? '收起 ▴' : '展开 ▾'}</span>
        </div>
        {rulesOpen && (
          <div style={{ padding: '0 12px 11px', fontSize: 12, color: 'var(--sub2)', lineHeight: 1.7 }}>
            · <b>收什么</b>：以追踪对象为<b>主角</b>的内容（向量召回 + AI 判主角性；只提一句/员工生活贴不算）。<br />
            · <b>主线怎么来</b>：按<b>因果连通性</b>串（一条是另一条的原因/后续/证据），不是话题相似就归堆；串不成的进「零散动态」。<br />
            · <b>哪些是 AI 的观点</b>：每条主线的「判断」是 AI 下的、标了「供你反驳」，与可溯源的事实脉络隔开。<br />
            · <b>新内容怎么进来</b>：每天同步后自动归线；回访时最上面先告诉你"上次之后新发生了什么"。<br />
            · <b>这主题怎么来</b>：追踪主题都是<b>你手动建的</b>，AI 不会自己偷偷建。每条事实都可点 [n] 角标核验原文。
          </div>
        )}
      </div>

      {/* 增量态：本周新进展 */}
      {weekNew > 0 && (
        <div style={{ border: '1px solid rgba(169,121,31,.3)', background: 'rgba(169,121,31,.06)', borderRadius: 9, padding: '10px 13px', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#8a6a1a' }}>🗓 近 7 天新收录 {weekNew} 条</div>
          <div style={{ fontSize: 11.5, color: 'var(--sub2)', marginTop: 2 }}>已自动归入下面各主线；回访不用重读全文。</div>
        </div>
      )}

      {/* 本月总览 */}
      {data.overview && (
        <div style={{ margin: '4px 0 16px', padding: '12px 14px', background: 'var(--brief-bg)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--sub2)', marginBottom: 4 }}>📌 本月一句话 · AI 判断</div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 15, lineHeight: 1.6, color: 'var(--text)' }}>{data.overview}</div>
        </div>
      )}

      {/* 主线四槽位 */}
      {active.map((sl, i) => (
        <div key={sl.id} className="wb-card" style={{ marginBottom: 14, padding: '14px 16px' }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>主线{'一二三四五六'[i] || (i + 1)}：{sl.name}<span style={{ fontSize: 12, color: 'var(--faint)', fontWeight: 400, marginLeft: 8 }}>{sl.members.length} 条</span></div>
          {sl.narrative && <div style={{ fontSize: 13.5, lineHeight: 1.85, color: 'var(--body2)', marginBottom: 10 }}>{renderNarrative(sl.narrative, sl.members)}</div>}
          {sl.verdict && (
            <div style={{ borderLeft: '3px solid var(--accent)', background: 'rgba(61,90,128,.06)', borderRadius: '0 8px 8px 0', padding: '9px 12px', margin: '8px 0' }}>
              <div style={{ fontSize: 10.5, color: 'var(--accent)', marginBottom: 3, fontWeight: 600 }}>⚖️ 一句话判断 · AI 判断，供你反驳</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text)' }}>{sl.verdict}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 12, color: 'var(--sub2)' }}>
            {sl.watch && <div style={{ flex: 1, minWidth: 200 }}>🔭 <b>待追</b>：{sl.watch}</div>}
            {sl.hook && <div style={{ flex: 1, minWidth: 200 }}>✍️ <b>钩子</b>：{sl.hook}
              <button className="wb-btn-ghost" style={{ marginLeft: 8, padding: '2px 9px', fontSize: 11 }}
                onClick={() => saveIdea?.({ title: `${data.name}·${sl.name}`, sourceKind: 'tracking', supportingContentIds: sl.members.map(m => m.id) })}>提为灵感 →</button>
            </div>}
          </div>
          {/* 主线级来源 */}
          <details style={{ marginTop: 10 }}>
            <summary style={{ fontSize: 11.5, color: 'var(--faint)', cursor: 'pointer' }}>来源 · {sl.members.length} 条（点开可审计/踢出）</summary>
            {sl.members.map((m, mi) => (
              <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, padding: '3px 0', color: 'var(--sub)' }}>
                <span style={{ color: 'var(--accent)', fontWeight: 700, flex: 'none' }}>[{mi + 1}]</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(m.ts || '').slice(5, 10)} {m.title}</span>
                {m.reason && <span className="wb-pill" style={{ fontSize: 9.5, color: 'var(--sub2)', background: 'var(--line07)' }}>{m.reason}</span>}
                {m.url && <a href={m.url} target="_blank" rel="noreferrer" style={{ color: 'var(--faint)', flex: 'none' }}>原文↗</a>}
                <button className="wb-note-del" style={{ flex: 'none' }} title="踢出（收错了）" onClick={() => eject(m)}>✕</button>
              </div>
            ))}
          </details>
        </div>
      ))}

      {/* 零散动态 */}
      {scattered?.members?.length > 0 && (
        <div className="wb-card" style={{ marginBottom: 14, padding: '12px 15px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>🗂 零散动态（{scattered.members.length} 条）<span style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 400, marginLeft: 6 }}>还串不成因果链，不硬凑叙事</span></div>
          {scattered.members.map(m => (
            <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '3px 0' }}>
              <span style={{ color: 'var(--faint)', flex: 'none' }}>{(m.ts || '').slice(5, 10)}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
              {m.url && <a href={m.url} target="_blank" rel="noreferrer" style={{ color: 'var(--faint)', flex: 'none' }}>↗</a>}
              <button className="wb-note-del" style={{ flex: 'none' }} title="踢出" onClick={() => eject(m)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
