import { useState, useRef } from 'react'
import { IconFeishu } from './Icons'
import { api } from './util'

// 即时分析入口（ADR-029 + ADR-039 简化版）——「消化一个东西 → AI 读懂 → 存素材」。
// 来源三选一、都带字：🔗粘链接/文字 · 📎传文件 · 飞 从飞书。飞书只给一个门（避免"粘链接里有飞书、旁边又有从飞书"撞车）：
//   点「从飞书」→ 门里挑一篇（搜最近文档，点拉来读）；有链接就直接粘到上面输入框（飞书链接已支持直抓）。
// 逻辑（acquire/uploadFile/pickFeishu/analyzeFeishu）由 WorkbenchPage 提供，本组件只管 lane UI。
export default function InstantAnalysisHero({ acquire, uploadFile, pickFeishu, analyzeFeishu, searchFeishu }) {
  const [acquireVal, setAcquireVal] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [uploading, setUploading] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const inputRef = useRef(null)

  const [src, setSrc] = useState('link') // 'link' | 'file' | 'feishu'（哪个来源亮着）
  const [fsList, setFsList] = useState(null) // 「最近」浏览候选（null=未拉）
  const [fsLoading, setFsLoading] = useState(false)
  const [fsPicking, setFsPicking] = useState(null)
  const [fsQuery, setFsQuery] = useState('') // 搜索框
  const [fsResults, setFsResults] = useState(null) // null=没搜（显示最近）/ []=搜了没结果 / [...]
  const [fsSearching, setFsSearching] = useState(false)
  const [fsConnected, setFsConnected] = useState(null) // 用户授权状态：null未知/true已连/false未连

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

  // 来源切换：粘链接→聚焦输入；传文件→开文件框；从飞书→展开门 + 首次拉候选
  const pickSrc = async (s) => {
    setSrc(s)
    if (s === 'link') setTimeout(() => inputRef.current?.focus(), 0)
    if (s === 'file') fileInputRef.current?.click()
    if (s === 'feishu') {
      api('/api/feishu/oauth/status').then(j => setFsConnected(!!j.data?.connected)).catch(() => {})
      if (fsList === null && pickFeishu) {
        setFsLoading(true)
        try { setFsList(await pickFeishu()) } catch { setFsList([]) }
        setFsLoading(false)
      }
    }
  }
  const pickOne = async (item) => {
    if (!analyzeFeishu) return
    setFsPicking(item.feishuId)
    await analyzeFeishu(item)
    setFsPicking(null)
  }
  const doSearch = async () => {
    const q = fsQuery.trim()
    if (!q) { setFsResults(null); return } // 清空=回到「最近」
    if (!searchFeishu) return
    setFsSearching(true)
    try { setFsResults(await searchFeishu(q)) } catch { setFsResults([]) }
    setFsSearching(false)
  }
  // 门里显示：搜过 → 搜索结果；没搜 → 最近浏览
  const searched = fsResults !== null
  const fsShown = searched ? fsResults : (fsList || [])

  return (
    <div className={`wb-insp-lane deep${dragOver ? ' dragover' : ''}`}
      onDragOver={(e) => { if (uploadFile) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFileChosen(f) }}>
      <div className="wb-lane-ttl"><span className="wb-lane-lab deep">消化</span>即时分析</div>
      <div className="wb-lane-cap">要读/消化一个东西 → AI 读懂 → 存成素材</div>

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
                  {uploading.kind === 'audio' ? `正在本地转写全程…已 ${uploading.elapsedSec || 0}s · 会议音频要几分钟，完成后自动进解读` : '正在抽取文字…'}
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
            <input ref={inputRef} value={acquireVal} onChange={(e) => setAcquireVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) doAcquire() }}
              placeholder="粘链接，或粘大段文字…" />
            <button className="wb-btn-primary" style={{ padding: '8px 12px', fontSize: 12.5 }}
              disabled={!acquireVal.trim() || ingesting} onClick={doAcquire}>{ingesting ? '抓取中…' : '读懂它'}</button>
          </div>

          {/* 来源三选一、都带字 */}
          <div className="wb-src-row">
            <span className="wb-src-lbl">来源</span>
            <button className={`wb-src${src === 'link' ? ' on' : ''}`} onClick={() => pickSrc('link')}>🔗 粘链接 / 文字</button>
            <button className={`wb-src${src === 'file' ? ' on' : ''}`} onClick={() => pickSrc('file')}>📎 传文件</button>
            {pickFeishu && (
              <button className={`wb-src${src === 'feishu' ? ' on' : ''}`} onClick={() => pickSrc('feishu')}>
                <span className="wb-src-fs"><IconFeishu size={15} /></span> 从飞书
              </button>
            )}
          </div>
          {src !== 'feishu' && (
            <div className="wb-lane-fmt">
              <div>🔗 <b>粘链接</b>：网页 · 公众号 · YouTube · 小宇宙 · B站，或粘会议纪要等大段文字</div>
              <div>📎 <b>传文件</b>：音频（转全程）· PDF · Word · Markdown，也可拖进来</div>
            </div>
          )}

          {/* 从飞书门：挑一篇（搜最近文档）；有链接就直接粘到上面输入框 */}
          {src === 'feishu' && pickFeishu && (
            <div className="wb-fsdoor">
              <div className="wb-fsdoor-h">
                <span className="wb-src-fs"><IconFeishu size={17} /></span>
                <b>从飞书找一篇</b>
                <span className="sub2">— 搜你整个飞书（实时），或看最近；知道链接就直接粘到上面输入框</span>
                {fsConnected === true && <span className="wb-fs-connected">已连接你的飞书 ✓</span>}
              </div>
              {fsConnected === false && (
                <div className="wb-fs-connectbar">
                  <span>只连了应用、读不到你的个人文档。<b>连接你的飞书</b>后，凡是你能看到的文档都能读。</span>
                  <button className="wb-btn-primary" style={{ padding: '4px 12px', fontSize: 12 }}
                    onClick={() => window.open('/api/feishu/oauth/start', '_blank')}>连接飞书 →</button>
                </div>
              )}
              <div className="wb-fsdoor-search">
                <input value={fsQuery}
                  onChange={(e) => setFsQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) doSearch() }}
                  placeholder="搜飞书里的文档（关键词，搜整个飞书）…" />
                <button className="wb-btn-primary" style={{ padding: '8px 13px', fontSize: 12.5 }}
                  disabled={fsSearching} onClick={doSearch}>{fsSearching ? '搜…' : '搜'}</button>
                {searched && <button className="wb-fsdoor-clear" onClick={() => { setFsQuery(''); setFsResults(null) }}>清空看最近</button>}
              </div>
              <div className="wb-fsdoor-list">
                {(fsLoading || fsSearching) && <div className="wb-fs-empty">{fsSearching ? '搜索中…' : '读取飞书内容…'}</div>}
                {!fsLoading && !fsSearching && fsShown.length === 0 && (
                  <div className="wb-fs-empty">{searched ? '没搜到匹配的文档（换个关键词，或直接粘飞书链接到上面）' : '没拉到最近内容——上面搜一下，或把飞书链接直接粘到输入框'}</div>
                )}
                {!fsLoading && !fsSearching && fsShown.length > 0 && (
                  <div className="wb-fsdoor-listhint">{searched ? `搜到 ${fsShown.length} 篇` : '最近的文档'}</div>
                )}
                {!fsLoading && !fsSearching && fsShown.map(it => (
                  <button key={it.feishuId} className="wb-fs-pick-item" disabled={fsPicking === it.feishuId}
                    onClick={() => pickOne(it)}>
                    <span className="ty">{it.sourceName || (it.objType === 'wiki' ? '知识库' : '云文档')}</span>
                    <span className="nm">{it.title || '(无标题)'}</span>
                    <span className="go">{fsPicking === it.feishuId ? '抓取中…' : '拉来读 →'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
