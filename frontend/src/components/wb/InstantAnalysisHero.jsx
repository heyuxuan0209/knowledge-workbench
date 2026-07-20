import { useState, useRef } from 'react'

// 即时分析入口（ADR-029）——方案1 双入口的「消化」lane。丢链接/纪要/音频/PDF → AI 读懂 →
// 产物落**素材库**（保持"素材=料"），解读结果上另给「💡提为灵感」（右栏解读区）。
// 支持格式按动作分两行（B 式）：粘链接能放哪些平台 / 传文件能传哪些格式，正好对上输入框(粘)和＋(传)。
// 逻辑（acquire/uploadFile）由 WorkbenchPage 提供，本组件只管 lane UI + 进度。
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
    if (ok) setUploading(null)
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
    <div className={`wb-insp-lane deep${dragOver ? ' dragover' : ''}`}
      onDragOver={(e) => { if (uploadFile) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFileChosen(f) }}>
      <div className="wb-lane-ttl"><span className="wb-lane-lab deep">消化</span>即时分析</div>
      <div className="wb-lane-cap">丢一个东西进来 → AI 读懂 → 存成素材，可提为灵感</div>

      {uploading ? (
        <div className="wb-uploading" style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 12.5 }}>{uploading.kind === 'audio' ? '音频' : '文档'}：{uploading.filename}</span>
            <span className="wb-lane-cap" style={{ marginLeft: 'auto', margin: 0 }}>{uploading.status === 'error' ? '' : '本地处理 · 不上传云端'}</span>
          </div>
          {uploading.status === 'error'
            ? <div className="wb-warnbar" style={{ marginTop: 8 }}>处理失败：{uploading.error}
                <button className="wb-brief-link" style={{ marginLeft: 8 }} onClick={() => setUploading(null)}>关闭</button></div>
            : <>
                <div className="wb-progress"><i /></div>
                <div className="wb-lane-cap" style={{ margin: 0 }}>
                  {uploading.kind === 'audio' ? `正在本地转写全程…已 ${uploading.elapsedSec || 0}s · 会议音频要几分钟，完成后自动进解读，你可先去干别的` : '正在抽取文字…'}
                </div>
              </>}
        </div>
      ) : (
        <>
          <div className="wb-lane-row">
            <input type="file" ref={fileInputRef} style={{ display: 'none' }}
              accept="audio/*,.pdf,.md,.markdown,.txt,.docx,.mp3,.m4a,.wav,.aac,.ogg"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChosen(f); e.target.value = '' }} />
            <button className="wb-lane-plus" title="上传音频 / PDF / Word / Markdown（也可拖进来）"
              onClick={() => fileInputRef.current?.click()}>＋</button>
            <input value={acquireVal} onChange={(e) => setAcquireVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) doAcquire() }}
              placeholder="粘链接，或粘大段文字…" />
            <button className="wb-btn-primary" style={{ padding: '8px 12px', fontSize: 12.5 }}
              disabled={!acquireVal.trim() || ingesting} onClick={doAcquire}>{ingesting ? '抓取中…' : '读懂它'}</button>
          </div>
          <div className="wb-lane-fmt">
            <div>🔗 <b>粘链接</b>：网页 · 公众号 · YouTube · 小宇宙 · B站，或直接粘会议纪要等大段文字</div>
            <div>📎 <b>传文件</b>：音频（转全程）· PDF · Word · Markdown，也可拖进来</div>
          </div>
        </>
      )}
    </div>
  )
}
