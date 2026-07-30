// 一次性批处理（2026-07-30）：发布记录表回填发布链接（38 条小红书 + 8 条公众号）+ 上传本地物料到附件字段。
// 匹配规则：标题归一化（去空白/标点/emoji）后前缀或包含，要求唯一命中；0 命中或多命中一律跳过并报告，不猜。
// 已有链接的行：相同则跳过，不同则报告冲突、不覆盖。
import 'dotenv/config';
import { readFileSync } from 'fs';
import { basename, join } from 'path';

const APP = 'QIlkbwmGma9Tb1sRyAicfZeEnjb';
const PUB_TID = 'tblL11CZzfQSxIy9';
const HOME = process.env.HOME;
const EV = join(HOME, 'Documents/项目/writing/events/2026-07-25-飞书AI绝活大会/05-我的产出');
const PB = join(HOME, 'Documents/项目/writing/published');

const { feishuFetch, getTenantAccessToken, feishuBase } = await import('../src/services/feishu-auth.js');

const norm = (s) => (s || '').replace(/[\s，。、·「」《》“”‘’""''？！?!,.:：（）()【】\-—=~～✅🚀🖼️\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');

// ── 链接清单（标题片段来自用户消息，截断处原样保留）─────────────────
const XHS = [
  ['她开会没带 PPT，只带了一个 agent', '2lM36rfKvKh'],
  ['跟AI 拉扯十几轮的需求，多半不该用嘴解决', '3WLuMM6LWuW'],
  ['在 AI 时代，做个人吧', '78Pt9NcCkrr'],
  ['飞书AI绝活大会上，他戴着安全帽上台', '9e2sjNqpIxw'],
  ['和AI合作，最关键是把需求说清楚？错！', '1Dhd0Iyg02X'],
  ['AI 早就够强了，是我们把它拴住了', '9yNXkWcbfL8'],
  ['文字聊三天，不如HTML点三下', '7Ho96AZA9mi'],
  ['AI 画图每次都在抽卡？一篇讲清为什么', 'ArCiVkrrO1Y'],
  ['收藏 = 稍后读 = 永远不读，直到我做了它', '4tqA5Brypoh'],
  ['Anthropic教你和AI协作的六个技巧', '1uqdvAOMHi3'],
  ['别再逼自己"把需求想清楚"了', 'AwtItpb9lfB'],
  ['Harness 落地全指南｜亲测30天见效', '5C5IfU57IVp'],
  ['✅Harness落地全指南｜亲测30天见效', '6dcItD8RL1Y'],
  ['AI Agent从0到1设计全流程指南', 'AiZFjRiWude'],
  ['Agent命中率从30%到80%，我复盘了这套SOP', '1JOef1ic3Im'],
  ['RAG从0-1-进阶篇（混合检索策略）', 'ILbHnsnp2L'],
  ['RAG入门篇-从原理到实践', '7hGn6HXOea'],
  ['RAG 0-1全攻略教程，从概念到实战到优化', 'Q1nH1H58hI'],
  ['别再手动搬运，Claude一键脚本自动整理文档', '7rdZNIDfDkq'],
  ['拒绝重复调教！Claude多窗口协作终极方案', '5PEK1F64UPQ'],
  ['告别重复造轮子！手把手教你Claude Skills', '9eSBnekhUv3'],
  ['Token 激降 87%！Claude Code 文档 12分类', '1gj6xsubFUD'],
  ['Claude烧钱心碎？这招让 Token 消耗降低80%', 'AckteMyBXIX'],
  ['小白必看！🚀 手把手教你用Gemini Gems定', '4nr0aRHpio7'],
  ['零代码适配术 (4/4)：网页秒变App！', '4kkw0j7rbLs'],
  ['零代码适配术 (3/4)：网页秒变App！', '1DbhxZoe2zo'],
  ['4/4:自动化部署启动就报错？主包教你排雷', '9jXLiWtZMTk'],
  ['零代码适配术 (1/4)：PC 网页秒变 App！', '3UakPsiI1n0'],
  ['2/4:自动化部署启动就报错？主包教你排雷', 'AgUekSSOvsO'],
  ['3/4:自动化部署启动就报错？主包教你排雷', 'G0yNYl8mhe'],
  ['告别手动部署，Gemini AI自动化流水线启动4', '6eHDU4xY7Ec'],
  ['告别手动部署，Gemini AI自动化流水线启动3', '1KU3s4NNMUl'],
  ['Gemini零代码实战4：30分钟AI搭建飞书应用', '5GBt8GWipfw'],
  ['告别手动部署，Gemini AI自动化流水线启动1', '73vHRwkTesf'],
  ['Gemini零代码实战2：30分钟AI搭建飞书应用', '4WE2AEQJ8Dr'],
  ['Gemini零代码实战3：30分钟AI搭建飞书应用', '50x2QN0fo4H'],
  ['Gemini零代码实战1：30分钟AI搭建飞书应用', 'pyaFVNGg38'],
].map(([t, id]) => ({ t, url: `http://xhslink.cn/o/${id}`, platform: '小红书' }));

const WX = [
  ['有些需求，天生说不清', 'K9t1P6SaO0Bwlo2khO43xg'],
  ['当所有人都能做到 80 分', 'ORSw3MRdgn3dbwfE92ys2w'],
  ['AI 大会上，他戴着安全帽上台', '_X7cuARgdmdNZ-68V5g6yQ'],
  ['她开会没带 PPT，只带了一个 agent', 'xO1FfvZuazfKHhIhx3-4sQ'],
  ['当“造东西”不再稀缺，产品人还剩下什么', '2PRV0Y9-HWfJgAo7y3FBrw'],
  ['AI 早就够强了，是我们把它拴住了', 'aCpTVy8ifztEbFLcPbeb3A'],
  ['和 AI 高效协作，可能"说清楚"只对了一半', 'akZzzcSb27Wuvc5PrS1kSQ'],
  ['我的收藏夹从「稍后读」变成了「已读懂」：一个开源小工具的诞生', 's5Q8wZU85Wxt0tlJC_Ng4w'],
].map(([t, id]) => ({ t, url: `https://mp.weixin.qq.com/s/${id}`, platform: '公众号' }));

// ── 物料清单（行匹配键 = [平台, 标题片段]）────────────────────────
const MATERIALS = [
  { p: '公众号', t: '她开会没带 PPT', files: [join(EV, '排版HTML/篇一_排版_橄榄手记.html'), join(EV, '封面与配图/篇一_头图_橄榄手记_wide.png'), join(EV, '封面与配图/篇一_头图_橄榄手记_square.png')] },
  { p: '公众号', t: 'AI 大会上，他戴着安全帽上台', files: [join(EV, '排版HTML/篇二_排版_橄榄手记.html'), join(EV, '封面与配图/篇二_头图_橄榄手记_wide.png'), join(EV, '封面与配图/篇二_头图_橄榄手记_square.png')] },
  { p: '公众号', t: '当所有人都能做到 80 分', files: [join(EV, '排版HTML/篇三_排版_橄榄手记.html'), join(EV, '封面与配图/篇三_头图_橄榄手记_wide.png'), join(EV, '封面与配图/篇三_头图_橄榄手记_square.png')] },
  { p: '小红书', t: '她开会没带 PPT', files: [join(EV, '封面与配图/封面/篇一封面-母图.png')] },
  { p: '小红书', t: '飞书AI绝活大会上，他戴着安全帽上台', files: [join(EV, '封面与配图/封面/篇二封面-母图.png')] },
  { p: '小红书', t: '在 AI 时代，做个人吧', files: [join(EV, '封面与配图/封面/篇三封面-母图.png')] },
  { p: '公众号', t: '有些需求，天生说不清', files: [join(PB, '2026-07-29-有些需求，天生说不清楚/有些需求AI 天生听不懂.html'), join(PB, '2026-07-29-有些需求，天生说不清楚/头图母图1800x1986.png')] },
  { p: '公众号', t: 'AI 早就够强了', files: [join(PB, '2026-07-24-AI 早就够强了，是我们把它拴住了/公众号排版版-AI 早就够强了，是我们把它拴住了.html')] },
  { p: '公众号', t: '和 AI 高效协作', files: [join(PB, '2026-07-21-说清楚只对了一半/和 AI 高效协作，可能"说清楚"只对了一半0721.html'), join(PB, '2026-07-21-说清楚只对了一半/素材/公众号封面-金句版.png')] },
  { p: '小红书', t: 'AI 画图每次都在抽卡', files: [1, 2, 3, 4, 5, 6, 7].map(n => join(PB, '2026-07-21-AI画图为什么总不听话/小红书', `card-${n}.png`)) },
];

const retry = async (fn, n = 3) => { for (let i = 1; ; i++) { try { return await fn(); } catch (e) { if (i >= n) throw e; await new Promise(r => setTimeout(r, 3000 * i)); } } };

// 拉全表
const rows = [];
let pt = '';
do {
  const d = await retry(() => feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${PUB_TID}/records`, { query: { page_size: 100, page_token: pt || undefined } }));
  rows.push(...(d.items || [])); pt = d.has_more ? d.page_token : '';
} while (pt);

const findRow = (platform, snippet) => {
  const ns = norm(snippet.replace(/\.\.\.$/, ''));
  const hits = rows.filter(r => r.fields?.['平台'] === platform && (norm(r.fields?.['平台化标题']).startsWith(ns) || norm(r.fields?.['平台化标题']).includes(ns) || ns.includes(norm(r.fields?.['平台化标题']))));
  return hits.length === 1 ? hits[0] : { ambiguous: hits.length };
};

// ── 1. 回填链接 ──
console.log('===== 链接回填 =====');
const report = { filled: 0, same: 0, conflict: [], unmatched: [] };
for (const item of [...XHS, ...WX]) {
  const row = findRow(item.platform, item.t);
  if (!row.record_id) { report.unmatched.push(`[${item.platform}] ${item.t} (命中${row.ambiguous})`); continue; }
  const cur = row.fields?.['链接']?.link;
  if (cur === item.url) { report.same++; continue; }
  if (cur && cur !== item.url) { report.conflict.push(`[${item.platform}] ${row.fields['平台化标题']}: 现有 ${cur} vs 新 ${item.url}`); continue; }
  await retry(() => feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${PUB_TID}/records/${row.record_id}`, {
    method: 'PUT', body: { fields: { '链接': { link: item.url, text: item.platform === '小红书' ? '小红书笔记' : '公众号原文' } } },
  }));
  report.filled++;
}
console.log(`回填 ${report.filled} 条 | 已有相同 ${report.same} 条`);
if (report.conflict.length) console.log('冲突(未覆盖):\n' + report.conflict.join('\n'));
if (report.unmatched.length) console.log('未匹配:\n' + report.unmatched.join('\n'));

// ── 2. 上传物料 ──
console.log('\n===== 物料上传 =====');
async function uploadFile(path) {
  const buf = readFileSync(path);
  const name = basename(path);
  const token = await getTenantAccessToken();
  const form = new FormData();
  form.set('file_name', name);
  form.set('parent_type', name.endsWith('.png') || name.endsWith('.jpg') ? 'bitable_image' : 'bitable_file');
  form.set('parent_node', APP);
  form.set('size', String(buf.byteLength));
  form.set('file', new Blob([buf]), name);
  const res = await fetch(`${feishuBase()}/open-apis/drive/v1/medias/upload_all`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`上传失败(${j.code}): ${j.msg}`);
  return j.data.file_token;
}

for (const m of MATERIALS) {
  const row = findRow(m.p, m.t);
  if (!row.record_id) { console.log(`✗ 行未匹配: [${m.p}] ${m.t}`); continue; }
  if ((row.fields?.['物料'] || []).length) { console.log(`跳过(已有物料): [${m.p}] ${row.fields['平台化标题']}`); continue; }
  const tokens = [];
  for (const f of m.files) {
    try { tokens.push({ file_token: await retry(() => uploadFile(f)) }); }
    catch (e) { console.log(`  文件失败 ${basename(f)}: ${e.message.slice(0, 60)}`); }
  }
  if (!tokens.length) { console.log(`✗ 无可用文件: [${m.p}] ${m.t}`); continue; }
  await retry(() => feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${PUB_TID}/records/${row.record_id}`, {
    method: 'PUT', body: { fields: { '物料': tokens } },
  }));
  console.log(`✓ [${m.p}] ${row.fields['平台化标题']} ← ${tokens.length} 个文件`);
}
console.log('\n完成');
