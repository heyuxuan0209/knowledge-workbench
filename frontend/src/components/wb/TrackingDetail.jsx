import { useState, useEffect } from 'react'
import { api } from './util'

// P3 追踪主题详情页（mock D · ADR-040 补充）：本月总览 + 主线四槽位（脉络[#n]句级溯源 / 判断 /
// 待追 / 钩子）+ 零散动态 + 追踪范围 chips + 「这一页怎么工作」策略注释。状态自适应：回访先看增量。
export default function TrackingDetail({ trackingId, goBack, showToast, saveIdea, gotoContent, reloadList }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [openLines, setOpenLines] = useState(null)  // 展开的主线 id 集（首访全开、回访折叠为判断预览）
  const load = () => api(`/api/tracking-topics/${trackingId}`).then(j => {
    setData(j.data)
    const act = (j.data?.storylines || []).filter(s => s.status === 'active')
    // 状态自适应：首访（无 last_seen）全展开通读；回访折叠成标题+判断预览
    setOpenLines(j.data?.lastSeenAt ? new Set() : new Set(act.map(s => s.id)))
  }).catch(e => showToast?.('加载失败：' + e.message))
  const toggleLine = (id) => setOpenLines(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  useEffect(() => {
    load()
    api(`/api/tracking-topics/${trackingId}/seen`, { method: 'POST' }).catch(() => {}) // 记 last_seen（在 GET 之后，下次回访才重算 since）
  }, [trackingId]) // eslint-disable-line
  const delSelf = async () => {
    if (!confirm(`删除追踪主题《${data?.name}》？收录与综述都会删除（素材本身不受影响）。`)) return
    try { await api(`/api/tracking-topics/${trackingId}`, { method: 'DELETE' }); showToast?.('已删除'); reloadList?.(); goBack() } catch (e) { showToast?.('删除失败：' + e.message) }
  }
  const archiveSelf = async () => {
    try { await api(`/api/tracking-topics/${trackingId}/archive`, { method: 'POST', body: { archived: true } }); showToast?.('已归档（可恢复）'); reloadList?.(); goBack() } catch (e) { showToast?.('归档失败：' + e.message) }
  }

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

  // 把脉络里的 [#n] 渲染成可点角标 → 该主线第 n 条成员的原文
  const renderNarrative = (text, members) => String(text || '').split(/(\[#\d+\])/g).map((seg, i) => {
    const m = seg.match(/^\[#(\d+)\]$/)
    if (!m) return <span key={i}>{seg}</span>
    const idx = parseInt(m[1]) - 1
    const mem = members[idx]
    return <span key={i} className="tk-cite" onClick={() => mem && (mem.url ? window.open(mem.url, '_blank', 'noopener') : gotoContent?.(mem.id))}
      title={mem ? `出处：${(mem.title || '').slice(0, 40)}（点击核验原文）` : '出处'}>{m[1]}</span>
  })

  const seenMs = data.lastSeenAt ? new Date((data.lastSeenAt || '').replace(' ', 'T') + 'Z').getTime() : 0
  const isNew = (m) => seenMs && new Date((m.ts || '').replace(' ', 'T') + (/[zZ]/.test(m.ts || '') ? '' : 'Z')).getTime() > seenMs
  const deltaNews = active.flatMap(sl => (sl.members || []).filter(isNew).map(m => ({ m, sl }))).sort((a, b) => (b.m.ts || '').localeCompare(a.m.ts || ''))
  const num = '一二三四五六七八'

  return (
    <>
      <button className="wb-back" onClick={goBack}>← 返回主题库</button>
      {/* 头部（mock D .hd） */}
      <div className="tk-hd">
        <div>
          <h1>{data.name}<span className="type">🛰 追踪中</span></h1>
          <div className="meta">收录 <b>{data.memberCount}</b> 条 · 去重约 <b>{dedup}</b> 件事 · <b>{active.length}</b> 条主线{data.lastSeenAt ? <> · 上次看到 <b>{(data.lastSeenAt || '').slice(5, 16)}</b></> : ''}</div>
        </div>
        <div className="acts">
          <button disabled={busy} onClick={refresh}>{busy ? '更新中…' : '↻ 重新生成'}</button>
          <button title="停收录不删数据，进归档区可恢复" onClick={archiveSelf}>📥 归档</button>
          <button className="del" onClick={delSelf}>🗑 删除</button>
        </div>
      </div>

      {/* 追踪范围 chips（mock D .scope） */}
      <div className="tk-scope">
        <span className="slab">追踪范围</span>
        {(data.aliases || []).map(a => <span key={a} className="tk-chip">{a}</span>)}
        <span className="hint">内容的<b>主角</b>命中这些词才收录——只提一句的不算，员工发的无关内容也不算。</span>
      </div>

      {/* 怎么工作（mock D .explain） */}
      <div className={`tk-explain${rulesOpen ? ' open' : ''}`}>
        <div className="ehead" onClick={() => setRulesOpen(o => !o)}>ⓘ 这一页是怎么工作的（收录 / 主线 / 观点 / 更新 的规则）<span style={{ marginLeft: 'auto', fontSize: 10 }}>{rulesOpen ? '▾' : '▸'}</span></div>
        {rulesOpen && (
          <div className="ebody">
            <div className="rule"><b>收什么：</b>以追踪对象为主角的内容（向量召回 + AI 判主角性；只提一句/员工生活贴不算）。</div>
            <div className="rule"><b>主线怎么来：</b>按因果连通性串（一条是另一条的原因/后续/证据），不是话题相似就归堆；串不成的进「零散动态」。</div>
            <div className="rule"><b>哪些是 AI 的观点：</b>每条主线的「判断」是 AI 下的、标了「供你反驳」，与可溯源的事实脉络隔开。</div>
            <div className="rule"><b>新内容怎么进来：</b>每天同步后自动归线；回访时最上面先告诉你"上次之后新发生了什么"。</div>
            <div className="rule"><b>这主题怎么来：</b>追踪主题都是你手动建的，AI 不会自己偷偷建。每条事实都可点 [n] 角标核验原文。</div>
          </div>
        )}
      </div>

      {/* 状态自适应：首访通读引导 / 回访增量条 */}
      {!data.lastSeenAt
        ? <div className="tk-firstbar">👋 首次访问——下面 {active.length} 条主线已全部展开，通读一遍；之后回访会自动折叠，只提醒你新发生了什么。</div>
        : (
          <div className="tk-delta">
            <h3>🗓 你上次看过之后，新发生了 {deltaNews.length} 件事</h3>
            {deltaNews.length === 0 && <div style={{ fontSize: 12, color: 'var(--sub2)' }}>没有新进展——展开下面主线看完整脉络。</div>}
            {deltaNews.map(({ m, sl }) => (
              <div key={m.id} className="drow">
                <span className="dd">{(m.ts || '').slice(5, 10)}</span>
                <span className="dt">{m.title}</span>
                <span className="dl">{sl.name.slice(0, 10)}</span>
                {m.url && <a href={m.url} target="_blank" rel="noreferrer" style={{ color: 'var(--faint)' }}>↗</a>}
              </div>
            ))}
            {deltaNews.length > 0 && <div className="dnote">已自动归入下面各主线；展开看完整脉络。</div>}
          </div>
        )}

      {/* 本月总览（mock D .lede） */}
      {data.overview && <div className="tk-lede"><span className="lab">📌 本月一句话 · AI 判断</span><p>{data.overview}</p></div>}

      <div className="tk-seclab">脉络 · {active.length} 条主线（点标题展开/折叠）</div>
      {active.map((sl, i) => {
        const open = openLines?.has(sl.id)
        const failed = String(sl.narrative || '').startsWith('⚠️')
        const newInLine = (sl.members || []).filter(isNew).length
        return (
          <div key={sl.id} className={`tk-acc${open ? ' open' : ''}`}>
            <div className="head" onClick={() => toggleLine(sl.id)}>
              <span className="n">主线{num[i] || i + 1}</span>
              <span className="t">{sl.name}</span>
              <span className="mini">{newInLine > 0 && <b style={{ color: 'var(--amber)' }}>+{newInLine} · </b>}{sl.members.length} 条</span>
              <span className="chev">▸</span>
            </div>
            {!open && <div className="teaser">{failed ? '⚠️ 本段生成失败——展开可重试' : (sl.verdict || '展开看脉络与判断')}</div>}
            {open && (
              <div className="body">
                {failed
                  ? <div className="wb-warnbar" style={{ marginTop: 12 }}>{sl.narrative}<button className="wb-btn-ghost" style={{ marginLeft: 8, padding: '2px 9px', fontSize: 11 }} onClick={refresh}>重新生成</button></div>
                  : <div className="tk-acc-narr" style={{ paddingTop: 12, fontSize: 14.5, color: 'var(--body)', lineHeight: 1.9 }}>{renderNarrative(sl.narrative, sl.members)}</div>}
                {sl.verdict && !failed && (
                  <div className="tk-verdict"><div className="vlab">⚖️ 一句话判断 · AI 判断，供你反驳</div><p>{sl.verdict}</p></div>
                )}
                {sl.watch && <div className="tk-watch">🔭 待追：{sl.watch}</div>}
                {sl.hook && (
                  <div className="tk-hook">
                    <span className="t">✍️ {sl.hook}</span>
                    <button onClick={() => saveIdea?.({ title: `${data.name}·${sl.name}`, sourceKind: 'tracking', supportingContentIds: sl.members.map(m => m.id) })}>提为灵感 →</button>
                  </div>
                )}
                <details className="tk-srcbox">
                  <summary>来源 · {sl.members.length} 条（点开可审计 / 踢出）</summary>
                  {sl.members.map((m, mi) => (
                    <div key={m.id} className="srow">
                      <span className="sn">[{mi + 1}]</span>
                      <span className="st">{(m.ts || '').slice(5, 10)} {m.title}</span>
                      {m.reason && <span className="wb-pill" style={{ fontSize: 9.5, color: 'var(--sub2)', background: 'var(--line07)', flex: 'none' }}>{m.reason}</span>}
                      {m.url && <a href={m.url} target="_blank" rel="noreferrer" style={{ color: 'var(--faint)', flex: 'none' }}>原文↗</a>}
                      <button className="tk-mute" title="踢出（收错了）" onClick={() => eject(m)}>✕</button>
                    </div>
                  ))}
                </details>
              </div>
            )}
          </div>
        )
      })}

      {/* 零散动态（mock D .scatter） */}
      {scattered?.members?.length > 0 && (
        <div className="tk-scatter">
          <h3>🗂 零散动态（{scattered.members.length} 条）</h3>
          <div className="ssub">还串不成因果链，不硬凑叙事</div>
          {scattered.members.map(m => (
            <div key={m.id} className="srow2">
              <span className="sd">{(m.ts || '').slice(5, 10)}</span>
              <span className="stt">{m.title}</span>
              {m.url && <a href={m.url} target="_blank" rel="noreferrer">↗</a>}
              <button className="tk-mute" title="踢出" onClick={() => eject(m)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
