import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileP = promisify(execFile);

// ADR-046 P2b 配音（内容层之外的单独一步，用户主动触发才生成）：edge-tts 免费零 key 出音。
// 与预览层物理分开——预览(storyboard)不碰这里，只有点「加配音」才走。默认 edge-tts 免费，
// 音色不够再换火山(付费，需另配 key)。用 python3 -m edge_tts 子进程 + ffprobe 测真实时长。

// 可选中文音色（edge-tts 免费云端 neural voices）
export const TTS_VOICES = [
  { key: 'zh-CN-YunxiNeural', label: '云希（男·青年）' },
  { key: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女·温暖）' },
  { key: 'zh-CN-YunyangNeural', label: '云扬（男·播报）' },
  { key: 'zh-CN-XiaoyiNeural', label: '晓伊（女·活泼）' },
];
const DEFAULT_VOICE = 'zh-CN-YunxiNeural';
const isValidVoice = v => TTS_VOICES.some(x => x.key === v);

async function ffprobeDur(file) {
  try {
    const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    const d = parseFloat(String(stdout).trim());
    return Number.isFinite(d) ? d : null;
  } catch { return null; }
}

// 单段合成 → { base64, bytes, dur }。text 空/超长做保护；rate 可调（默认稍慢一点更稳）。
export async function synthesize(text, voice = DEFAULT_VOICE, rate = '+0%') {
  const t = String(text || '').trim();
  if (!t) throw new Error('文本为空');
  if (t.length > 600) throw new Error('单段文本过长（>600 字），先切短');
  const v = isValidVoice(voice) ? voice : DEFAULT_VOICE;
  const file = join(tmpdir(), `kw-tts-${Date.now()}-${Math.floor(Math.random() * 1e6)}.mp3`);
  try {
    // --write-media 落临时文件；edge-tts 直连微软免费端点，无需 key
    await execFileP('python3', ['-m', 'edge_tts', '--voice', v, '--rate', rate, '--text', t, '--write-media', file], { timeout: 60000 });
    const buf = await readFile(file);
    if (!buf.length) throw new Error('edge-tts 没有产出音频（可能网络受限）');
    const dur = await ffprobeDur(file);
    return { base64: `data:audio/mp3;base64,${buf.toString('base64')}`, bytes: buf.length, dur };
  } finally {
    unlink(file).catch(() => {});
  }
}

// 整支分镜配音：每镜 phrases 合成一段音频（与 build_voiced 一致：一镜一音、字幕按 phrase 切窗）。
// 顺序执行（免费但别打太满），单镜失败不拖垮整批、该镜返回 error。
export async function ttsScenes(scenes, voice = DEFAULT_VOICE, rate = '+0%') {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error('没有分镜');
  const out = [];
  for (const s of scenes) {
    const text = (Array.isArray(s.phrases) ? s.phrases : []).map(String).join('，').trim();
    if (!text) { out.push({ id: s.id, error: '空镜' }); continue; }
    try {
      const a = await synthesize(text, voice, rate);
      out.push({ id: s.id, audio: a.base64, dur: a.dur, bytes: a.bytes });
    } catch (e) { out.push({ id: s.id, error: e.message }); }
  }
  return out;
}
