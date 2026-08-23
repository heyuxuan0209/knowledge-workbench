// 心情皮肤（ADR-037）：默认=现状暖纸靛蓝；四季=body[data-season] 变量覆盖（见 workbench.css）。
// 另支持「自定义强调色」——用内联 style 覆盖 --accent，优先级高于季节预设。
// 全站组件走 var()，切换零改动。持久化到 localStorage，main.jsx 首屏 init 避免闪烁。

export const SKINS = [
  { key: 'default', label: '常', name: '原版 · 暖纸靛蓝', accent: '#3d5a80', bg: '#efece4' },
  { key: 'spring',  label: '春', name: '冷杉沙',         accent: '#6f8a5b', bg: '#eff2ea' },
  { key: 'summer',  label: '夏', name: '湖石青',         accent: '#5b8496', bg: '#edf2f3' },
  { key: 'autumn',  label: '秋', name: '陶土棕',         accent: '#a6764e', bg: '#f3efe7' },
  { key: 'winter',  label: '冬', name: '夜 · 雾蓝暗色',   accent: '#8fa9c4', bg: '#191a1d' },
]

const LS_SEASON = 'wb-season'
const LS_ACCENT = 'wb-accent'

export function getSeason() {
  try { return localStorage.getItem(LS_SEASON) || 'default' } catch { return 'default' }
}
export function getCustomAccent() {
  try { return localStorage.getItem(LS_ACCENT) || '' } catch { return '' }
}

// 选季节预设：清掉自定义色（回到该季默认强调色），再套季节
export function applySeason(key) {
  clearCustomAccent()
  if (key === 'default') delete document.body.dataset.season
  else document.body.dataset.season = key
  try { localStorage.setItem(LS_SEASON, key) } catch { /* 忽略 */ }
}

// 自定义强调色：内联覆盖 --accent / --accent-hover，跨季节生效直到清除
export function applyCustomAccent(hex) {
  document.body.style.setProperty('--accent', hex)
  document.body.style.setProperty('--accent-hover', shade(hex, -14))
  try { localStorage.setItem(LS_ACCENT, hex) } catch { /* 忽略 */ }
}
export function clearCustomAccent() {
  document.body.style.removeProperty('--accent')
  document.body.style.removeProperty('--accent-hover')
  try { localStorage.removeItem(LS_ACCENT) } catch { /* 忽略 */ }
}

// 首屏应用（main.jsx 在 render 前调用，避免默认皮肤闪一下）
export function initSkin() {
  const s = getSeason()
  if (s && s !== 'default') document.body.dataset.season = s
  const a = getCustomAccent()
  if (a) {
    document.body.style.setProperty('--accent', a)
    document.body.style.setProperty('--accent-hover', shade(a, -14))
  }
}

// hex 明暗调整：pct<0 变深、>0 变浅
function shade(hex, pct) {
  const n = parseInt(hex.replace('#', ''), 16)
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const t = pct < 0 ? 0 : 255, p = Math.abs(pct) / 100
  r = Math.round((t - r) * p + r)
  g = Math.round((t - g) * p + g)
  b = Math.round((t - b) * p + b)
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}
