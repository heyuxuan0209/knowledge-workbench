// 设置（视觉对齐原型 08-settings）：展示行 + 右侧下拉样式（当前为展示性配置）

const ROWS = [
  { label: 'LLM Provider', value: 'Deepseek（可替换）' },
  { label: '日报生成时间', value: '手动 / crontab 每日 09:00' },
  { label: 'RSS 轮询频率', value: '手动同步' },
]

export default function SettingsView() {
  return (
    <>
      <div className="wb-page-title" style={{ fontFamily: 'var(--serif)' }}>Settings</div>
      <div className="wb-page-sub">LLM Provider、同步频率、定时任务（日/周/月报）配置</div>
      {ROWS.map(r => (
        <div key={r.label} className="wb-setting-row">
          <span className="wb-setting-label">{r.label}</span>
          <span className="wb-setting-value">{r.value} ▾</span>
        </div>
      ))}
    </>
  )
}
