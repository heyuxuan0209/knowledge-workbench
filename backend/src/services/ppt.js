import { spawn } from 'child_process';
import { mkdir, writeFile, readFile, readdir, stat, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD = join(__dirname, '../../ppt/build.mjs');
const OUT_DIR = join(__dirname, '../../data/ppt');

// ADR-086 会议纪要出片：渲染引擎在 backend/ppt/（资产层），产品代码只 spawn 它、不碰模板
// —— 沿用 cover.js 对 series/cover_render.py 的同一套分层。契约见 .claude/skills/html-ppt/SCHEMA.md。
//
// 为什么产物落盘而不是像头图那样回 base64：头图是要塞进文章里的图片，PPT 是要**投屏和转发**的，
// 得有个能点开的 URL。落 data/ppt/ 再由 /ppt/:name 暴露（tailnet 内，公网仍零端口）。

const KEEP_DAYS = 30;      // 产物保留天数，超期在下次出片时顺手清掉
const TIMEOUT_MS = 90_000; // build 内含最多 3 轮 playwright 复测，留足

function slugify(s) {
  return String(s || 'meeting')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'meeting';
}

/** 清掉过期产物（连同旁边的 .meta.json）。失败不抛——清理不该让出片失败。 */
async function sweep() {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 864e5;
    for (const f of await readdir(OUT_DIR)) {
      if (!f.endsWith('.html')) continue;
      const p = join(OUT_DIR, f);
      if ((await stat(p)).mtimeMs < cutoff) {
        await unlink(p);
        await unlink(p + '.meta.json').catch(() => {});
        await unlink(p + '.session.json').catch(() => {});
      }
    }
  } catch { /* 目录不存在或权限问题都不影响出片 */ }
}

const TYPE_LABEL = { meeting: '会议纪要', talk: '分享会 · DemoDay', chat: '对谈',
  interview: '用户访谈', myTalk: '我的分享' };

/**
 * 列出全部场次页，新的在前。
 * 元信息走产物旁边的 .meta.json —— 不去解析 HTML：那样既慢又会在改模板时静默失配。
 */
export async function listSessions() {
  const out = [];
  let files = [];
  try { files = await readdir(OUT_DIR); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith('.html')) continue;
    const p = join(OUT_DIR, f);
    let meta = {};
    try { meta = JSON.parse(await readFile(p + '.meta.json', 'utf8')); } catch { /* 老产物没有 meta，照样列出来 */ }
    let st = null;
    try { st = await stat(p); } catch { continue; }
    out.push({
      name: f,
      url: `/ppt/${encodeURIComponent(f)}`,
      title: meta.title || f.replace(/^\d{8}-\d{4}-/, '').replace(/\.html$/, '').replace(/-/g, ' '),
      type: meta.type || null,
      typeLabel: meta.type ? (TYPE_LABEL[meta.type] || meta.type) : '（未标注类型）',
      date: meta.date || null,
      duration: meta.duration || null,
      createdAt: meta.createdAt || new Date(st.mtimeMs).toISOString(),
      bytes: st.size,
    });
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

function runBuild(deckPath, outPath) {
  return new Promise((resolve, reject) => {
    const cp = spawn(process.execPath, [BUILD, deckPath, '-o', outPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { cp.kill('SIGKILL'); reject(new Error('出片超时（>90s）')); }, TIMEOUT_MS);
    cp.stdout.on('data', d => { out += d; });
    cp.stderr.on('data', d => { err += d; });
    cp.on('error', e => { clearTimeout(timer); reject(e); });
    cp.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        // build.mjs 拒绝出片时会把「第 N 页超出 X px」写进 stderr —— 原样透出，上游才知道该怎么改
        const msg = (err.match(/Error: (\[html-ppt\][\s\S]*?)(?:\n\s+at |\n$)/) || [])[1] || err.trim() || `退出码 ${code}`;
        return reject(new Error(msg));
      }
      resolve({ stdout: out.trim(), stderr: err.trim() });
    });
  });
}

/**
 * 把一场「场次」渲染成单文件 HTML（手机滚动 / 投屏翻页同一份），落盘并返回可访问路径。
 * @param {object} session  见 .claude/skills/html-ppt/SCHEMA.md（type + meta + blocks）
 * @returns {{ name:string, path:string, url:string, warnings:string[] }}
 */
export async function renderSession(session) {
  if (!session || typeof session !== 'object') throw new Error('缺少 session 数据');
  if (!Array.isArray(session.blocks) || !session.blocks.length)
    throw new Error('session.blocks 为空，没有可渲染的内容');
  if (session.slides) throw new Error('slides 是 v1 字段，v2 改用 blocks（见 SCHEMA.md）');
  const deck = session;

  await mkdir(OUT_DIR, { recursive: true });
  await sweep();

  // 用本地时间，不用 toISOString —— 后者带时区偏移，且 slice 会把数字从中间切断（曾产出 "2026-08-07234"）
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const meta = session.meta ?? {};
  const name = `${stamp}-${slugify(meta.title)}.html`;
  const outPath = join(OUT_DIR, name);
  return renderTo(session, outPath, name);
}

/**
 * 原地重渲染：取出存着的 session、改掉某一块、用同一个文件名重出。
 * URL 不变 —— 你已经发出去 / 收藏过的链接还是那一个。
 */
export async function rerenderSession(name, session) {
  if (name.includes('/') || name.includes('\\') || name.includes('..') || !name.endsWith('.html'))
    throw new Error('非法文件名');
  await mkdir(OUT_DIR, { recursive: true });
  return renderTo(session, join(OUT_DIR, name), name);
}

/** 读回某个产物的 session 源数据（要改哪一块，先取这个） */
export async function getSession(name) {
  if (name.includes('/') || name.includes('\\') || name.includes('..') || !name.endsWith('.html'))
    throw new Error('非法文件名');
  return JSON.parse(await readFile(join(OUT_DIR, name) + '.session.json', 'utf8'));
}

async function renderTo(session, outPath, name) {
  const meta = session.meta ?? {};
  // 源数据留在产物旁边——删了就只能整份重做，改一个块都要重来
  const deckPath = outPath + '.session.json';
  await writeFile(deckPath, JSON.stringify(session, null, 1), 'utf8');
  {
    const { stderr } = await runBuild(deckPath, outPath);
    // 降级过的页要让上游知道——不是错误，但值得在群消息里提一句
    const warnings = stderr.split('\n').map(s => s.trim()).filter(s => s.startsWith('[html-ppt]'));
    // 旁路存元信息，供 /ppt/ 索引页列表用（别去解析 HTML：慢，且改模板时会静默失配）
    await writeFile(outPath + '.meta.json', JSON.stringify({
      type: session.type ?? 'meeting', title: meta.title ?? null, date: meta.date ?? null,
      duration: meta.duration ?? null, createdAt: new Date().toISOString(),
    }), 'utf8').catch(() => {});
    return { name, path: outPath, url: `/ppt/${encodeURIComponent(name)}`, warnings };
  }
}

export { OUT_DIR };
