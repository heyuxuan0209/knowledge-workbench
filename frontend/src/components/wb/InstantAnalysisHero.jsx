import { useState, useRef } from 'react'

// 即时分析入口（ADR-029：从资讯页迁到灵感库）。丢链接/会议纪要/音频/PDF → AI 读懂 →
// 产物落**素材库**（保持"素材=料"的一致），解读结果上另给「💡提为灵感」一键（在右栏解读区）。
// 入口放灵感库，是因为"我主动丢个东西进来消化"和"随手记灵感"是同一种主动收集姿势。
// 逻辑（acquire / uploadFile）仍由 WorkbenchPage 提供，本组件只管入口 UI + 进度。
export default function InstantAnalysisHero({ acquire, uploadFile }) {
  const [acquireVal, setAcquireVal] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [uploading, setUploading] = useState(null) // { status, kind, filename, elapsedSec, error }
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  const onFileChosen = async (file) => {
    if (!file || !uploadFile) return
    const isAudio = /\.(mp3|m4a|wav|aac|ogg|opus|flac)$/i.test(file.name) || (file.type || '').startsWith('audio')
    setUploading({ status: 'processing', kind: isAudio ? 'audio' : 'file', filename: file.name, elapsedSec: 0 })
    const ok = await uploadFile(file, (job) => setUploading(job))
    if (ok) setUploading(null) // 完成→已进右栏解读，收起进度条
  }
  const doAcquire = async () => {
    const v = acquireVal.trim()
    if (!v || ingesting) return
    setIngesting(true)
    const ok = await acquire(v)
    if (ok) setAcquireVal('')
    setIngesting(false)
  }

  return (
    <div className={`wb-hero${dragOver ? ' dragover' : ''}`}
      onDragOver={(e) => { if (uploadFile) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFileChosen(f) }}>
      <div className="wb-hero-t">丢一个链接 / 会议纪要 / 音频 / PDF 进来，AI 帮你读懂——料存进素材，顺手提成灵感</div>
      <div className="wb-hero-d">从「别人的东西」到「你要写的东西」的入口——出精读稿 → 存为素材 → 一键提为灵感</div>
      {uploading ? (
        <div className="wb-uploading">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{uploading.kind === 'audio' ? '音频' : '文档'}：{uploading.filename}</span>
            <span className="wb-hero-d" style={{ marginLeft: 'auto', marginBottom: 0 }}>{uploading.status === 'error' ? '' : '本地处理 · 不上传云端'}</span>
          </div>
          {uploading.status === 'error'
            ? <div className="wb-warnbar" style={{ marginTop: 8 }}>处理失败：{uploading.error}
                <button className="wb-brief-link" style={{ marginLeft: 8 }} onClick={() => setUploading(null)}>关闭</button></div>
            : <>
                <div className="wb-progress"><i /></div>
                <div className="wb-hero-d" style={{ marginBottom: 0 }}>
                  {uploading.kind === 'audio' ? `正在本地转写全程…已 ${uploading.elapsedSec || 0}s · 会议音频需要几分钟，完成后自动进入解读，你可以先去干别的` : '正在抽取文字…'}
                </div>
              </>}
        </div>
      ) : (
        <>
          <div className="wb-hero-row">
            <input type="file" ref={fileInputRef} style={{ display: 'none' }}
              accept="audio/*,.pdf,.md,.markdown,.txt,.docx,.mp3,.m4a,.wav,.aac,.ogg"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChosen(f); e.target.value = '' }} />
            <button className="wb-hero-clip" title="上传音频 / PDF（也可把文件拖到这里）"
              onClick={() => fileInputRef.current?.click()}>＋</button>
            <input
              value={acquireVal}
              onChange={(e) => setAcquireVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doAcquire() }}
              placeholder="粘贴链接，或直接粘贴大段文字（会议纪要…）"
            />
            <button className="wb-btn-primary" disabled={!acquireVal.trim() || ingesting} onClick={doAcquire}>
              {ingesting ? '抓取中…' : '读懂它 →'}
            </button>
          </div>
          <div className="wb-hero-d" style={{ marginTop: 9, marginBottom: 0 }}>
            支持：网页 / 公众号 / YouTube / 小宇宙 / B站 链接 · 会议纪要等大段文字 · 上传 音频（转全程）/ PDF / Markdown / Word · 也可把文件拖到这里
          </div>
        </>
      )}
    </div>
  )
}
