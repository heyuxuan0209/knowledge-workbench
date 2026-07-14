import { IconWarn } from './Icons'

// 创作台（视觉对齐原型 06-studio）：平台模板分段 + 衬线草稿区 + 溯源警示 + 复制/导出。
// thread 走真实生成（/api/contents/:id/thread）；长文/口播脚本模板为 M4 前的占位结构。

const PLATFORMS = [
  { key: 'thread', label: '𝕏 thread' },
  { key: 'long', label: '📄 公众号长文' },
  { key: 'script', label: '🎬 口播脚本' },
]

export default function StudioView({ studio, setStudio, genDraft, exportMd, setPage, showToast }) {
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
        <span className="wb-studio-src">{studio.source || '手选素材（右侧插入）'}</span>
      </div>
      <div className="wb-page-sub">同一素材集，按平台分化模板 · 每段可溯源到素材卡片</div>

      <div className="wb-seg">
        {PLATFORMS.map(p => (
          <button key={p.key} className={`wb-seg-btn${studio.platform === p.key ? ' active' : ''}`}
            onClick={() => setPlatform(p.key)}>{p.label}</button>
        ))}
      </div>

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
        <button className="wb-btn-ghost" onClick={copyAll}>复制全文</button>
        <button className="wb-btn-ghost" onClick={exportMd}>导出 Markdown</button>
      </div>
      <div className="wb-studio-hint">想让 AI 按你的意思改，用右侧「创作助手」：例如「开头更犀利」「压到 5 条」「加一个反方观点」。</div>
    </>
  )
}
