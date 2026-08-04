// 读懂（原 KW 解读）插件冒烟测试（ADR-065 验证方式）：jsdom 模拟 x.com DOM → content.js 注入按钮
// → 点击 → 真实后端全流程（摄入走本地库秒回路径 + DeepSeek 流式解读）。
// 运行：node extension/smoke.mjs（需本机后端在跑；jsdom 复用 backend 依赖）
import { createRequire } from 'module';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'backend/package.json'));
const { JSDOM } = require('jsdom');

// 选一条本地库大概率已有的推文形态：从 DB 拿最近一条 tweet 的 URL，没有就退回硬编码示例
let tweetUrl = 'https://x.com/TencentHunyuan/status/2082655737541726636';
try {
  const Database = require('better-sqlite3');
  const db = new Database(join(root, 'backend/data/app.db'), { readonly: true });
  const row = db.prepare("select url from contents where content_type='tweet' and url like '%/status/%' order by created_at desc limit 1").get();
  if (row?.url) tweetUrl = row.url;
  db.close();
} catch { /* 用硬编码兜底 */ }
const path = new URL(tweetUrl).pathname;

const html = `<!DOCTYPE html><html><body>
<article data-testid="tweet">
  <div data-testid="User-Name">Smoke Author
@smoke</div>
  <a href="${path}"><time datetime="2026-07-29T10:00:00Z">7月29日</time></a>
  <div lang="en">Some tweet text here.</div>
</article></body></html>`;

const dom = new JSDOM(html, { url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.fetch = (u, o) => fetch(u, o);
window.TextDecoder = TextDecoder;
window.eval(await readFile(join(root, 'extension/content.js'), 'utf8'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(1200); // 等 MutationObserver/初始扫描（400ms 节流）

const btn = window.document.querySelector('.kw-jiedu-btn');
if (!btn) { console.log('FAIL: 「解读」按钮未注入'); process.exit(1); }
console.log(`✓ 按钮已注入（文案：${btn.textContent}），目标：${tweetUrl}`);

btn.click();
await sleep(500);
const shadow = window.document.getElementById('kw-panel-host')?.shadowRoot;
if (!shadow?.querySelector('.wrap')?.classList.contains('open')) { console.log('FAIL: 面板未打开'); process.exit(1); }
console.log('✓ 面板已滑出');

let bodyText = '', ok = false;
for (let i = 0; i < 60; i++) {
  await sleep(2000);
  bodyText = shadow.querySelector('.body').textContent;
  if (shadow.querySelector('.card.err')) { console.log('FAIL: 出现错误卡 →', bodyText.slice(0, 200)); process.exit(1); }
  if (/摘要/.test(bodyText) && bodyText.length > 300) { ok = true; break; }
}
console.log(`✓ 来源行：${shadow.querySelector('.src').textContent}`);
console.log(`✓ 面板内容 ${bodyText.length} 字，节选：\n  ${bodyText.replace(/\s+/g, ' ').slice(0, 240)}`);
console.log(ok ? 'SMOKE PASS：注入→点击→摄入→流式解读 全通' : 'SMOKE FAIL：解读内容未出现（超时）');
process.exit(ok ? 0 : 1);
