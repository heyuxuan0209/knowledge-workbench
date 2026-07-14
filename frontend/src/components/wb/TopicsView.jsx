import { IconBolt, IconDoc } from './Icons'

// 主题库 + 活页详情（视觉对齐原型 04/05）。
// 后端活页（同化/changelog）是 M3——本组件已按最终结构实现，topics 为空时显示空态引导。

const STATUS_COLORS = {
  '持续演进': { fg: '#a24b3f', bg: 'rgba(162,75,63,.1)' },
  '演进缓慢': { fg: '#706b60', bg: 'rgba(33,31,26,.08)' },
  '持续更新': { fg: '#3d5a80', bg: 'rgba(61,90,128,.12)' },
}

export default function TopicsView({ topics, topicView, setTopicView, activeTopic, setActiveTopic, setPage, setStudio, showToast }) {
  if (topicView === 'page' && activeTopic) {
    return <TopicDetail topic={activeTopic} back={() => setTopicView('list')} setPage={setPage} setStudio={setStudio} showToast={showToast} />
  }

  return (
    <>
      <div className="wb-page-title">我的主题库（{topics.length}）</div>
      <div className="wb-page-sub">每个主题是一篇 AI 帮你持续维护的综述：存进新素材，它自动更新正文、标出分歧，并记下每次修改</div>

      <div className="wb-acquire" style={{ marginTop: 16 }}>
        <input placeholder="搜索已有主题，或输入新主题触发调研…" onKeyDown={(e) => { if (e.key === 'Enter') showToast('主题搜索与深度调研随活页一起上线（M3）') }} />
        <button className="wb-btn-primary" onClick={() => showToast('主题搜索与深度调研随活页一起上线（M3）')}>搜索</button>
      </div>
      <div className="wb-feedbar" style={{ margin: '12px 0 0' }}>
        <span>排序 <b>最近活跃</b></span>
        <span className="wb-feedbar-sep">|</span>
        <span>内容量 · 字母顺序</span>
      </div>

      {topics.length === 0 && (
        <div className="wb-empty">
          还没有主题活页。<br />
          M3 上线后：保存素材可归入主题，AI 自动维护综述、标出分歧、记录修订；<br />
          选题「升级为 Topic」也会在这里建页。
        </div>
      )}

      {topics.map(tp => {
        const sc = STATUS_COLORS[tp.status] || STATUS_COLORS['持续更新']
        return (
          <div key={tp.id} className="wb-card" style={{ padding: '16px 18px' }}>
            <div className="wb-topic-head">
              <span style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 600 }}>{tp.name}</span>
              <span className="wb-pill" style={{ color: sc.fg, background: sc.bg }}>{tp.status}</span>
            </div>
            <div className="wb-topic-meta">{tp.stats}</div>
            <div className="wb-topic-evo">最新演进：{tp.latest}</div>
            {tp.conflict && <div className="wb-topic-conflict"><IconBolt />{tp.conflict}</div>}
            <div className="wb-topic-actions">
              <button className="wb-btn-primary" onClick={() => { setActiveTopic(tp); setTopicView('page') }}>打开主题 →</button>
              <button className="wb-btn-ghost" onClick={() => {
                setStudio(s => ({ ...s, source: `Topic：${tp.name}`, platform: 'thread' })); setPage('studio')
              }}>开始创作</button>
            </div>
          </div>
        )
      })}
    </>
  )
}

function TopicDetail({ topic, back, setPage, setStudio, showToast }) {
  return (
    <>
      <button className="wb-back" onClick={back}>← 主题库</button>
      <div className="wb-topic-head" style={{ marginTop: 6 }}>
        <span className="wb-topic-name">{topic.name}</span>
        <button className="wb-btn-primary" style={{ marginLeft: 'auto' }} onClick={() => {
          setStudio(s => ({ ...s, source: `Topic：${topic.name}`, platform: 'thread' })); setPage('studio')
        }}>开始创作</button>
      </div>

      <div className="wb-card">
        <div className="wb-card-label"><IconDoc />主题综述 · AI 维护，存入新素材自动更新</div>
        <div className="wb-review">
          <h4>当前认知</h4>
          <p>{topic.current}</p>
          <h4>各方观点</h4>
          {(topic.views || []).map((v, i) => (
            <p key={i}>· <b>{v.who}</b>：{v.what} <span className="ref">[{v.ref}]</span>{v.conflict && <span className="conflict"> ⚡与上冲突</span>}</p>
          ))}
          <h4>共识 / 非共识</h4>
          <p>{topic.consensus}</p>
        </div>
      </div>

      <div className="wb-card">
        <div className="wb-card-label">修订记录 · 自动生成</div>
        <div>
          {(topic.changelog || []).map((c, i) => (
            <div key={i} className="wb-timeline-item">
              <div className="wb-timeline-dot" />
              <div className="wb-timeline-when">{c.when}</div>
              <div className="wb-timeline-text">{c.text}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="wb-card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: 'var(--body2)' }}>待并入素材（{topic.pending || 0}）</span>
        <button className="wb-btn-outline" style={{ marginLeft: 'auto' }}
          onClick={() => showToast('已并入素材 · 更新主题综述并记下修订（M3 上线）')}>全部并入</button>
      </div>
    </>
  )
}
