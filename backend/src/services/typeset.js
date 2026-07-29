import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chat } from './llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERIES = join(__dirname, '../../../reference/series-template');
const VENDOR = join(SERIES, 'vendor');
const CHECK = join(__dirname, '../../series/typeset_check.py');

// ADR-052 P2 排版引擎（vendored gzh-design）：定稿 md + 主题 → 合规公众号 section HTML。
// 排版不是纯函数：LLM 装配（读 SKILL + 组件库） + 校验脚本兜底（fix_quotes → validate，0/0 才算完）。
// 只读 vendor 资产，不改。契约 INTEGRATION-SPEC.md §3。

// 已注册主题（同 theme-index.md；key = 组件库文件去 theme- 前缀/.md 后缀）
export const ARTICLE_THEMES = [
  { key: 'olive-journal', name: '橄榄手记', hint: '内刊手记/深度评测/案例复盘（系列启用）' },
  { key: 'moyu-ticket', name: '摸鱼票据风', hint: '测评/工具对比/创意评测（系列启用）' },
  { key: 'moyu-green', name: '摸鱼绿', hint: '教程/清单/工具盘点，信息密度高' },
  { key: 'red-white', name: '红白色系', hint: '深度分析/观点/力量感' },
  { key: 'graphite-minimal', name: '石墨极简', hint: '设计/科技评论/高端' },
  { key: 'zen-whitespace', name: '留白禅意', hint: '随笔/极简/呼吸感' },
];

function readVendor(rel) {
  const p = join(VENDOR, rel);
  if (!existsSync(p)) throw new Error(`vendor 缺文件：${rel}`);
  return readFileSync(p, 'utf-8');
}

const RED_LINE = `【平台红线·硬约束】只输出从 <section> 开始的**纯正文片段 HTML**（不要 <!DOCTYPE>/<html>/<head>/<body>，不要 markdown 代码围栏，不要任何解释文字）。
- 禁用：<style>/<script>/<div>、class/id 属性、position:fixed|absolute|sticky、float、@media/@keyframes/@import、display:grid、CSS 变量 var(--x)、外部字体/CSS。
- 必须：样式全内联 style；**每一个文字节点都用 <span leaf="">文字</span> 包裹**（否则粘贴到公众号样式整片丢失）。
- 中文标点一律全角、弯引号 “”‘’（代码/英文专名/URL 内除外）。
- 每个正文段落主动挑 1–3 个关键短语加"正文下划线"（用所选主题在 theme-index 里的下划线 CSS）。`;

// 拼装 prompt：SKILL 流程 + 主题索引 + 该主题组件库 + 通用增量库 + 定稿 → 产出 section HTML
function buildAssemblyPrompt(articleMd, themeKey) {
  const theme = ARTICLE_THEMES.find(t => t.key === themeKey);
  if (!theme) throw new Error(`未知排版主题「${themeKey}」（可用：${ARTICLE_THEMES.map(t => t.key).join('/')}）`);
  const skill = readVendor('SKILL.md');
  const index = readVendor('references/theme-index.md');
  const lib = readVendor(`references/theme-${themeKey}.md`);
  const common = readVendor('references/common-components.md');
  // 日期从系统注入、禁止 LLM 生成（ADR-041 同款：模型默认年份会烂，装配出过"2025"装饰字）
  const now = new Date();
  const todayLine = `今天日期：${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}（系统注入）。组件里任何年份/日期类装饰字段（如报头年份、进度、日期角标），一律用这个日期取值；定稿正文里没写日期的地方，禁止自行编造任何年份。`;
  // 头图卡标题红线：头图给"还没读正文的人"看，别塞只有读完才懂的黑话（曾把标题改成"原料采购台的四次校准"、摘要塞回作者已删的"推倒重来"）
  const headCardRule = `【头图卡标题·硬约束】头图卡（报头/开篇那个组件）的主标题、强调词、副标题、底部摘要，是给**还没读正文的人**看的封面，必须做到：
- **主标题优先直接用定稿第一行的平台标题**；确需为封面另拟更短的钩子，也必须"没读过正文的人也一眼看懂"。
- **严禁把只有读完正文才成立的内部比喻、自造概念、代号搬进头图任何字段**（例：正文里把信息流叫"原料采购台"是读到那句才懂的比喻，不能直接印在封面当标题）。宁可朴素直白，不要生动黑话。
- **头图任何字段不得与平台标题的说法/立场相矛盾**（例：标题说"改了四次/四次校准"，摘要就不能说"推倒重来"）。
- 强调词（加下划线那个）只从平台标题里挑真实出现的关键词，不要自造词。
- 不得引入定稿正文里没有的夸张营销话。`;
  // 尾部作者签名：按文章类型二选一，逐字用（用户定的两类签名）
  const signatureRule = `【尾部作者签名·硬约束】文末作者签名区（"我是杰西卡…"那句）按文章类型二选一、**逐字使用、不要自行改写**，签名区仅末尾一处：
- 若是**第一人称的踩坑 / 复盘 / 成长手记**（作者在讲自己做 AI 产品或项目踩过的坑、思考、成长）：
  「我是杰西卡，为你分享我做 AI 产品踩过的坑和经验，记录自己的成长和思考，写给"上个月还不知道这些的自己"，也写给同频的你。」
- 若是**精读 / 解读他人内容的现场手记、观察手记**（在解读一线 AI builder 的演讲、观察、一手干货）：
  「我是杰西卡，为你精读海内外一线 AI builder 的一手观察与干货。」
判断依据看正文：主体在讲"我自己怎么做、踩了什么坑"=用第一句；主体在讲"某人/某场演讲/某篇内容说了什么、我来精读"=用第二句。`;
  // 编者按长则分段：EDITOR'S NOTE 一大段读着累
  const editorsNoteRule = `【编者按可读性】编者按（EDITOR'S NOTE，那个深色标题条 + 浅底正文的组件）的正文若较长（超过约 3 句 / 80 字），**拆成 2–3 个短段落**——在浅底正文那层放多个 <p>（每个 <p> 的 style 与组件模板里那个 <p> 完全一致、各承一段），按语义分层，别挤成一整坨。正文短则保持单段。`;
  return `你是公众号排版装配器。把下面「定稿 Markdown」按所选主题的组件库装配成可直接粘贴公众号的合规 HTML。HTML 一律从组件库取、不要凭记忆手写。

${todayLine}

${headCardRule}

${signatureRule}

${editorsNoteRule}

${RED_LINE}

════════ 排版流程与规则（SKILL）════════
${skill}

════════ 主题索引（下划线 CSS 取值以此为权威）════════
${index}

════════ 所选主题组件库：${theme.name}（${themeKey}）════════
${lib}

════════ 通用增量库（代码块/图片/小标签，所有主题共用）════════
${common}

════════ 定稿 Markdown（第一行是标题，是平台标题、不进正文）════════
${articleMd.slice(0, 9000)}

现在装配。**只输出 <section>…</section> 正文片段本身**，不要解释、不要代码围栏。`;
}

function stripFences(s) {
  return String(s || '').replace(/^```(html)?\s*/i, '').replace(/```\s*$/, '').trim();
}

// fix_quotes + validate（一次 python 调用）→ { html, errors, warnings, leaf }
function checkAndFix(html) {
  return new Promise((resolve, reject) => {
    const cp = spawn('python3', [CHECK], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { cp.kill('SIGKILL'); reject(new Error('校验超时')); }, 30000);
    cp.stdout.on('data', d => { out += d; });
    cp.stderr.on('data', d => { err += d; });
    cp.on('error', e => { clearTimeout(timer); reject(e); });
    cp.on('close', () => {
      clearTimeout(timer);
      try { const j = JSON.parse(out); j.ok ? resolve(j) : reject(new Error(j.error || '校验失败')); }
      catch { reject(new Error('校验器返回非 JSON：' + (err || out).slice(0, 200))); }
    });
    cp.stdin.write(html); cp.stdin.end();
  });
}

// 排版主流程：装配 → fix+validate；有 ERROR/WARNING 就带着校验反馈让 LLM 修，最多重试 2 轮。
export async function typeset(articleMd, themeKey) {
  if (!articleMd?.trim()) throw new Error('定稿为空');
  const prompt = buildAssemblyPrompt(articleMd, themeKey);
  let totalCost = 0;
  const first = await chat([{ role: 'user', content: prompt }]);
  if (!first.success) throw new Error(`LLM 装配失败: ${first.error}`);
  totalCost += first.cost || 0;
  let html = stripFences(first.content);
  let check = await checkAndFix(html);
  html = check.html;

  for (let i = 0; i < 2 && (check.errors.length || check.warnings.length); i++) {
    const fb = `上一版排版校验没通过，请修复后重新输出**完整** section HTML（同样红线：纯片段、每个文字节点 span leaf、全角标点）。
${check.errors.length ? 'ERROR（必须修）：\n- ' + check.errors.join('\n- ') : ''}
${check.warnings.length ? 'WARNING（也要修到 0）：\n- ' + check.warnings.join('\n- ') : ''}

当前 HTML：
${html}`;
    const fix = await chat([{ role: 'user', content: fb }]);
    if (!fix.success) break;
    totalCost += fix.cost || 0;
    html = stripFences(fix.content);
    check = await checkAndFix(html);
    html = check.html;
  }
  return { html, errors: check.errors, warnings: check.warnings, leaf: check.leaf, theme: themeKey, cost: totalCost };
}
