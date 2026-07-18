// 轻量 markdown → HTML（VISION-V4 UI 改造：精读稿/素材卡不再露原始 markdown 符号）。
// 只覆盖精读稿会用到的语法：# ## ### 标题、**加粗**、`代码`、> 引用、- 列表、段落。
// 先转义 HTML 防注入，再做行内替换。返回 HTML 字符串，配 .wb-md 样式，dangerouslySetInnerHTML 用。

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>')
}

export function renderMarkdown(md) {
  if (!md) return ''
  const lines = String(md).split(/\r?\n/)
  let html = '', inList = false, inQuote = false
  let quoteBuf = []
  const flushQuote = () => {
    if (inQuote) { html += '<blockquote>' + quoteBuf.map(inline).join('<br>') + '</blockquote>'; quoteBuf = []; inQuote = false }
  }
  const flushList = () => { if (inList) { html += '</ul>'; inList = false } }

  for (const ln of lines) {
    if (/^>\s?/.test(ln)) { flushList(); inQuote = true; quoteBuf.push(ln.replace(/^>\s?/, '')); continue }
    flushQuote()
    if (/^###\s+/.test(ln)) { flushList(); html += '<h3>' + inline(ln.replace(/^###\s+/, '')) + '</h3>'; continue }
    if (/^##\s+/.test(ln)) { flushList(); html += '<h2>' + inline(ln.replace(/^##\s+/, '')) + '</h2>'; continue }
    if (/^#\s+/.test(ln)) { flushList(); html += '<h1>' + inline(ln.replace(/^#\s+/, '')) + '</h1>'; continue }
    if (/^[-*]\s+/.test(ln)) { if (!inList) { html += '<ul>'; inList = true } html += '<li>' + inline(ln.replace(/^[-*]\s+/, '')) + '</li>'; continue }
    flushList()
    if (ln.trim() === '---' || ln.trim() === '') continue
    html += '<p>' + inline(ln) + '</p>'
  }
  flushQuote(); flushList()
  return html
}
