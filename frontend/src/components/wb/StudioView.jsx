import { IconWarn } from './Icons'

// 创作台（视觉对齐原型 06-studio）：平台模板分段 + 衬线草稿区 + 溯源警示 + 复制/导出。
// thread 走真实生成（/api/contents/:id/thread）；长文/口播脚本模板为 M4 前的占位结构。

const PLATFORMS = [
  { key: 'thread', label: '𝕏 thread' },
  { key: 'long', label: '📄 公众号长文' },
  { key: 'script', label: '🎬 口播脚本' },
]

export default function StudioView({ studio, setStudio, genDraft, exportMd, setPage, showToast, drafts, saveDraft, openDraft, humanizeDraft, undoRewrite, deleteCurrentDraft, suggestTitles, gotoTopic }) {
  const setPlatform = (p) => {
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
                {{ thread: '𝕏', long: '📄', script: '🎬' }[d.platform]} {(d.title || d.body.slice(0, 24)).slice(0, 26)} · {(d.updated_at || '').slice(5, 10)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="wb-page-sub">同一素材集，按平台分化模板 · 每段可溯源到素材卡片</div>

      <div className="wb-seg">
        {PLATFORMS.map(p => (
          <button key={p.key} className={`wb-seg-btn${studio.platform === p.key ? ' active' : ''}`}
            onClick={() => setPlatform(p.key)}>{p.label}</button>
        ))}
      </div>

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
        <button className="wb-btn-outline" disabled={studio.busy} title="三遍审校：去 AI 高频词 / 拆套路句式 / 加入第一人称判断"
          onClick={humanizeDraft}>去 AI 味</button>
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
    </>
  )
}
