import { execFile } from 'child_process';
import { promisify } from 'util';
import { homedir, tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdir, readdir, rm } from 'fs/promises';

const pexec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// 本地 ASR 管道（M5 最小版前移，ADR-015）：无字幕视频的"全文解读"兜底。
// 音频获取（免 ffmpeg：bili audio --no-split 出完整 m4a，yt-dlp bestaudio 不转码，
// faster-whisper 内置 PyAV 直接解码）→ scripts/transcribe.py 本地转写 → 文本进
// 现有翻译/解读管道。零 API 费、内容不出本机；首次调用会下载 whisper small 模型（~460MB）。
//
// 成本画像（M 系芯片 CPU int8）：10 分钟音频约 1-3 分钟转写，只在首次解读时发生，
// 结果由 content-body-resolver 缓存进 contents.zh_body，之后秒开。

const PIP_BIN = join(homedir(), 'Library/Python/3.10/bin');
const CLI_ENV = { ...process.env, PATH: `${PIP_BIN}:${process.env.PATH || ''}` };
// 字幕优先后，ASR 只是"无字幕视频"的兜底，故上限放宽到 40 分钟（覆盖绝大多数演讲/播客）；
// 「转写全程」按需补全时用 FULL 档（3 小时，实际取视频真实时长）。small int8 约 3.2× 实时。
export const MAX_AUDIO_SECONDS = 2400;      // 兜底自动转写：40 分钟
export const FULL_AUDIO_SECONDS = 10800;    // 「转写全程」：3 小时（够长视频用）
const DOWNLOAD_TIMEOUT = 5 * 60000;
const TRANSCRIBE_TIMEOUT = 15 * 60000;
const DIARIZE_TIMEOUT = 25 * 60000; // 分离管道（whisperX+pyannote）CPU 上明显更慢

// 转写调度（M5 完整版，2026-07-16）：
// diarize=true 且配了 HF_TOKEN → whisperX 说话人分离管道（transcribe-diarize.py），
// 输出【说话人A】【说话人B】标签文本；无 token 或分离失败 → 回落普通管道，
// 渐进增强不硬依赖。播客（访谈居多）默认请求分离，视频口播默认不用。
async function runTranscriber(audioFile, { diarize = false, maxSeconds = MAX_AUDIO_SECONDS } = {}) {
  // 上传的会议音频要转全程，故 maxSeconds 可配（默认 15 分钟给链接视频用）；超时按时长放宽
  const timeout = Math.max(TRANSCRIBE_TIMEOUT, Math.ceil(maxSeconds / 60) * 60000);
  if (diarize && process.env.HF_TOKEN) {
    try {
      const { stdout } = await pexec('python3', [
        join(__dirname, '../../scripts/transcribe-diarize.py'), audioFile, '--max-seconds', String(maxSeconds),
      ], { env: CLI_ENV, timeout: Math.max(DIARIZE_TIMEOUT, timeout), maxBuffer: 64 * 1024 * 1024 });
      const result = JSON.parse(stdout);
      if (!result.error && result.text?.length >= 20) return { ...result, diarized: true };
      console.log(`[asr] 分离管道无有效输出（${result.error || '文本过短'}），回落普通转写`);
    } catch (err) {
      console.log(`[asr] 分离管道失败（${(err.stderr || err.message || '').toString().slice(0, 150)}），回落普通转写`);
    }
  }
  const { stdout } = await pexec('python3', [
    join(__dirname, '../../scripts/transcribe.py'), audioFile, '--max-seconds', String(maxSeconds),
  ], { env: CLI_ENV, timeout, maxBuffer: 64 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (!result.text || result.text.length < 20) throw new Error('转写结果为空（可能是纯音乐/无人声内容）');
  return { ...result, diarized: false };
}

// 本地音频文件转写（上传场景）：会议录音默认转全程（上限 60 分钟，防极端）。
// diarize 默认 true（会议多人，配了 HF_TOKEN 才生效，否则自动回落）。
export async function transcribeAudioFile(filePath, { maxSeconds = 3600, diarize = true } = {}) {
  return runTranscriber(filePath, { diarize, maxSeconds });
}

async function findAudioFile(dir) {
  const files = await readdir(dir, { recursive: true });
  const audio = files.find(f => /\.(m4a|webm|mp3|wav|opus)$/i.test(f));
  return audio ? join(dir, audio) : null;
}

// 下载带单次重试：B站对高频 IP 会临时限速（实测同一视频几秒 vs 卡死超时），
// 隔 5 秒重试一次能消化大部分瞬时限速；错误信息截短（CLI 的进度输出别混进降级提示）
async function execWithRetry(cmd, args) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await pexec(cmd, args, { env: CLI_ENV, timeout: DOWNLOAD_TIMEOUT, maxBuffer: 4 * 1024 * 1024 });
    } catch (err) {
      if (attempt >= 1) {
        const reason = err.killed ? '下载超时（可能被平台临时限速，稍后再试）' : (err.stderr || err.message || '').toString().trim().slice(0, 120);
        throw new Error(`音频下载失败：${reason}`);
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function downloadAudio(url, workDir) {
  if (/bilibili\.com|b23\.tv/.test(url)) {
    const bv = url.match(/BV[a-zA-Z0-9]+/)?.[0];
    if (!bv) throw new Error('无法从 B站 链接解析出 BV 号');
    await execWithRetry('bili', ['audio', bv, '--no-split', '-o', workDir]);
  } else if (/youtube\.com|youtu\.be/.test(url)) {
    const args = ['-f', 'bestaudio', '-o', join(workDir, 'audio.%(ext)s'), '--no-playlist', url];
    if (process.env.YOUTUBE_PROXY_URL) args.unshift('--proxy', process.env.YOUTUBE_PROXY_URL);
    await execWithRetry('yt-dlp', args);
  } else {
    throw new Error('暂只支持 B站 / YouTube 视频的音频转写');
  }

  const audioFile = await findAudioFile(workDir);
  if (!audioFile) throw new Error('音频下载完成但未找到音频文件');
  return audioFile;
}

// 直链音频转写（小宇宙等给出 m4a/mp3 直链的场景，M5）：下载 → 本地转写。
// 返回同 transcribeVideo；失败上抛由调用方降级。
export async function transcribeAudioUrl(audioUrl, { diarize = false } = {}) {
  const workDir = join(tmpdir(), 'kw-asr', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(workDir, { recursive: true });
  try {
    const ext = audioUrl.match(/\.(m4a|mp3|wav|opus)(\?|$)/i)?.[1] || 'm4a';
    const file = join(workDir, `audio.${ext}`);
    const { default: axios } = await import('axios');
    const { createWriteStream } = await import('fs');
    const res = await axios.get(audioUrl, {
      responseType: 'stream', timeout: DOWNLOAD_TIMEOUT,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    await new Promise((resolve, reject) => {
      const w = createWriteStream(file);
      res.data.pipe(w);
      w.on('finish', resolve);
      w.on('error', reject);
      res.data.on('error', reject);
    });

    return await runTranscriber(file, { diarize });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// VTT/SRT 字幕 → 纯文本：去时间轴/标签/序号，合并自动字幕的重复滚动行。
function parseSubtitles(raw) {
  const out = [];
  let last = '';
  for (let line of raw.split(/\r?\n/)) {
    line = line.replace(/<[^>]+>/g, '').trim();               // 去 <c>/<00:00:00.000> 等内联标签
    if (!line || line === 'WEBVTT') continue;
    if (line.includes('-->')) continue;                       // 时间轴行
    if (/^\d+$/.test(line)) continue;                         // SRT 序号
    if (/^(Kind|Language|NOTE):/i.test(line)) continue;
    if (line === last) continue;                              // 自动字幕逐行滚动的重复
    out.push(line); last = line;
  }
  return out.join('\n').trim();
}

// yt-dlp 拉字幕（含自动字幕），YouTube/B站 通吃。命中返回纯文本，无字幕返回 null。
async function fetchCaptions(url, workDir) {
  const args = [
    '--skip-download', '--write-subs', '--write-auto-subs',
    '--sub-langs', 'zh-Hans,zh-Hant,zh,en,en-orig,en.*,zh.*',
    '--sub-format', 'vtt/srt/best', '--no-playlist',
    '-o', join(workDir, 'sub.%(ext)s'), url,
  ];
  if (process.env.YOUTUBE_PROXY_URL) args.unshift('--proxy', process.env.YOUTUBE_PROXY_URL);
  try {
    await pexec('yt-dlp', args, { env: CLI_ENV, timeout: DOWNLOAD_TIMEOUT, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    console.log(`[asr] 字幕拉取失败（${(err.stderr || err.message || '').toString().slice(0, 120)}）`);
    return null;
  }
  const files = (await readdir(workDir)).filter(f => /\.(vtt|srt)$/i.test(f));
  if (!files.length) return null;
  // 优先中文字幕（含自动），其次英文
  const pick = files.sort((a, b) => (/(zh|Hans|Hant)/i.test(b) ? 1 : 0) - (/(zh|Hans|Hant)/i.test(a) ? 1 : 0))[0];
  const { readFile } = await import('fs/promises');
  const text = parseSubtitles(await readFile(join(workDir, pick), 'utf-8'));
  return text.length >= 40 ? text : null;
}

// 视频取全文 → { text, source:'captions'|'asr', truncated, language }。
// 字幕优先（快、准、无时长限制），拿不到才本地 ASR（full=true 时转全程）。失败上抛。
export async function transcribeVideo(url, { full = false } = {}) {
  const workDir = join(tmpdir(), 'kw-asr', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(workDir, { recursive: true });

  try {
    const captions = await fetchCaptions(url, workDir).catch(() => null);
    if (captions) return { text: captions, source: 'captions', truncated: false, language: null };

    const audioFile = await downloadAudio(url, workDir);
    const maxSeconds = full ? FULL_AUDIO_SECONDS : MAX_AUDIO_SECONDS;
    const asr = await runTranscriber(audioFile, { diarize: false, maxSeconds }); // 视频多为单人口播，不做分离
    return { ...asr, source: 'asr' };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
