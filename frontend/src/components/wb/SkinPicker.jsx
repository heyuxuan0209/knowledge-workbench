import { useState, useEffect } from 'react'
import { SKINS, getSeason, getCustomAccent, applySeason } from './skin'

// 顶栏可折叠小控件：默认只是一个小胶囊（色块 + 季名），点开才出选项，不占正文空间。
// 详细设置（含自定义强调色）在「设置」页。
export default function SkinPicker() {
  const [open, setOpen] = useState(false)
  const [season, setSeason] = useState(getSeason())
  const [custom, setCustom] = useState(getCustomAccent())

  useEffect(() => {
    // 设置页里改了皮肤时，顶栏胶囊也跟着变
    const sync = () => { setSeason(getSeason()); setCustom(getCustomAccent()) }
    window.addEventListener('wb-skin-change', sync)
    return () => window.removeEventListener('wb-skin-change', sync)
  }, [])

  const current = SKINS.find(s => s.key === season) || SKINS[0]
  const dotColor = custom || current.accent

  const pick = (key) => {
    applySeason(key)
    setSeason(key); setCustom('')
    setOpen(false)
    window.dispatchEvent(new Event('wb-skin-change'))
  }

  return (
    <div className="wb-skin">
      <button className="wb-skin-btn" onClick={() => setOpen(v => !v)} title="切换皮肤 · 心情">
        <span className="sw" style={{ background: dotColor }} />
        <span>{current.label}</span>
      </button>
      {open && (
        <>
          <div className="wb-skin-backdrop" onClick={() => setOpen(false)} />
          <div className="wb-skin-pop">
            <div className="wb-skin-poptitle">皮肤 · 心情</div>
            {SKINS.map(s => (
              <button key={s.key} className={`wb-skin-item${!custom && s.key === season ? ' on' : ''}`} onClick={() => pick(s.key)}>
                <span className="sw" style={{ background: s.accent }} />
                <span>{s.label}</span>
                <span className="nm">{s.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
