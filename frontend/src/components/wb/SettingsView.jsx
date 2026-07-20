// 设置（视觉对齐原型 08-settings）：展示行 + 皮肤 · 心情（预设 + 自定义强调色）

import { useState } from 'react'
import { SKINS, getSeason, getCustomAccent, applySeason, applyCustomAccent, clearCustomAccent } from './skin'

const ROWS = [
  { label: '内容理解模型', value: 'Deepseek（可替换）' },
  { label: '日报生成时间', value: '每天 09:00 自动' },
  { label: '信源同步频率', value: '手动同步' },
]

export default function SettingsView() {
  const [season, setSeason] = useState(getSeason())
  const [custom, setCustom] = useState(getCustomAccent())

  const pickSeason = (key) => {
    applySeason(key)
    setSeason(key); setCustom('')
    window.dispatchEvent(new Event('wb-skin-change'))
  }
  const pickColor = (hex) => {
    applyCustomAccent(hex)
    setCustom(hex)
    window.dispatchEvent(new Event('wb-skin-change'))
  }
  const resetColor = () => {
    clearCustomAccent()
    setCustom('')
    window.dispatchEvent(new Event('wb-skin-change'))
  }

  const currentAccent = custom || (SKINS.find(s => s.key === season)?.accent || '#3d5a80')

  return (
    <>
      <div className="wb-page-title" style={{ fontFamily: 'var(--serif)' }}>设置</div>
      <div className="wb-page-sub">皮肤心情、模型、信源同步、日报/周报/月报的生成时间</div>

      {/* 皮肤 · 心情 */}
      <div className="wb-setting-row" style={{ display: 'block' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span className="wb-setting-label">皮肤 · 心情</span>
          <span className="wb-setting-value" style={{ fontSize: 12 }}>按当下心情换一套配色，随时切回「常」</span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 13 }}>
          {SKINS.map(s => {
            const on = !custom && s.key === season
            return (
              <button
                key={s.key}
                onClick={() => pickSeason(s.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px',
                  borderRadius: 10, cursor: 'pointer', background: 'var(--surface)',
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--line14)'}`,
                  boxShadow: on ? '0 0 0 2px rgba(0,0,0,.03)' : 'none',
                }}
              >
                <span style={{ display: 'flex', gap: 3 }}>
                  <span style={{ width: 15, height: 15, borderRadius: 4, background: s.bg, border: '1px solid var(--line10)' }} />
                  <span style={{ width: 15, height: 15, borderRadius: 4, background: s.accent }} />
                </span>
                <span style={{ fontSize: 13, fontWeight: on ? 600 : 500, color: on ? 'var(--accent)' : 'var(--body)' }}>{s.label}</span>
                <span style={{ fontSize: 11.5, color: 'var(--sub2)' }}>{s.name}</span>
              </button>
            )
          })}
        </div>

        {/* 自定义强调色 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 15, paddingTop: 14, borderTop: '1px solid var(--line08)' }}>
          <span style={{ fontSize: 12.5, color: 'var(--body2)', fontWeight: 500 }}>自定义强调色</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <span style={{ width: 26, height: 26, borderRadius: 7, background: currentAccent, border: '1px solid var(--line14)', position: 'relative', overflow: 'hidden' }}>
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(currentAccent) ? currentAccent : '#3d5a80'}
                onChange={(e) => pickColor(e.target.value)}
                style={{ position: 'absolute', inset: -4, width: 40, height: 40, border: 'none', padding: 0, cursor: 'pointer', opacity: 0 }}
              />
            </span>
            <span style={{ fontSize: 12, color: 'var(--sub)' }}>{custom ? custom : '点色块自定义'}</span>
          </label>
          {custom && (
            <button className="wb-btn-mini" onClick={resetColor}>恢复季节色</button>
          )}
          <span style={{ fontSize: 11.5, color: 'var(--faint)', marginLeft: 'auto' }}>只改强调色，画布仍随所选季节</span>
        </div>
      </div>

      {ROWS.map(r => (
        <div key={r.label} className="wb-setting-row">
          <span className="wb-setting-label">{r.label}</span>
          <span className="wb-setting-value">{r.value} ▾</span>
        </div>
      ))}
    </>
  )
}
