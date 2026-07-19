import { randomUUID } from 'crypto';
import { readFile, rm } from 'fs/promises';

// 上传摄入（VISION-V4 UI 改造：即时分析支持上传文件）：
// - 音频（会议录音/语音备忘录）→ 本地 faster-whisper 转全程 → 文本
// - PDF → 抽正文文字
// 转写慢（会议音频几分钟~几十分钟），故异步：startUploadJob 立即返回 jobId，
// 前端轮询 getJob 拿进度/结果。结果 shape 与 /api/content/ingest 对齐（走同一条解读路）。

const jobs = new Map(); // jobId -> { status:'processing'|'done'|'error', kind, filename, result?, error?, startedAt }

export function getJob(id) {
  const j = jobs.get(id);
  if (!j) return null;
  const { result, ...meta } = j;
  return { ...meta, elapsedSec: Math.round((Date.now() - j.startedAt) / 1000), result: j.status === 'done' ? result : undefined };
}

export function startUploadJob({ path, originalname, mimetype }) {
  const id = randomUUID();
  const name = originalname || '';
  let kind = 'audio'; // 默认按音频处理（转写）
  if (/\.pdf$/i.test(name) || /pdf/i.test(mimetype || '')) kind = 'pdf';
  else if (/\.(md|markdown|txt)$/i.test(name)) kind = 'text';
  else if (/\.docx$/i.test(name)) kind = 'docx';
  jobs.set(id, { status: 'processing', kind, filename: originalname, startedAt: Date.now() });
  processJob(id, { path, originalname, kind }).catch(err => {
    jobs.set(id, { ...jobs.get(id), status: 'error', error: err.message });
  });
  return { id, kind };
}

async function processJob(id, { path, originalname, kind }) {
  try {
    let ingested;
    if (kind === 'pdf') {
      const buf = await readFile(path);
      const { PDFParse } = await import('pdf-parse'); // v2：类 API，new PDFParse({data}).getText()
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      let text = '';
      try { text = (await parser.getText()).text || ''; } finally { await parser.destroy?.().catch(() => {}); }
      const body = text.replace(/\n{3,}/g, '\n\n').trim();
      if (body.length < 20) throw new Error('这个 PDF 没抽到文字（可能是扫描件/图片版 PDF）');
      ingested = {
        title: originalname.replace(/\.pdf$/i, ''), body, type: 'text', fetchStatus: 'success',
        metadata: { originalTitle: originalname, platform: '上传 PDF', publishedAt: null, author: null },
      };
    } else if (kind === 'text') {
      const body = (await readFile(path, 'utf8')).replace(/\n{3,}/g, '\n\n').trim();
      if (body.length < 5) throw new Error('文件里没有文字内容');
      ingested = {
        title: originalname.replace(/\.[^.]+$/, ''), body, type: 'text', fetchStatus: 'success',
        metadata: { originalTitle: originalname, platform: '上传文档', publishedAt: null, author: null },
      };
    } else if (kind === 'docx') {
      const mammoth = (await import('mammoth')).default;
      const { value } = await mammoth.extractRawText({ path });
      const body = (value || '').replace(/\n{3,}/g, '\n\n').trim();
      if (body.length < 20) throw new Error('这个 Word 没抽到文字');
      ingested = {
        title: originalname.replace(/\.docx$/i, ''), body, type: 'text', fetchStatus: 'success',
        metadata: { originalTitle: originalname, platform: '上传 Word', publishedAt: null, author: null },
      };
    } else {
      const { transcribeAudioFile } = await import('./asr.js');
      const asr = await transcribeAudioFile(path, { maxSeconds: 3600, diarize: true });
      let body = asr.text;
      // 非分离的中文转写补标点分段；分离文本已有说话人分行
      if (!asr.diarized) {
        try { const { formatTranscript } = await import('./translation.js'); body = await formatTranscript(asr.text); }
        catch { /* 保留原文 */ }
      }
      ingested = {
        title: originalname.replace(/\.[^.]+$/, ''), body, type: 'audio', fetchStatus: 'success',
        transcript: asr.segments || null,
        metadata: { originalTitle: originalname, platform: '上传音频', publishedAt: null, author: null },
        note: asr.truncated ? '音频较长，已转写前段' : null,
      };
    }

    const { translateContent } = await import('./translation.js');
    const translation = await translateContent(ingested);
    jobs.set(id, { ...jobs.get(id), status: 'done', result: { ...ingested, ...translation } });
  } finally {
    await rm(path, { force: true }).catch(() => {});
  }
}

// 简单清理：进程内 Map，超过 2 小时的任务清掉（防内存长期堆积）
setInterval(() => {
  const cutoff = Date.now() - 2 * 3600 * 1000;
  for (const [id, j] of jobs) if (j.startedAt < cutoff) jobs.delete(id);
}, 30 * 60 * 1000).unref?.();
