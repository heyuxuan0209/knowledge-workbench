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
// 只转前 15 分钟：实测 small 模型 CPU int8 约 3.2 倍速实时（240s 音频 75s 转完），
// 15 分钟 ≈ 等待 5 分钟，是"首次解读可接受等待"的上限；30 分钟档等待近 10 分钟放弃。
// B站 AI 类视频多为 5-15 分钟，绝大多数能完整覆盖。
export const MAX_AUDIO_SECONDS = 900;
const DOWNLOAD_TIMEOUT = 5 * 60000;
const TRANSCRIBE_TIMEOUT = 15 * 60000;

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

// 转写视频音频 → { text, language, truncated, duration }。失败上抛，调用方决定降级话术。
export async function transcribeVideo(url) {
  const workDir = join(tmpdir(), 'kw-asr', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(workDir, { recursive: true });

  try {
    const audioFile = await downloadAudio(url, workDir);
    const { stdout } = await pexec('python3', [
      join(__dirname, '../../scripts/transcribe.py'),
      audioFile,
      '--max-seconds', String(MAX_AUDIO_SECONDS),
    ], { env: CLI_ENV, timeout: TRANSCRIBE_TIMEOUT, maxBuffer: 32 * 1024 * 1024 });

    const result = JSON.parse(stdout);
    if (!result.text || result.text.length < 20) {
      throw new Error('转写结果为空（可能是纯音乐/无人声内容）');
    }
    return result;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
