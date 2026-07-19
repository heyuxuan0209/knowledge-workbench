// 设置（视觉对齐原型 08-settings）：展示行 + 右侧下拉样式（当前为展示性配置）

const ROWS = [
  { label: '内容理解模型', value: 'Deepseek（可替换）' },
  { label: '日报生成时间', value: '每天 09:00 自动' },
  { label: '信源同步频率', value: '手动同步' },
]

export default function SettingsView() {
  return (
    <>
      <div className="wb-page-title" style={{ fontFamily: 'var(--serif)' }}>设置</div>
      <div className="wb-page-sub">模型、信源同步、日报/周报/月报的生成时间</div>
      {ROWS.map(r => (
        <div key={r.label} className="wb-setting-row">
          <span className="wb-setting-label">{r.label}</span>
          <span className="wb-setting-value">{r.value} ▾</span>
        </div>
      ))}
    </>
  )
}
