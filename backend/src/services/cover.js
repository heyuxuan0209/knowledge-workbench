import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COVER_SCRIPT = join(__dirname, '../../series/cover_render.py');

// ADR-052 P1 头图：AI 观察手记系列的确定性头图引擎（reference/series-template/render_cover.py，资产层）。
// 产品代码只 spawn python wrapper 出图，不碰皮肤/模板。契约 INTEGRATION-SPEC.md §1/§2。

// StylePreset：一个预设绑「头图皮肤 + 正文主题 + 默认声音」；P1 只用 cover_skin。
export const SERIES_PRESETS = [
  { id: 'ticket-brisk', name: '摸鱼绿系 · 轻快犀利', cover_skin: 'moyu-green', article_theme: 'moyu-ticket', default_voice: 'brisk' },
  { id: 'olive-deep', name: '橄榄手记 · 沉稳深度', cover_skin: 'olive-journal', article_theme: 'olive-journal', default_voice: 'deep' },
];

// 把 JSON 从 stdin 喂给 python 子进程，收 stdout（同 tts 的 python 子进程模式）。60s 超时防 Playwright 挂死。
function runPython(script, input) {
  return new Promise((resolve, reject) => {
    const cp = spawn('python3', [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { cp.kill('SIGKILL'); reject(new Error('头图渲染超时（>60s）')); }, 60000);
    cp.stdout.on('data', d => { out += d; });
    cp.stderr.on('data', d => { err += d; });
    cp.on('error', e => { clearTimeout(timer); reject(e); });
    cp.on('close', code => {
      clearTimeout(timer);
      if (!out) return reject(new Error(err.trim() || `python 退出码 ${code}`));
      resolve(out);
    });
    cp.stdin.write(JSON.stringify(input));
    cp.stdin.end();
  });
}

export async function renderCover(skin, content) {
  if (!skin) throw new Error('缺少头图皮肤 skin');
  const raw = await runPython(COVER_SCRIPT, { skin, content: content || {} });
  let j;
  try { j = JSON.parse(raw); } catch { throw new Error('头图引擎返回非 JSON：' + raw.slice(0, 200)); }
  if (!j.ok) throw new Error(j.error || '头图渲染失败');
  return j.shapes; // { wide:{base64,w,h}, square:{base64,w,h} }
}
