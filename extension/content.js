// KW 解读 · 内容脚本（P1，接 ADR-064；选型见 prototype/mock-pages/x-interpret-mock-*）
// 形态：推文/视频旁注入「解读」按钮 → 右侧滑出卡片风面板 → 摄入+翻译 → 流式解读 → 追问/存灵感库。
// 依赖本机 KW 后端（launchd 常驻 :3000）；后端 CORS 全开，内容脚本直连即可，无需 background。

const KW = 'http://localhost:3000';
const IS_X = /(^|\.)(x|twitter)\.com$/.test(location.hostname);
const IS_YT = /(^|\.)youtube\.com$/.test(location.hostname);

// ---------- 面板（shadow DOM，与页面样式隔离） ----------
const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0;font-family:-apple-system,"PingFang SC",sans-serif}
.wrap{position:fixed;top:0;right:-460px;width:440px;height:100vh;background:#0d0f14;color:#e7e9ea;
  border-left:1px solid #2f3336;z-index:2147483000;display:flex;flex-direction:column;
  font-size:14px;line-height:1.6;transition:right .25s ease;box-shadow:-8px 0 32px rgba(0,0,0,.45)}
.wrap.open{right:0}
.head{padding:13px 16px;border-bottom:1px solid #2f3336;display:flex;align-items:center;gap:8px}
.head b{flex:1;font-size:15px}
.close{background:none;border:none;color:#71767b;font-size:17px;cursor:pointer;padding:2px 6px}
.src{padding:8px 16px;color:#71767b;font-size:12px;border-bottom:1px solid #2f3336;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.body{flex:1;overflow-y:auto;padding:14px 14px 4px}
.card{background:#16181c;border:1px solid #2f3336;border-radius:14px;padding:12px 14px;margin-bottom:12px}
.card h4{color:#b9a3ff;font-size:12px;letter-spacing:2px;margin-bottom:7px}
.card p{margin-bottom:8px}.card p:last-child{margin-bottom:0}
.card ul{margin-left:18px}.card li{margin-bottom:5px}
.card.err{border-color:#5c2a2a;background:#1c1113;color:#f0b8b8}
.stage{color:#71767b;font-size:13px;margin:4px 2px;display:flex;gap:8px;align-items:center}
.stage.on{color:#e7e9ea}
.dot{width:7px;height:7px;border-radius:50%;background:#3d4148;flex:none}
.on .dot{background:#7c5cff;animation:pulse 1s infinite}
@keyframes pulse{50%{opacity:.35}}
.clamp{max-height:190px;overflow:hidden;position:relative}
.more{color:#1d9bf0;background:none;border:none;cursor:pointer;font-size:13px;padding:4px 0 0}
.quotebox{border-left:3px solid #7c5cff;background:#16121f;border-radius:0 8px 8px 0;padding:6px 10px;margin:6px 0}
.foot{border-top:1px solid #2f3336;padding:10px 14px}
.row{display:flex;gap:8px;margin-bottom:8px}
.row:last-child{margin-bottom:0}
input{flex:1;background:#16181c;border:1px solid #2f3336;border-radius:999px;padding:8px 14px;color:#e7e9ea;font-size:13px;outline:none}
input:focus{border-color:#7c5cff}
.btn{border-radius:999px;border:1px solid #2f3336;background:none;color:#e7e9ea;padding:7px 14px;font-size:13px;cursor:pointer;white-space:nowrap}
.btn.p{border-color:#7c5cff;color:#b9a3ff}
.btn.p.done{background:#7c5cff;color:#fff}
.btn.send{background:#1d9bf0;border-color:#1d9bf0;color:#fff;padding:7px 16px}
.hint{color:#71767b;font-size:11px;text-align:center;margin-top:6px}
`;

let host, ui = {}, state = null; // state: {url, data, chat:[], streaming}

function ensurePanel() {
  if (host) return;
  host = document.createElement('div');
  host.id = 'kw-panel-host';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = CSS; root.appendChild(style);
  const wrap = document.createElement('div'); wrap.className = 'wrap'; root.appendChild(wrap);
  wrap.innerHTML = `
    <div class="head">⚡ <b>KW 解读</b><button class="close">✕</button></div>
    <div class="src"></div>
    <div class="body"></div>
    <div class="foot">
      <div class="row"><input class="feel" placeholder="一句感想（写了会立为灵感）…"><button class="btn p save">☆ 存灵感库</button></div>
      <div class="row"><input class="ask" placeholder="就这条内容追问…"><button class="btn send">↑</button></div>
      <div class="hint">KW · knowledge-workbench 本机后端</div>
    </div>`;
  ui = {
    wrap,
    src: wrap.querySelector('.src'),
    body: wrap.querySelector('.body'),
    feel: wrap.querySelector('.feel'),
    save: wrap.querySelector('.save'),
    ask: wrap.querySelector('.ask'),
  };
  wrap.querySelector('.close').onclick = () => wrap.classList.remove('open');
  ui.save.onclick = saveNote;
  wrap.querySelector('.send').onclick = sendAsk;
  ui.ask.addEventListener('keydown', e => { if (e.key === 'Enter') sendAsk(); });
  document.documentElement.appendChild(host);
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 极简 markdown：**粗体**、- 列表、「金句」引块、空行分段。解读产物结构简单，够用。
function md(text) {
  const lines = String(text || '').split('\n');
  let html = '', list = false;
  for (const raw of lines) {
    const line = esc(raw.trim()).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    if (/^[-•]\s+/.test(line)) { if (!list) { html += '<ul>'; list = true; } html += `<li>${line.replace(/^[-•]\s+/, '')}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (!line) continue;
    if (/^[「“]/.test(line)) { html += `<div class="quotebox">${line}</div>`; continue; }
    html += `<p>${line}</p>`;
  }
  if (list) html += '</ul>';
  return html;
}

function card(title, innerHtml, extraClass = '') {
  const d = document.createElement('div');
  d.className = `card ${extraClass}`;
  d.innerHTML = (title ? `<h4>${esc(title)}</h4>` : '') + innerHtml;
  ui.body.appendChild(d);
  return d;
}

// 长文卡（全稿）默认折叠
function clampCard(title, text) {
  const c = card(title, `<div class="clamp">${md(text)}</div><button class="more">展开全文 ▾</button>`);
  const btn = c.querySelector('.more'), box = c.querySelector('.clamp');
  if (box.scrollHeight <= 200) { btn.remove(); box.classList.remove('clamp'); return c; }
  btn.onclick = () => {
    const open = !box.classList.contains('clamp');
    box.classList.toggle('clamp', open);
    btn.textContent = open ? '展开全文 ▾' : '收起 ▴';
  };
  return c;
}

// ---------- 主流程 ----------
const STAGE_HINTS = [
  [0, '连接本机 KW 后端…'],
  [1200, '抓取内容（推文正文 / 字幕 / 网页正文）…'],
  [8000, '内容含视频的话：下载音轨 + Groq 转写（长视频约 1-2 分钟）…'],
  [30000, '翻译成中文（DeepSeek）…'],
];

async function openPanel(url, srcLabel) {
  ensurePanel();
  ui.wrap.classList.add('open');
  ui.src.textContent = srcLabel || url;
  ui.body.innerHTML = '';
  ui.save.classList.remove('done'); ui.save.textContent = '☆ 存灵感库'; ui.feel.value = '';
  state = { url, data: null, chat: [], streaming: false };

  const stageBox = card(null, '');
  const timers = STAGE_HINTS.map(([t, text], i) => setTimeout(() => {
    [...stageBox.querySelectorAll('.stage')].forEach(s => s.classList.remove('on'));
    const d = document.createElement('div'); d.className = 'stage on';
    d.innerHTML = `<span class="dot"></span>${esc(text)}`;
    stageBox.appendChild(d);
  }, t));

  let res;
  try {
    const r = await fetch(`${KW}/api/content/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: url }),
    });
    res = await r.json();
  } catch {
    timers.forEach(clearTimeout); stageBox.remove();
    card('连接失败', '<p>连不上本机 KW 后端（localhost:3000）。确认这台 Mac 上的 knowledge-workbench 后端在运行。</p>', 'err');
    return;
  }
  timers.forEach(clearTimeout); stageBox.remove();

  if (!res.success || res.data?.fetchStatus !== 'success') {
    card('抓取失败', `<p>${esc(res.data?.fetchError || res.error || '未知原因')}</p>`, 'err');
    return;
  }
  const d = res.data; state.data = d;

  const m = d.metadata || {};
  const srcBits = [m.author, m.platform, m.publishedAt, d.note].filter(Boolean).join(' · ');
  if (srcBits) ui.src.textContent = srcBits;
  if (d.zhTitle || d.title) card('标题', `<p><b>${esc(d.zhTitle || d.title)}</b></p>`);
  clampCard(d.hasTranslation ? '中文全稿' : '全文', d.zhBody || d.body);
  await runInterpret();
}

const INTERPRET_PROMPT = '请解读这份材料，输出三部分（用【摘要】【要点】【金句】做小标题）：'
  + '【摘要】3 句以内讲清这条内容说了什么、为什么值得看；'
  + '【要点】3-6 条，每条一句话，信息密度高；'
  + '【金句】1-2 条最有力的原话，先中文翻译、括号附英文原文。'
  + '直接输出内容，不要客套和前言。';

async function runInterpret() {
  state.chat = [{ role: 'user', content: INTERPRET_PROMPT }];
  const c = card('解读', '<p style="color:#71767b">生成中…</p>');
  const text = await streamChat(state.chat, c);
  if (text) state.chat.push({ role: 'assistant', content: text });
}

async function sendAsk() {
  const q = ui.ask.value.trim();
  if (!q || !state?.data || state.streaming) return;
  ui.ask.value = '';
  card('你问', `<p>${esc(q)}</p>`);
  state.chat.push({ role: 'user', content: q });
  const c = card('回答', '<p style="color:#71767b">思考中…</p>');
  const text = await streamChat(state.chat, c);
  if (text) state.chat.push({ role: 'assistant', content: text });
}

// POST SSE：fetch 流式读取（EventSource 不支持 POST）。事件：meta/content/done/error。
async function streamChat(messages, cardEl) {
  state.streaming = true;
  let full = '';
  const target = () => { cardEl.innerHTML = `<h4>${cardEl.querySelector('h4')?.textContent || '解读'}</h4>` + md(full); };
  try {
    const r = await fetch(`${KW}/api/chat/ephemeral`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adHocContents: [state.data], messages }),
    });
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split('\n\n'); buf = events.pop();
      for (const ev of events) {
        const line = ev.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        let msg; try { msg = JSON.parse(line.slice(6)); } catch { continue; }
        if (msg.type === 'content') { full += msg.content; target(); ui.body.scrollTop = ui.body.scrollHeight; }
        if (msg.type === 'error') { full += `\n（出错：${msg.error}）`; target(); }
      }
    }
  } catch (e) {
    cardEl.innerHTML = `<p>解读失败：${esc(e.message)}</p>`; cardEl.classList.add('err');
  }
  state.streaming = false;
  return full;
}

// 存灵感库＝按「有没有写感想」智能分流（ADR-066，用户裁决）：
// 感想是分流信号——写了 = 用户有自己的想法 → ideas（灵感页）+ notes 挂料（火候生效）；
// 没写 = 只是先收着 → 仅 notes（素材库），别拿剪藏淹掉灵感看板的真火种。
// 反馈文案按实际落点说话，不统称"灵感库"（按钮上的动词必须落到用户能看见的名词上）。
async function saveNote() {
  if (!state?.data || ui.save.classList.contains('done')) return;
  const d = state.data, m = d.metadata || {};
  const feel = ui.feel.value.trim();
  const summary = (state.chat.find(x => x.role === 'assistant')?.content || d.zhBody || d.body || '').slice(0, 500);
  const excerpt = `【灵感卡·启发】${feel || (d.zhTitle || d.title || '一条值得记的内容')}\n【来源】${[m.author, m.platform].filter(Boolean).join(' @ ')} — ${state.url}\n【解读摘录】${summary}`;
  try {
    const r = await fetch(`${KW}/api/notes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excerpt, noteType: 'insight', sourceTitle: d.zhTitle || d.title || m.author || 'X/YouTube 内容', sourceUrl: state.url }),
    });
    const res = await r.json();
    if (!res.success) throw new Error(res.error || '保存失败');

    if (!feel) {
      ui.save.classList.add('done'); ui.save.textContent = '✓ 已存素材库';
      return;
    }
    const ideaBody = [`感想：${feel}`,
      `来源：${[m.author, m.platform].filter(Boolean).join(' @ ')} — ${state.url}`,
      `解读摘要：${summary.slice(0, 300)}`].join('\n');
    const r2 = await fetch(`${KW}/api/ideas`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: feel.slice(0, 40), body: ideaBody, sourceKind: 'user', sourceRef: state.url,
        supportingNoteIds: [res.data?.id].filter(Boolean) }),
    });
    const res2 = await r2.json();
    if (!res2.success) throw new Error(res2.error || 'ideas 保存失败');
    ui.save.classList.add('done'); ui.save.textContent = '✓ 已存灵感 + 挂料';
  } catch (e) {
    ui.save.textContent = `存失败：${e.message.slice(0, 20)}`;
  }
}

// ---------- 按钮注入 ----------
function makeBtn(onClick) {
  const b = document.createElement('button');
  b.textContent = '解读';
  b.className = 'kw-jiedu-btn';
  b.style.cssText = 'background:#7c5cff;color:#fff;border:none;border-radius:999px;padding:3px 12px;'
    + 'font-size:12px;font-weight:600;cursor:pointer;line-height:1.6;z-index:100;';
  b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return b;
}

const seen = new WeakSet();

function scanX() {
  document.querySelectorAll('article[data-testid="tweet"]').forEach(a => {
    if (seen.has(a)) return;
    seen.add(a);
    // 推文永久链接：带 <time> 的 status 链接；详情页主推文没有 → 用当前地址
    const link = [...a.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector('time'));
    const url = link ? new URL(link.getAttribute('href'), location.origin).href
      : (/\/status\/\d+/.test(location.pathname) ? location.origin + location.pathname : null);
    if (!url) return;
    const author = a.querySelector('[data-testid="User-Name"]')?.innerText?.split('\n')[0];
    const btn = makeBtn(() => openPanel(url, author ? `${author} · X` : url));
    btn.style.position = 'absolute';
    btn.style.top = '8px';
    btn.style.right = '42px'; // 让开右上角的 ⋯ 菜单
    if (getComputedStyle(a).position === 'static') a.style.position = 'relative';
    a.appendChild(btn);
  });
}

function scanYT() {
  if (!/^\/watch/.test(location.pathname)) return;
  const title = document.querySelector('ytd-watch-metadata #title h1')
    || document.querySelector('#above-the-fold #title');
  if (!title || title.querySelector('.kw-jiedu-btn')) return;
  const btn = makeBtn(() => {
    const u = new URL(location.href);
    const clean = `${u.origin}/watch?v=${u.searchParams.get('v')}`;
    openPanel(clean, (title.textContent || '').trim().slice(0, 40) + ' · YouTube');
  });
  btn.style.marginLeft = '10px';
  btn.style.verticalAlign = 'middle';
  title.appendChild(btn);
}

let scanQueued = false;
function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  setTimeout(() => { scanQueued = false; if (IS_X) scanX(); if (IS_YT) scanYT(); }, 400);
}

new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
if (IS_YT) document.addEventListener('yt-navigate-finish', scheduleScan);
scheduleScan();
