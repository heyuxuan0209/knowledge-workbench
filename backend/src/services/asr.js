import { execFile } from 'child_process';
import { promisify } from 'util';
import { homedir, tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { mkdir, readdir, rm, stat } from 'fs/promises';

const pexec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ASR 管道（M5 最小版前移，ADR-015；云通道 ADR-064）：无字幕视频的"全文解读"兜底。
// 音频获取（B 站出完整 m4a；YouTube 用 ffmpeg 只截需要分析的低码率音频段）
// → 转写：配了 GROQ_API_KEY 时优先 Groq 云端
// whisper-large-v3-turbo（约 $0.02/小时音频且有免费额度，1 小时音频几十秒转完，本地
// CPU 要 20 分钟）；无 key / 文件超限 / 调用失败自动降级 scripts/transcribe.py 本地
// 转写（零 API 费、内容不出本机；首次调用会下载 whisper small 模型 ~460MB）。
//
// 成本画像（M 系芯片 CPU int8）：10 分钟音频约 1-3 分钟转写，只在首次解读时发生，
// 结果由 content-body-resolver 缓存进 contents.zh_body，之后秒开。

const PIP_BIN = join(homedir(), 'Library/Python/3.10/bin');
const CLI_ENV = { ...process.env, PATH: `${PIP_BIN}:${process.env.PATH || ''}` };
const PROVISIONED_PYTHON = join(__dirname, '../../.venv-asr/bin/python3');
const ASR_PYTHON = process.env.ASR_PYTHON || (existsSync(PROVISIONED_PYTHON) ? PROVISIONED_PYTHON : 'python3');
// 字幕优先后，ASR 只是"无字幕视频"的兜底，故上限放宽到 40 分钟（覆盖绝大多数演讲/播客）；
// 「转写全程」按需补全时用 FULL 档。small int8 约 3.2× 实时。
export const MAX_AUDIO_SECONDS = 2400;      // 兜底自动转写：40 分钟
export const FULL_AUDIO_SECONDS = Math.max(10800, Number(process.env.FULL_VIDEO_MAX_SECONDS) || 21600);
// 「发飞书前补全」默认允许 6 小时；可用 FULL_VIDEO_MAX_SECONDS 调大。超过上限仍明确标 partial，
// 不把前段结果伪装成全片。
const DOWNLOAD_TIMEOUT = 5 * 60000;
const TRANSCRIBE_TIMEOUT = 15 * 60000;
const DIARIZE_TIMEOUT = 25 * 60000; // 分离管道（whisperX+pyannote）CPU 上明显更慢
const GROQ_FILE_LIMIT = 24 * 1024 * 1024;
const GROQ_CHUNK_SECONDS = 20 * 60;
// 只用于元数据探测失败时的最后兜底；正常路径会根据视频 language
// 和实际字幕列表只下载一条原始语言轨。不得使用 * 通配自动翻译字幕。
export const YOUTUBE_SUB_LANGS = 'en-orig,en,zh-Hans,zh-Hant,zh';

// Node 内置 fetch（undici）不读 HTTP_PROXY 环境变量（content-ingestion.js 同款坑），
// 走代理必须显式注入 ProxyAgent；只影响单次请求，不污染进程。
async function proxiedFetch(url, opts = {}) {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!proxyUrl) return fetch(url, opts);
  const { ProxyAgent } = await import('undici');
  return fetch(url, { ...opts, dispatcher: new ProxyAgent(proxyUrl) });
}

// Groq 云转写（ADR-064）：whisper-large-v3-turbo，verbose_json 拿分段。免费档单文件
// 上限 25MB，超限直接抛错让调用方走本地（bestaudio m4a 约 1MB/分钟，25MB≈短视频/中短
// 播客够用；超长内容本就该本地慢慢转）。
async function transcribeViaGroq(audioFile) {
  const { readFile } = await import('fs/promises');
  const buf = await readFile(audioFile);
  if (buf.length > GROQ_FILE_LIMIT) {
    throw new Error(`音频 ${(buf.length / 1048576).toFixed(0)}MB 超过 Groq 免费档上限（25MB）`);
  }
  const form = new FormData();
  form.append('file', new Blob([buf]), audioFile.split('/').pop());
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  const res = await proxiedFetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}：${(await res.text()).slice(0, 150)}`);
  const data = await res.json();
  if (!data.text || data.text.trim().length < 20) throw new Error('转写结果为空（可能是纯音乐/无人声内容）');
  return {
    text: data.text.trim(),
    language: data.language || null,
    duration: data.duration || null,
    truncated: false, // Groq 整文件转写，无本地管道的 maxSeconds 截断
    segments: (data.segments || []).map(s => ({ start: s.start, end: s.end, text: s.text })),
  };
}

// 长音频先压成 16kHz 单声道并按 20 分钟切块，每块远低于 Groq 25MB 限制。
// 顺序调用比并发更慢一点，但能避免免费/低配额度的瞬时限流，是发送链路更稳的选择。
async function transcribeViaGroqChunks(audioFile, workDir) {
  const pattern = join(workDir, 'groq-chunk-%03d.mp3');
  await pexec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', audioFile,
    '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k',
    '-f', 'segment', '-segment_time', String(GROQ_CHUNK_SECONDS), '-reset_timestamps', '1', pattern,
  ], { env: CLI_ENV, timeout: DOWNLOAD_TIMEOUT, maxBuffer: 8 * 1024 * 1024 });
  const chunks = (await readdir(workDir))
    .filter(name => /^groq-chunk-\d+\.mp3$/.test(name))
    .sort();
  if (!chunks.length) throw new Error('长音频切块后没有生成可转写文件');

  const results = [];
  let offset = 0;
  for (const name of chunks) {
    const result = await transcribeViaGroq(join(workDir, name));
    results.push({ result, offset });
    offset += Number(result.duration) || GROQ_CHUNK_SECONDS;
  }
  return {
    text: results.map(item => item.result.text).join(' ').trim(),
    language: results.find(item => item.result.language)?.result.language || null,
    duration: offset,
    truncated: false,
    segments: results.flatMap(item => item.result.segments.map(segment => ({
      ...segment,
      start: Number(segment.start || 0) + item.offset,
      end: Number(segment.end || segment.start || 0) + item.offset,
    }))),
  };
}

// 转写调度（M5 完整版，2026-07-16）：
// diarize=true 且配了 HF_TOKEN → whisperX 说话人分离管道（transcribe-diarize.py），
// 输出【说话人A】【说话人B】标签文本；无 token 或分离失败 → 回落普通管道，
// 渐进增强不硬依赖。播客（访谈居多）默认请求分离，视频口播默认不用。
async function runTranscriber(audioFile, { diarize = false, maxSeconds = MAX_AUDIO_SECONDS, cloudChunkDir = null } = {}) {
  // 本地 small int8 在 CPU 上约 3.2× 实时，给足 4× 时长，避免三小时视频必然超时。
  const timeout = Math.max(TRANSCRIBE_TIMEOUT, Math.ceil(maxSeconds * 4000));
  if (diarize && process.env.HF_TOKEN) {
    try {
      const { stdout } = await pexec(ASR_PYTHON, [
        join(__dirname, '../../scripts/transcribe-diarize.py'), audioFile, '--max-seconds', String(maxSeconds),
      ], { env: CLI_ENV, timeout: Math.max(DIARIZE_TIMEOUT, timeout), maxBuffer: 64 * 1024 * 1024 });
      const result = JSON.parse(stdout);
      if (!result.error && result.text?.length >= 20) return { ...result, diarized: true };
      console.log(`[asr] 分离管道无有效输出（${result.error || '文本过短'}），回落普通转写`);
    } catch (err) {
      console.log(`[asr] 分离管道失败（${(err.stderr || err.message || '').toString().slice(0, 150)}），回落普通转写`);
    }
  }
  // 普通转写：Groq 云优先（快、近乎免费），失败/超限/无 key → 本地 whisper 兜底，渐进增强不硬依赖
  if (process.env.GROQ_API_KEY) {
    try {
      const fileSize = (await stat(audioFile)).size;
      const result = fileSize > GROQ_FILE_LIMIT && cloudChunkDir
        ? await transcribeViaGroqChunks(audioFile, cloudChunkDir)
        : await transcribeViaGroq(audioFile);
      return { ...result, diarized: false, engine: fileSize > GROQ_FILE_LIMIT ? 'groq-chunked' : 'groq' };
    } catch (err) {
      console.log(`[asr] Groq 云转写失败（${(err.message || '').slice(0, 150)}），降级本地 whisper`);
    }
  }
  const { stdout } = await pexec(ASR_PYTHON, [
    join(__dirname, '../../scripts/transcribe.py'), audioFile, '--max-seconds', String(maxSeconds),
  ], { env: CLI_ENV, timeout, maxBuffer: 64 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (!result.text || result.text.length < 20) throw new Error('转写结果为空（可能是纯音乐/无人声内容）');
  return { ...result, diarized: false, engine: 'local' };
}

// 本地音频文件转写（上传场景）：会议录音默认转全程（上限 60 分钟，防极端）。
// diarize 默认 true（会议多人，配了 HF_TOKEN 才生效，否则自动回落）。
export async function transcribeAudioFile(filePath, { maxSeconds = 3600, diarize = true } = {}) {
  return runTranscriber(filePath, { diarize, maxSeconds });
}

async function findAudioFile(dir) {
  const files = await readdir(dir, { recursive: true });
  // mp4：X 视频无独立音频流时落盘的是音画合流文件，PyAV/Groq 都能直接解出音轨
  const audio = files.find(f => /\.(m4a|webm|mp3|wav|opus|mp4)$/i.test(f));
  return audio ? join(dir, audio) : null;
}

// 下载带单次重试：B站对高频 IP 会临时限速（实测同一视频几秒 vs 卡死超时），
// 隔 5 秒重试一次能消化大部分瞬时限速；错误信息截短（CLI 的进度输出别混进降级提示）
function withoutProxyArgs(args) {
  const proxyAt = args.indexOf('--proxy');
  if (proxyAt < 0) return args;
  return args.filter((_arg, index) => index !== proxyAt && index !== proxyAt + 1);
}

export function selectCaptionLanguageFromMetadata(metadata = {}) {
  const manual = metadata.subtitles || {};
  const automatic = metadata.automatic_captions || {};
  const original = metadata.language || null;
  const usable = (collection, key) => key && key !== 'live_chat' && Array.isArray(collection[key]) && collection[key].length > 0;

  // 准确性优先级：原语言人工字幕 > 原语言自动字幕 > 常用语言人工字幕
  // > 常用语言自动字幕 > 任意可用轨。只选一条，避免翻译轨 429 拖垮原始轨。
  const originalKeys = original ? [`${original}-orig`, original] : [];
  for (const key of originalKeys) if (usable(manual, key)) return key;
  for (const key of originalKeys) if (usable(automatic, key)) return key;

  // 部分 YouTube 视频的顶层 language 为 null，但字幕键仍明确给出 en-orig 等原轨。
  // 必须先选它，否则会误选 zh-Hans 自动翻译轨并触发 429。
  const markedOriginal = Object.keys(automatic).find(key => key.endsWith('-orig') && usable(automatic, key));
  if (markedOriginal) return markedOriginal;

  const preferred = ['zh-Hans', 'zh-Hant', 'zh', 'en-orig', 'en'];
  for (const key of preferred) if (usable(manual, key)) return key;
  for (const key of preferred) if (usable(automatic, key)) return key;

  return Object.keys(manual).find(key => usable(manual, key))
    || Object.keys(automatic).find(key => usable(automatic, key))
    || null;
}

function ytDlpInstallBroken(error) {
  const raw = `${error?.message || ''}\n${error?.stderr || ''}`;
  return error?.code === 'ENOENT' || /bad interpreter|No such file or directory/i.test(raw);
}

async function execYtDlpOnce(args, options) {
  const runtimeArgs = args.includes('--js-runtimes') ? args : ['--js-runtimes', 'node', ...args];
  try {
    return await pexec('yt-dlp', runtimeArgs, options);
  } catch (error) {
    // Homebrew Python 升级后 yt-dlp 的 shebang 可能仍指向已删除的旧 Python。
    // python -m 是同一套参数的可恢复路径，不应让所有 YouTube 转写因此全挂。
    if (!ytDlpInstallBroken(error)) throw error;
    return pexec(ASR_PYTHON, ['-m', 'yt_dlp', ...runtimeArgs], options);
  }
}

async function execYtDlp(args, options) {
  try {
    return await execYtDlpOnce(args, options);
  } catch (proxyError) {
    // 生产优先经 Mac 反向隧道出口，避开 YouTube 对数据中心 IP 的风控。
    // 若本机代理/隧道暂时不可用，去掉 --proxy 再试 VPS 直连，避免单出口故障。
    const directArgs = withoutProxyArgs(args);
    if (directArgs.length === args.length) throw proxyError;
    try {
      return await execYtDlpOnce(directArgs, options);
    } catch (directError) {
      directError.proxyError = proxyError;
      throw directError;
    }
  }
}

async function execWithRetry(cmd, args) {
  for (let attempt = 0; ; attempt++) {
    try {
      const options = { env: CLI_ENV, timeout: DOWNLOAD_TIMEOUT, maxBuffer: 4 * 1024 * 1024 };
      return cmd === 'yt-dlp' ? await execYtDlp(args, options) : await pexec(cmd, args, options);
    } catch (err) {
      if (attempt >= 1) {
        // 截取要挑对行：yt-dlp 的 stderr 常常先吐几行 WARNING（如"No supported JavaScript
        // runtime"），真正的 ERROR 在后面。直接 slice(0,120) 会把警告当成失败原因报给用户，
        // 上层再据此判断/展示就全歪了（2026-08-08 实测：真因是 IP 被风控，用户看到的却是
        // JS runtime 警告）。所以优先取 ERROR 行，没有才退回原样截断。
        const rawErr = (err.stderr || err.message || '').toString().trim();
        const errLine = rawErr.split('\n').find(l => /^\s*ERROR[: ]/i.test(l));
        const reason = err.killed
          ? '下载超时（可能被平台临时限速，稍后再试）'
          : (errLine || rawErr).trim().slice(0, 200);
        throw new Error(`音频下载失败：${reason}`);
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

let ffmpegAvailable;
async function hasFfmpeg() {
  if (ffmpegAvailable != null) return ffmpegAvailable;
  try {
    await pexec('ffmpeg', ['-version'], { env: CLI_ENV, timeout: 5000 });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

export function buildYoutubeAudioArgs(url, workDir, maxSeconds, canClip = true) {
  const args = [
    // 语音 ASR 不需要高码率。64kbps × 40 分钟约 19MB，可稳定落在 Groq 25MB 内。
    '-f', 'bestaudio[abr<=64]/worstaudio/bestaudio',
    '-o', join(workDir, 'audio.%(ext)s'), '--no-playlist',
  ];
  // yt-dlp 截取时间段需 ffmpeg。没安装时仍能退回整段下载，不让功能硬崩。
  if (canClip && Number.isFinite(maxSeconds) && maxSeconds > 0) {
    args.push('--download-sections', `*0-${maxSeconds}`);
  }
  args.push(url);
  if (process.env.YOUTUBE_PROXY_URL) args.unshift('--proxy', process.env.YOUTUBE_PROXY_URL);
  return args;
}

async function downloadAudio(url, workDir, { maxSeconds = MAX_AUDIO_SECONDS } = {}) {
  if (/bilibili\.com|b23\.tv/.test(url)) {
    const bv = url.match(/BV[a-zA-Z0-9]+/)?.[0];
    if (!bv) throw new Error('无法从 B站 链接解析出 BV 号');
    await execWithRetry('bili', ['audio', bv, '--no-split', '-o', workDir]);
  } else if (/youtube\.com|youtu\.be/.test(url)) {
    const args = buildYoutubeAudioArgs(url, workDir, maxSeconds, await hasFfmpeg());
    await execWithRetry('yt-dlp', args);
  } else if (/(^|\/\/|\.)(x|twitter)\.com\//.test(url)) {
    // X 推文视频（ADR-064）：yt-dlp 原生支持公开推文，无需登录；X 视频多为音画合流的
    // mp4（无独立 bestaudio 流），故 bestaudio/best 兜底整段视频，PyAV 能直接解出音轨。
    // X 与 YouTube 同属需代理平台，复用同一代理出口。
    const args = ['-f', 'bestaudio/best', '-o', join(workDir, 'audio.%(ext)s'), '--no-playlist', url];
    if (process.env.YOUTUBE_PROXY_URL) args.unshift('--proxy', process.env.YOUTUBE_PROXY_URL);
    await execWithRetry('yt-dlp', args);
  } else {
    throw new Error('暂只支持 B站 / YouTube / X 视频的音频转写');
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
  let selectedLanguage = null;
  let sourceDuration = null;
  try {
    const metadataArgs = ['--dump-single-json', '--skip-download', '--no-playlist', url];
    if (process.env.YOUTUBE_PROXY_URL) metadataArgs.unshift('--proxy', process.env.YOUTUBE_PROXY_URL);
    const { stdout } = await execYtDlp(metadataArgs, {
      env: CLI_ENV, timeout: DOWNLOAD_TIMEOUT, maxBuffer: 16 * 1024 * 1024,
    });
    const metadata = JSON.parse(stdout);
    selectedLanguage = selectCaptionLanguageFromMetadata(metadata);
    sourceDuration = Number.isFinite(Number(metadata.duration)) ? Number(metadata.duration) : null;
  } catch (err) {
    console.log(`[asr] 字幕轨探测失败（${(err.message || '').slice(0, 160)}），改用精确语言兜底`);
  }

  const args = [
    '--skip-download', '--write-subs', '--write-auto-subs',
    // 禁止 en.*/zh.* 通配：它会把几十种自动翻译字幕全拉下来，实测容易触发 429。
    '--sub-langs', selectedLanguage || YOUTUBE_SUB_LANGS,
    '--sub-format', 'vtt/srt/best', '--no-playlist',
    '-o', join(workDir, 'sub.%(ext)s'), url,
  ];
  if (process.env.YOUTUBE_PROXY_URL) args.unshift('--proxy', process.env.YOUTUBE_PROXY_URL);
  try {
    await execYtDlp(args, { env: CLI_ENV, timeout: DOWNLOAD_TIMEOUT, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    const raw = (err.stderr || err.message || '').toString().trim();
    const errorLine = raw.split('\n').find(line => /^\s*ERROR[: ]/i.test(line));
    console.log(`[asr] 字幕拉取未完全成功（${(errorLine || raw).slice(0, 200)}），检查是否已落下可用字幕`);
  }
  const files = (await readdir(workDir)).filter(f => /\.(vtt|srt)$/i.test(f));
  if (!files.length) return { text: null, sourceDuration };
  // 优先中文字幕（含自动），其次英文
  const pick = files.sort((a, b) => (/(zh|Hans|Hant)/i.test(b) ? 1 : 0) - (/(zh|Hans|Hant)/i.test(a) ? 1 : 0))[0];
  const { readFile } = await import('fs/promises');
  const text = parseSubtitles(await readFile(join(workDir, pick), 'utf-8'));
  return { text: text.length >= 40 ? text : null, sourceDuration };
}

// 视频取全文 → { text, source:'captions'|'asr', truncated, language }。
// 字幕优先（快、准、无时长限制），拿不到才本地 ASR（full=true 时转全程）。失败上抛。
export async function transcribeVideo(url, { full = false } = {}) {
  const workDir = join(tmpdir(), 'kw-asr', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(workDir, { recursive: true });

  try {
    const captionResult = await fetchCaptions(url, workDir).catch(() => ({ text: null, sourceDuration: null }));
    if (captionResult.text) return { text: captionResult.text, source: 'captions', truncated: false, language: null };

    const maxSeconds = full ? FULL_AUDIO_SECONDS : MAX_AUDIO_SECONDS;
    const audioFile = await downloadAudio(url, workDir, { maxSeconds });
    const asr = await runTranscriber(audioFile, {
      diarize: false,
      maxSeconds,
      cloudChunkDir: full ? workDir : null,
    }); // 视频多为单人口播，不做分离；只有明确补全时才启用云端切块
    const truncated = Boolean(asr.truncated)
      || (captionResult.sourceDuration != null && captionResult.sourceDuration > maxSeconds)
      || (captionResult.sourceDuration == null && Number(asr.duration) >= maxSeconds - 2);
    return { ...asr, truncated, source: 'asr', maxSeconds };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
