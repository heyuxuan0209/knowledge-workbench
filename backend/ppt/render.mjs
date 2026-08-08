/**
 * html-ppt · 场次渲染器 v2（Raw Grid 主题）
 *
 * v1 的两个错误（ADR-088）：
 *  ① 把所有录音都当"会议"，硬塞决策/待办 —— 分享会渲染出「决策 · 0 / 本次会议无正式决策」，荒谬。
 *     v2 用 session.type 决定**块的组合**：不属于该类型的块直接不存在，而不是渲染成"无"。
 *  ② 用 1920×1080 定尺 + transform:scale 适配手机 —— 那是压缩，字会变得看不清。
 *     v2 是**两套布局**：窄屏纵向流式（手机分享页），宽横屏定尺翻页（投屏）。同一份数据、同一份 HTML。
 *
 * 三条硬约束（v1 起就有，继续守）：
 *  1. 所有用户内容经 esc()；2. 计数从 array.length 派生；
 *  3. 该有的空块显式说"无"（那是信息），不该有的块根本不渲染。
 */

const CAP = 9;        // 投屏模式单栏安全条数（实测 11 条临界，留 2 条给换行）
const QUOTE_MAX = 3;

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pad2 = (n) => String(n).padStart(2, '0');
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o.length ? o : [[]]; };

/* ── 场次类型 → 允许的块。不在表里的块会被丢弃并 warn ─────────────────────── */
export const TYPES = {
  meeting:   { label: '会议纪要',        blocks: ['oneliner', 'narrative', 'decisions', 'todos', 'topics', 'quotes'] },
  talk:      { label: '分享会 / DemoDay', blocks: ['oneliner', 'narrative', 'outline', 'appraisal', 'resources', 'takeaways', 'quotes', 'seeds'] },
  chat:      { label: '对谈',            blocks: ['oneliner', 'narrative', 'topics', 'appraisal', 'takeaways', 'resources', 'quotes', 'seeds'] },
  interview: { label: '用户访谈',        blocks: ['oneliner', 'narrative', 'persona', 'saidVsDid', 'hypotheses', 'appraisal', 'quotes', 'todos', 'seeds'] },
  myTalk:    { label: '我的分享',        blocks: ['oneliner', 'narrative', 'outline', 'feedback', 'retro', 'quotes', 'seeds'] },
  // 口述一个还没定死的计划（旅行 / 产品排期 / 装修…）。招牌不是"讲了什么"，
  // 是**取舍了什么 + 有什么会失败的前置**——前五类都没有这两块。
  plan:      { label: '计划',            blocks: ['oneliner', 'narrative', 'itinerary', 'booking', 'tradeoffs', 'budget', 'pitfalls', 'checklist', 'quotes', 'seeds'] },
};

/* ── 通用零件 ─────────────────────────────────────────────────────────────── */
const label = (t, cls = '') => `<span class="label ${cls}">${esc(t)}</span>`;
/** 时间码。有原始材料链接就挂上去（飞书妙记不保证支持秒级深链，所以只跳到材料本身，
    时间码当文字锚点用——不伪造一个可能跳不准的 URL）。 */
let SRC = null;
const ts = (t) => !t ? '' :
  (SRC?.url ? `<a class="ts" href="${esc(SRC.url)}" target="_blank" rel="noopener" title="回原始材料的 ${esc(t)}">${esc(t)}</a>`
            : `<span class="ts">${esc(t)}</span>`);
function table(title, count, rows, empty, cols = 2, head = '') {
  return `<table>
    ${head || `<tr><th class="th-main" colspan="${cols}">${esc(title)} · ${count}</th></tr>`}
    ${rows.length ? rows : `<tr><td colspan="${cols}" class="empty">${esc(empty)}</td></tr>`}
  </table>`;
}
function cardList(items, { accent = '' } = {}) {
  if (!items.length) return `<p class="empty">—</p>`;
  return `<div class="cards">${items.map((it, i) => `<div class="card ${accent}">
    <div class="ci">${pad2(i + 1)}</div>
    <div class="ct">${esc(it.title ?? it.text)}</div>
    ${it.note ? `<div class="cn">${esc(it.note)}</div>` : ''}
    ${it.why ? `<div class="cn">为什么值得：${esc(it.why)}</div>` : ''}
  </div>`).join('')}</div>`;
}

/* ── 各块 ─────────────────────────────────────────────────────────────────── */
const B = {};

B.oneliner = (b) => `<div class="pad ctr grow">
  ${label('一句话', 'zh')}<h2 class="mt">${esc(b.text)}</h2></div>`;

B.decisions = (b) => {
  const items = b.items ?? [], un = b.unresolved ?? [], off = b._offset ?? 0;
  const rows = items.map((d, i) => `<tr><td class="m">${esc(d.id ?? `D-${pad2(off + i + 1)}`)}</td>
    <td data-l="决策">${esc(d.text)}${d.by ? ` <span class="by">— ${esc(d.by)}</span>` : ''}</td></tr>`).join('');
  const unRows = un.map((u) => `<tr><td class="m">OPEN</td><td class="pink" data-l="未达成结论">${esc(u.text)}</td></tr>`).join('');
  return `<div class="pad-md ctr grow">
    ${table('决策', b._total ?? items.length, rows, '本次没有正式决策')}
    ${b._last === false ? '' : `<div class="mt2">${table('未达成结论', un.length, unRows, '无悬而未决的议题')}</div>`}</div>`;
};

B.todos = (b) => {
  const items = b.items ?? [], open = b.open ?? [];
  const n = b._total ?? items.length;
  const rows = items.map((t) => `<tr><td class="cb"><span class="box${t.done ? ' on' : ''}"></span></td>
    <td data-l="事项">${esc(t.text)}</td>
    <td class="who" data-l="负责人">${esc([t.owner, t.due].filter(Boolean).join(' · ') || '待定')}</td></tr>`).join('');
  const openRows = open.map((q, i) => `<tr><td class="m">${esc(q.id ?? `Q-${pad2(i + 1)}`)}</td>
    <td class="green" data-l="遗留">${esc(q.text)}</td></tr>`).join('');
  return `<div class="pad-md ctr grow">
    ${table('', n, rows, '没有待办', 3, `<tr><th class="cb"></th><th class="th-main">待办 · ${n}</th><th class="who">负责人 · 时间</th></tr>`)}
    ${b._last === false ? '' : `<div class="mt2">${table('遗留问题', open.length, openRows, '无遗留问题')}</div>`}</div>`;
};

B.topics = (b) => {
  const items = b.items ?? [];
  return `<div class="pad-md ctr grow">${label(`${b.title ?? '议题与讨论'} · ${items.length}`, 'zh')}
    <div class="mt">${items.map((t) => `<div class="topic">
      <div class="th">${esc(t.title)}${t.resolved === false ? '<span class="tagx">未达成结论</span>' : ''}</div>
      ${(t.views ?? []).map((v) => `<div class="view"><span class="who2">${esc(v.who ?? '未知')}</span><span>${esc(v.text)}</span></div>`).join('')}
      ${t.conflict ? `<div class="conf">分歧：${esc(t.conflict)}</div>` : ''}</div>`).join('')}</div></div>`;
};

/** 讲了什么 —— 分享会 / 我的分享的脉络 */
B.outline = (b) => {
  const items = b.items ?? [];
  return `<div class="pad-md ctr grow">${label(b.title ?? '讲了什么', 'zh')}
    <div class="mt">${items.map((s, i) => `<div class="step">
      <div class="sn">${pad2(i + 1)}</div>
      <div class="sb"><div class="st">${esc(s.title ?? s.text)}</div>
      ${s.note ? `<div class="sd">${esc(s.note)}</div>` : ''}</div></div>`).join('')}</div></div>`;
};

/** 提到的工具 / 资源 —— 招牌是「可用性」列（沿用飞书机器人现有纪要里的【✅现在就能用】） */
B.resources = (b) => {
  const items = b.items ?? [];
  const S = { ready: ['✅', '现在就能用'], soon: ['🔸', '要折腾一下'], watch: ['👀', '先观望'], paid: ['💰', '要付费'] };
  const rows = items.map((r) => {
    const [ic, txt] = S[r.status] ?? ['·', r.status ?? '—'];
    return `<tr><td data-l="名称"><b>${esc(r.name)}</b>${r.url ? `<div class="u">${esc(r.url)}</div>` : ''}</td>
      <td data-l="是什么">${esc(r.what ?? '')}</td>
      <td class="st2" data-l="可用性">${ic} ${esc(txt)}</td></tr>`;
  }).join('');
  return `<div class="pad-md ctr grow">
    ${table('', items.length, rows, '没有提到可用的工具或资源', 3,
      `<tr><th class="th-main">提到的工具 / 资源 · ${items.length}</th><th>是什么</th><th class="st2">可用性</th></tr>`)}</div>`;
};

B.takeaways = (b) => `<div class="pad-md ctr grow">
  ${label(b.title ?? '对我的启发', 'zh')}<div class="mt">${cardList(b.items ?? [], { accent: 'green' })}</div></div>`;

B.seeds = (b) => `<div class="pad-md ctr grow">
  ${label('可沉淀选题', 'zh')}<div class="mt">${cardList(b.items ?? [], { accent: 'pink' })}</div></div>`;

/** 过程叙述 —— 「太干」的解药：现场是怎么一步步展开的，不是 bullet 是段落。
    每段可带 ts，指回原始材料。 */
B.narrative = (b) => {
  const items = b.items ?? [];
  return `<div class="pad-md ctr grow">${label(b.title ?? '现场是怎么展开的', 'zh')}
    <div class="mt narr">${items.length ? items.map((n) => `<div class="np">
      ${n.ts ? `<div class="nts">${ts(n.ts)}</div>` : ''}
      ${n.heading ? `<div class="nh">${esc(n.heading)}</div>` : ''}
      <p>${esc(n.text)}</p></div>`).join('')
      : `<p class="empty">没有过程叙述——只有结论的纪要没法反刍</p>`}</div></div>`;
};

/** 观点体检 —— 对方的观点站不站得住脚。
    AI 只填能从材料里抽出来的（依据/链条/假设/边界/反方），
    「我接不接受」是判断，留给人（ADR-044）：空着就渲染成「待你裁决」，不替他写。 */
B.appraisal = (b) => {
  const items = b.items ?? [];
  const row = (k, v, cls = '') => v ? `<div class="ap ${cls}"><div class="apk">${esc(k)}</div><div class="apv">${esc(v)}</div></div>` : '';
  return `<div class="pad-md ctr grow">${label('观点体检 · ' + items.length, 'zh')}
    <div class="mt">${items.length ? items.map((a) => `<div class="apc">
      <div class="apt">${esc(a.claim)}${a.who ? `<span class="apw">— ${esc(a.who)}</span>` : ''}${a.ts ? ts(a.ts) : ''}</div>
      ${row('事实依据', a.evidence)}
      ${row('推理链条', a.reasoning)}
      ${row('隐含假设', a.assumption, 'warn')}
      ${row('适用边界', a.boundary)}
      ${row('最强反方', a.counter, 'warn')}
      <div class="ap verdict"><div class="apk">我接不接受</div><div class="apv">${
        a.myVerdict ? esc(a.myVerdict) : '<span class="pend">待你裁决 —— 这一栏 AI 不替你填</span>'}</div></div>
    </div>`).join('') : `<p class="empty">没有值得体检的观点</p>`}</div>
    <div class="foot-note">观点可以从感觉开始，但不能停留在感觉。经不起追问的结论，别往自己的产品里搬。</div></div>`;
};

/* ── 用户访谈专属 ─────────────────────────────────────────────────────────── */
B.persona = (b) => {
  const f = [['是谁', b.who], ['什么场景', b.context], ['现在怎么解决', b.current], ['为什么找到我', b.trigger]]
    .filter(([, v]) => v);
  return `<div class="pad-md ctr grow">${label('受访者与场景', 'zh')}
    <div class="mt kv">${f.length ? f.map(([k, v]) =>
      `<div class="kvi"><div class="kvk">${esc(k)}</div><div class="kvv">${esc(v)}</div></div>`).join('')
      : `<div class="kvi"><p class="empty">材料里没交代受访者背景——下次访谈开头补一句</p></div>`}</div></div>`;
};

/** 招牌块：他说的 vs 他做的。用户研究最容易被「我想要 X」骗，必须并排放行为证据。 */
B.saidVsDid = (b) => {
  const items = b.items ?? [];
  return `<div class="pad-md ctr grow">${label('他说的 vs 他做的', 'zh')}
    <div class="mt">${items.length ? items.map((p) => `<div class="svdi">
      <div class="svdc pink"><div class="svdh">他说想要</div><div>${esc(p.said)}</div></div>
      <div class="svdc green"><div class="svdh">他实际在做 / 卡在哪</div><div>${esc(p.did)}</div></div>
      ${p.gap ? `<div class="svdg">落差：${esc(p.gap)}</div>` : ''}</div>`).join('')
      : `<p class="empty">没问出行为证据——只有愿望的访谈基本不能用</p>`}</div>
    <div class="foot-note">说的是愿望，做的是事实。两者冲突时，以「做的」为准。</div></div>`;
};

/** 假设验证：访谈的真正产出。访谈前有假设，访谈后必须更新。 */
B.hypotheses = (b) => {
  const items = b.items ?? [];
  const V = { confirmed: ['✅', '证实', 'green'], refuted: ['❌', '证伪', 'pink'], unclear: ['❓', '待验证', ''] };
  const rows = items.map((h) => {
    const [ic, txt, cls] = V[h.verdict] ?? ['❓', '待验证', ''];
    return `<tr><td data-l="假设">${esc(h.text)}</td>
      <td class="vd ${cls}" data-l="结论">${ic} ${esc(txt)}</td>
      <td data-l="证据">${esc(h.evidence ?? '—')}</td></tr>`;
  }).join('');
  return `<div class="pad-md ctr grow">
    ${table('', items.length, rows, '本次没有可验证的假设——下次访谈前先把假设写下来', 3,
      `<tr><th class="th-main">产品假设 · ${items.length}</th><th class="vd">结论</th><th>证据（原话 / 行为）</th></tr>`)}</div>`;
};

/* ── 我的分享专属 ─────────────────────────────────────────────────────────── */
B.feedback = (b) => `<div class="pad-md ctr grow">
  ${label('现场反应 / 被问到什么', 'zh')}<div class="mt">${cardList(b.items ?? [])}</div></div>`;

B.retro = (b) => {
  const col = (t, items, cls) => `<div class="rc ${cls}"><div class="rh">${esc(t)}</div>
    ${(items ?? []).length ? items.map((x) => `<div class="ri">${esc(x)}</div>`).join('') : '<div class="empty">—</div>'}</div>`;
  return `<div class="pad-md ctr grow">${label('复盘', 'zh')}
    <div class="mt retro">${col('讲得好的', b.good, 'green')}${col('没讲好的', b.bad, 'pink')}${col('下次改', b.next, '')}</div></div>`;
};

B.quotes = (b) => {
  const items = b.items ?? [];
  return `<div class="pad ctr grow">${label('值得记住的原话', 'zh')}
    ${items.length ? items.map((q) => `<div class="quote"><div class="qt">${esc(q.text)}</div>
      <div class="qb">— ${esc(q.who ?? '未标注')}${q.ts ? ' ' + ts(q.ts) : ''}</div></div>`).join('')
      : `<p class="empty mt">没有值得直引的原话</p>`}</div>`;
};


/* ── 计划类专属 ───────────────────────────────────────────────────────────── */

/** 逐日行程 —— 投屏模式一天一页（见 paginate），流式模式顺着往下读 */
B.itinerary = (b) => {
  const d = b.items?.[0];
  if (!d) return `<div class="pad-md ctr grow"><p class="empty">没有行程</p></div>`;
  return `<div class="pad-md ctr grow">
    <div class="dayh"><span class="dn">${esc(d.day ?? '')}</span>
      <span class="dt">${esc(d.title ?? '')}</span>
      ${d.meta ? `<span class="dm">${esc(d.meta)}</span>` : ''}</div>
    <div class="stops">${(d.stops ?? []).map((x) => `<div class="stop">
      <div class="sw"><div class="stime">${esc(x.time ?? '')}</div>
        ${x.dur || x.price ? `<div class="smeta">${esc([x.dur, x.price].filter(Boolean).join(' · '))}</div>` : ''}</div>
      <div class="sbody"><div class="sname">${esc(x.name)}</div>
        ${x.note ? `<div class="snote">${esc(x.note)}</div>` : ''}
        ${x.alt ? `<div class="salt">备选：${esc(x.alt)}</div>` : ''}</div>
    </div>`).join('')}</div>
    ${d.stay ? `<div class="stay"><b>住</b> ${esc(d.stay)}</div>` : ''}
    ${d.tip ? `<div class="tip"><b>自驾</b> ${esc(d.tip)}</div>` : ''}
  </div>`;
};

/** 前置预约 —— 会失败、有截止的事。计划类最该被单独拎出来的一块。 */
B.booking = (b) => {
  const items = b.items ?? [];
  const rows = items.map((r) => `<tr class="${r.critical ? 'crit' : ''}">
    <td data-l="要约什么"><b>${esc(r.what)}</b>${r.critical ? '<span class="must">必抢</span>' : ''}</td>
    <td data-l="怎么约">${esc(r.how ?? '')}</td>
    <td data-l="什么时候" class="whenc">${esc(r.when ?? '')}</td>
    <td data-l="注意">${esc(r.note ?? '')}</td></tr>`).join('');
  return `<div class="pad-md ctr grow">
    ${table('', items.length, rows, '没有需要提前预约的', 4,
      `<tr><th class="th-main">前置预约 · ${items.length}</th><th>怎么约</th><th class="whenc">什么时候</th><th>注意</th></tr>`)}
    <div class="foot-note">这一栏没做完，后面整条行程都可能白跑。</div></div>`;
};

/** 取舍 —— 计划的核心。为了什么放弃了什么、代价是什么。 */
B.tradeoffs = (b) => {
  const items = b.items ?? [];
  return `<div class="pad-md ctr grow">${label('取舍', 'zh')}
    <div class="mt">${items.length ? items.map((t) => `<div class="svdi">
      <div class="svdc green"><div class="svdh">选了</div><div>${esc(t.chose)}</div></div>
      <div class="svdc pink"><div class="svdh">放弃了</div><div>${esc(t.gave)}</div></div>
      ${t.cost || t.why ? `<div class="svdg">${t.cost ? `代价：${esc(t.cost)}` : ''}${t.cost && t.why ? '　｜　' : ''}${t.why ? `为什么值：${esc(t.why)}` : ''}</div>` : ''}
    </div>`).join('') : `<p class="empty">没记下取舍——那这份计划其实还没做决定</p>`}</div></div>`;
};

/** 预算 */
B.budget = (b) => {
  const items = b.items ?? [];
  const rows = items.map((x) => `<tr><td data-l="项目">${esc(x.name)}</td>
    <td class="amt" data-l="金额">${esc(x.amount)}</td>
    <td data-l="备注">${esc(x.note ?? '')}</td></tr>`).join('');
  return `<div class="pad-md ctr grow">
    ${table('', items.length, rows, '没算预算', 3,
      `<tr><th class="th-main">预算${b.note ? ' · ' + esc(b.note) : ''}</th><th class="amt">金额</th><th>备注</th></tr>`)}
    ${b.total ? `<div class="total"><span>合计</span><b>${esc(b.total)}</b></div>` : ''}</div>`;
};

B.pitfalls = (b) => `<div class="pad-md ctr grow">
  ${label('避坑', 'zh')}<div class="mt">${cardList(b.items ?? [], { accent: 'pink' })}</div></div>`;

B.checklist = (b) => {
  const groups = b.groups ?? [];
  return `<div class="pad-md ctr grow">${label(b.title ?? '要准备什么', 'zh')}
    <div class="mt ckg">${groups.map((g) => `<div class="ck">
      <div class="ckh">${esc(g.name)}</div>
      ${(g.items ?? []).map((x) => `<div class="cki"><span class="box"></span><span>${esc(x)}</span></div>`).join('')}
    </div>`).join('')}</div></div>`;
};

/* ── 分页（只影响投屏模式；流式模式天然不需要） ───────────────────────────── */
function paginate(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'itinerary') {
      // 一天一页：7 天塞一页必然溢出，而按天切天然对齐读者的心智
      (b.items ?? []).forEach((d, i) => out.push({ ...b, items: [d], _cont: i > 0 }));
    } else if (b.type === 'booking' || b.type === 'pitfalls') {
      chunk(b.items ?? [], CAP).forEach((items, i) =>
        out.push({ ...b, items, _cont: i > 0, _total: b.items?.length ?? 0 }));
    } else if (b.type === 'decisions' || b.type === 'todos') {
      const parts = chunk(b.items ?? [], CAP);
      parts.forEach((items, i) => out.push({
        ...b, items, _cont: i > 0, _offset: i * CAP,
        _total: b.items?.length ?? 0, _last: i === parts.length - 1,
      }));
    } else if (b.type === 'quotes') {
      const items = (b.items ?? []).slice(0, QUOTE_MAX);
      if ((b.items?.length ?? 0) > QUOTE_MAX)
        console.warn(`[html-ppt] quotes 超 ${QUOTE_MAX} 条，已截断 ${b.items.length - QUOTE_MAX} 条`);
      out.push({ ...b, items });
    } else out.push({ ...b });
  }
  return out;
}

/* ── 主入口 ───────────────────────────────────────────────────────────────── */
export function render(session, { density = {} } = {}) {
  SRC = session.meta?.source ?? null;   // 原始妙记 / 录屏，供时间码挂链
  const type = session.type ?? 'meeting';
  const spec = TYPES[type];
  if (!spec) throw new Error(`[html-ppt] 未知场次类型：${type}（可用：${Object.keys(TYPES).join(' / ')}）`);
  const meta = session.meta ?? {};

  // v2 的核心：不属于该类型的块直接丢弃，而不是渲染成「决策 · 0」
  const kept = [], dropped = [];
  for (const b of session.blocks ?? []) {
    if (!B[b.type]) throw new Error(`[html-ppt] 未知块类型：${b.type}（可用：${Object.keys(B).join(' / ')}）`);
    (spec.blocks.includes(b.type) ? kept : dropped).push(b);
  }
  if (dropped.length)
    console.warn(`[html-ppt] 「${spec.label}」不含这些块，已丢弃：${dropped.map((d) => d.type).join(', ')}`);
  if (!kept.length) throw new Error('[html-ppt] 没有可渲染的块');

  const pages = paginate(kept);
  const total = pages.length + 1; // +1 封面
  const inferred = session.speakerInferred === true;

  const metaRows = [['日期', meta.date], ['时长', meta.duration],
    ['在场', (meta.participants ?? []).join(' · ')], ['我的角色', meta.myRole]].filter(([, v]) => v);

  const cover = `<section class="slide on" data-sec="封面"><div class="cover">
    <div class="cl">${label(spec.label, 'zh')}
      <h1 class="mt">${esc(meta.title ?? '未命名场次')}</h1>
      <div class="rule"></div>
      ${meta.subtitle ? `<p class="sub">${esc(meta.subtitle)}</p>` : ''}
      ${SRC?.url ? `<a class="srcbtn" href="${esc(SRC.url)}" target="_blank" rel="noopener">
        ↗ ${esc(SRC.label || '原始妙记 / 逐字稿')}</a>` : ''}</div>
    <div class="cr">${metaRows.length
      ? metaRows.map(([k, v]) => `<div class="ci2"><div class="cap">${esc(k)}</div><div class="cv">${esc(v)}</div></div>`).join('')
      : `<div class="ci2"><p class="empty">材料未提供元信息</p></div>`}</div></div></section>`;

  const body = pages.map((b, i) => {
    const n = i + 1;
    const right = [meta.date, meta.duration].filter(Boolean).join(' · ');
    const bar = `<div class="top"><div class="t">${label(spec.label)} ${esc(meta.title ?? '')}${b._cont ? '（续）' : ''}</div>
      <div class="fill"></div>${right ? `<div class="t">${esc(right)}</div>` : ''}
      <div class="pg">${pad2(n + 1)} / ${pad2(total)}</div></div>`;
    return `<section class="slide" data-d="${density[n] ?? 0}" data-sec="${esc(b.type)}">${bar}${B[b.type](b)}</section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="${esc(session.lang ?? 'zh')}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(meta.title ?? spec.label)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@500;700;800;900&display=swap" rel="stylesheet">
<style>
/* Raw Grid 主题 —— token 见 bold-template-pack/templates/raw-grid/design.md
   两套布局，不是一套缩放（ADR-088）：
   · 默认＝流式手机分享页：真字号、纵向滚动、表格拆成卡片
   · 宽横屏＝定尺 1920×1080 翻页投屏
   手机上不做 scale —— 缩放等于把字压小，那不叫适配。 */
*{box-sizing:border-box;margin:0;padding:0}
:root{--black:#0A0A0A;--white:#fff;--pink:#F2D4CF;--green:#E5EDD6;--gray:#F5F5F5;
  --bd:3px solid var(--black);--f:'Segoe UI',system-ui,-apple-system,Helvetica,Arial,'Noto Sans SC',sans-serif}
html{-webkit-text-size-adjust:100%}
body{font-family:var(--f);color:var(--black);background:var(--white);line-height:1.7;
  -webkit-font-smoothing:antialiased}
#stage{max-width:820px;margin:0 auto;padding:0 16px 64px}

/* ── 流式（默认 / 手机）────────────────────────────────────────────────── */
.slide{display:block;border-bottom:var(--bd);padding-bottom:10px;margin-bottom:26px}
.slide:last-of-type{border-bottom:0}
/* 流式模式不要顶栏：滚动页里每段重复一遍「类型·标题·日期·页码」是纯噪音，
   结构由每块自己的 label 承担（一句话 / 聊了哪些事 / 对我的启发…）。投屏模式才需要它。 */
.top{display:none}
.label{background:var(--black);color:var(--white);padding:5px 12px;font-size:11px;font-weight:800;
  letter-spacing:.08em;display:inline-block;width:fit-content}
.label.zh{letter-spacing:.04em;font-size:13px}
.cap{font-size:11px;font-weight:800;letter-spacing:.08em;color:#666}
h1{font-size:34px;font-weight:900;line-height:1.25;letter-spacing:0}
h2{font-size:25px;font-weight:900;line-height:1.4;letter-spacing:0}
p,li,td{font-size:16px;font-weight:500;line-height:1.8}
.mt{margin-top:14px}.mt2{margin-top:20px}
.rule{height:4px;background:var(--black);width:80px;margin:16px 0}
.sub{color:#444}.empty{color:#666;font-weight:500}
.pad,.pad-md{padding:0}.grow{display:block}
.foot-note{font-size:12px;color:#666;margin-top:12px;border-left:var(--bd);padding-left:10px}

/* 封面 */
.cover{display:block;border:var(--bd);margin-top:16px}
.cl{background:var(--pink);padding:24px 18px}
.cr{display:grid;grid-template-columns:1fr 1fr}
.ci2{border-top:var(--bd);padding:12px 16px}
.ci2:nth-child(even){border-left:var(--bd)}
.cv{font-size:17px;font-weight:900;margin-top:4px}

/* 表格 → 手机上拆成卡片（不横向滚动、不缩字号） */
table{width:100%;border-collapse:collapse;display:block}
thead,tbody,tr,th,td{display:block}
th{background:var(--black);color:var(--white);font-size:12px;font-weight:800;letter-spacing:.06em;
  padding:10px 14px;text-align:left}
th{display:none}th.th-main{display:block}
tr{border:var(--bd);border-top:0}
tr:first-child{border:0}
td{border-top:1px solid rgba(10,10,10,.18);padding:10px 14px}
td:first-child{border-top:0}
td[data-l]::before{content:attr(data-l);display:block;font-size:11px;font-weight:800;
  letter-spacing:.06em;color:#666;margin-bottom:2px}
td.m,td.cb{font-weight:900;background:var(--gray)}
td.m::before,td.cb::before{content:none}
td.who{font-size:13px;font-weight:700}
td.empty{color:#666;font-weight:500}
td.pink{background:var(--pink)}td.green{background:var(--green)}
.box{width:16px;height:16px;border:var(--bd);display:inline-block;vertical-align:-2px}
.box.on{background:var(--black)}
.by{font-weight:800;font-size:12px}
.u{font-size:12px;color:#555;font-weight:500;word-break:break-all}
.st2{font-weight:800}
.vd{font-weight:800}.vd.green{background:var(--green)}.vd.pink{background:var(--pink)}

/* 卡片列 */
.cards{display:grid;gap:12px}
.card{border:var(--bd);padding:14px 16px}
.card.green{background:var(--green)}.card.pink{background:var(--pink)}
.ci{font-size:11px;font-weight:900;letter-spacing:.08em;opacity:.5}
.ct{font-size:18px;font-weight:900;line-height:1.4;margin-top:4px}
.cn{font-size:14px;font-weight:500;margin-top:6px}

/* 脉络 */
.step{display:flex;gap:14px;border:var(--bd);padding:12px 14px;margin-bottom:10px}
.sn{font-weight:900;font-size:13px;opacity:.45;flex:none;padding-top:3px}
.st{font-size:17px;font-weight:900;line-height:1.4}
.sd{font-size:14px;font-weight:500;margin-top:4px}

/* 议题 */
.topic{border:var(--bd);padding:14px 16px;margin-bottom:12px}
.th{font-size:18px;font-weight:900;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.tagx{background:var(--pink);font-size:11px;font-weight:800;letter-spacing:.06em;padding:3px 8px}
.view{display:flex;gap:10px;font-size:15px;margin-top:8px}
.who2{font-weight:900;flex:none;min-width:4.5em}
.conf{background:var(--green);font-size:14px;font-weight:600;padding:8px 10px;margin-top:10px}

/* 键值 / 说做对照 / 复盘 */
.kv{display:grid;gap:0;border:var(--bd)}
.kvi{padding:12px 14px}.kvi+.kvi{border-top:var(--bd)}
.kvk{font-size:11px;font-weight:800;letter-spacing:.08em;color:#666}
.kvv{font-size:16px;font-weight:700;margin-top:3px}
.svdi{border:var(--bd);margin-bottom:12px}
.svdc{padding:12px 14px;font-size:15px;font-weight:600}
.svdc+.svdc{border-top:var(--bd)}
.svdh{font-size:11px;font-weight:800;letter-spacing:.08em;margin-bottom:4px}
.svdg{border-top:var(--bd);padding:10px 14px;font-size:14px;font-weight:800;background:var(--gray)}
.retro{display:grid;gap:0;border:var(--bd)}
.rc{padding:12px 14px}.rc+.rc{border-top:var(--bd)}
.rc.green{background:var(--green)}.rc.pink{background:var(--pink)}
.rh{font-size:12px;font-weight:800;letter-spacing:.06em;margin-bottom:6px}
.ri{font-size:15px;font-weight:600;margin-top:4px}

/* 过程叙述 */
.narr{display:grid;gap:14px}
.np{border-left:var(--bd);padding-left:16px}
.nts{margin-bottom:4px}
.nh{font-size:17px;font-weight:900;margin-bottom:4px}
.np p{font-size:16px;font-weight:500;line-height:1.85}

/* 观点体检 */
.apc{border:var(--bd);margin-bottom:14px}
.apt{background:var(--black);color:#fff;padding:12px 16px;font-size:17px;font-weight:900;
  line-height:1.45;display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.apw{font-size:12px;font-weight:700;opacity:.7}
.ap{display:grid;grid-template-columns:88px 1fr;border-top:var(--bd)}
.ap:first-of-type{border-top:0}
.apk{font-size:11px;font-weight:800;letter-spacing:.06em;color:#666;padding:10px 12px;
  border-right:1px solid rgba(10,10,10,.18);background:var(--gray)}
.apv{padding:10px 14px;font-size:15px;font-weight:600;line-height:1.75}
.ap.warn .apk{background:var(--pink);color:var(--black)}
.ap.verdict .apk{background:var(--green)}
.pend{color:#777;font-weight:500;font-style:normal}

/* 追问条 */
.ask{border:var(--bd);background:var(--gray);margin-top:22px;padding:16px 18px}
.askh{font-size:12px;font-weight:800;letter-spacing:.06em}
.askb{margin-top:8px;display:flex;flex-direction:column;gap:8px}
.askl{font-size:15px;font-weight:800;color:var(--black);text-decoration:none;
  border-bottom:var(--bd);width:fit-content;padding-bottom:2px}
.askl.off{border-bottom:0;color:#777;font-weight:600}
.askt{font-size:14px;font-weight:500;line-height:1.75;color:#333}
.srcbtn{display:inline-block;margin-top:16px;font-size:14px;font-weight:800;color:var(--black);
  text-decoration:none;background:#fff;border:var(--bd);padding:8px 14px;width:fit-content}


/* 计划类：逐日行程 */
.dayh{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;border-bottom:var(--bd);padding-bottom:10px}
.dn{background:var(--black);color:#fff;font-size:13px;font-weight:800;letter-spacing:.06em;padding:5px 12px}
.dt{font-size:22px;font-weight:900}
.dm{font-size:12px;font-weight:700;color:#666;letter-spacing:.04em}
.stops{margin-top:12px}
.stop{display:flex;gap:14px;padding:11px 0;border-bottom:1px solid rgba(10,10,10,.18)}
.stop:last-child{border-bottom:0}
.sw{flex:none;width:76px}
.stime{font-size:14px;font-weight:900;font-variant-numeric:tabular-nums}
.smeta{font-size:11px;font-weight:700;color:#666;margin-top:2px}
.sname{font-size:17px;font-weight:900;line-height:1.4}
.snote{font-size:14px;font-weight:500;line-height:1.75;margin-top:3px;color:#333}
.salt{font-size:13px;font-weight:700;background:var(--green);padding:4px 8px;margin-top:6px;display:inline-block}
.stay,.tip{border:var(--bd);padding:9px 13px;margin-top:10px;font-size:14px;font-weight:600}
.stay{background:var(--pink)}.tip{background:var(--gray)}
.stay b,.tip b{font-size:11px;letter-spacing:.06em;margin-right:8px}
/* 前置预约 */
tr.crit td{background:var(--pink)}
.must{background:var(--black);color:#fff;font-size:10px;font-weight:800;letter-spacing:.06em;padding:2px 7px;margin-left:8px}
td.whenc,th.whenc{font-weight:800}
/* 预算 */
td.amt,th.amt{font-weight:900;font-variant-numeric:tabular-nums;text-align:right}
.total{display:flex;justify-content:space-between;align-items:baseline;border:var(--bd);
  border-top:0;background:var(--black);color:#fff;padding:12px 16px}
.total span{font-size:11px;font-weight:800;letter-spacing:.08em}
.total b{font-size:20px;font-weight:900}
/* 清单 */
.ckg{display:grid;gap:12px}
.ck{border:var(--bd);padding:12px 14px}
.ckh{font-size:12px;font-weight:800;letter-spacing:.06em;margin-bottom:8px}
.cki{display:flex;gap:10px;align-items:flex-start;font-size:15px;font-weight:500;
  line-height:1.7;margin-top:5px}
.cki .box{flex:none;margin-top:4px}

/* 原话 */
.quote{border-left:var(--bd);padding-left:16px;margin-top:16px}
.qt{font-size:20px;font-weight:900;line-height:1.45}
.qb{font-size:12px;font-weight:800;letter-spacing:.06em;margin-top:8px}
.ts{font-variant-numeric:tabular-nums;background:var(--gray);padding:2px 6px;font-size:11px;
  font-weight:800;letter-spacing:.04em;color:var(--black);text-decoration:none;display:inline-block}
a.ts{border-bottom:2px solid var(--black)}

.bot{border-top:var(--bd);margin-top:20px;padding:12px 0;font-size:11px;font-weight:800;
  letter-spacing:.06em;color:#555;display:flex;gap:14px;flex-wrap:wrap}
.dots{display:none}

/* ── 定尺投屏（够宽 + 横向 才启用）──────────────────────────────────────── */
@media (min-width:1000px) and (min-aspect-ratio:5/4){
  html,body{height:100%;overflow:hidden}
  body{background:#8a8a8a}
  #stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;max-width:none;padding:0;
    transform:translate(-50%,-50%) scale(var(--s,1));transform-origin:center;
    background:var(--white);overflow:hidden}
  .slide{position:absolute;left:0;right:0;top:0;bottom:58px;display:none;flex-direction:column;
    border-bottom:0;margin:0;padding:0;--fs:18px;--lh:1.65}
  .slide.on{display:flex}
  .slide[data-d="1"]{--fs:16px;--lh:1.5}
  .slide[data-d="2"]{--fs:15px;--lh:1.4}
  .top{display:flex;border-bottom:var(--bd);padding:0;flex:none;font-size:14px;flex-wrap:nowrap;
    align-items:stretch;font-weight:800;letter-spacing:.04em}
  .top .t{padding:16px 28px;display:flex;align-items:center;gap:12px}
  .top .t+.t{border-left:var(--bd)}
  .top .fill{display:block;flex:1}
  .top .pg{border-left:var(--bd);padding:16px 28px;opacity:1;font-weight:900;margin-left:0}
  .label{font-size:13px;padding:6px 14px}.label.zh{font-size:15px}
  h1{font-size:88px}h2{font-size:56px}
  p,li,td{font-size:var(--fs);line-height:var(--lh)}
  .pad{padding:56px}.pad-md{padding:34px 44px}
  .grow{flex:1;display:flex;flex-direction:column;justify-content:center}
  .mt{margin-top:24px}.mt2{margin-top:26px}.rule{width:120px;margin:28px 0}
  .cover{display:flex;flex:1;border:0;margin:0}
  .cl{flex:1.15;border-right:var(--bd);padding:56px;display:flex;flex-direction:column;justify-content:center}
  .cr{display:flex;flex-direction:column;flex:1}
  .ci2{flex:1;border-top:0;border-bottom:var(--bd);padding:24px 34px;display:flex;
    flex-direction:column;justify-content:center}
  .ci2:nth-child(even){border-left:0}
  .cv{font-size:26px}
  /* 表格回归真表格 */
  table{display:table}tr{display:table-row;border:0}
  th,td{display:table-cell;border:var(--bd);vertical-align:top}
  th,th.th-main{display:table-cell}
  th{padding:13px 18px;font-size:14px}
  td{padding:11px 18px;font-weight:600}
  td[data-l]::before{content:none}
  tr:nth-child(even) td{background:var(--gray)}
  tr:nth-child(even) td.pink{background:var(--pink)}
  tr:nth-child(even) td.green{background:var(--green)}
  td.m{width:96px;white-space:nowrap;background:var(--white)}
  td.cb{width:56px;text-align:center;background:var(--white)}
  td.who{width:170px;white-space:nowrap}
  .cards{grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:22px}
  .card{padding:24px 26px}.ct{font-size:24px}.cn{font-size:16px}
  .step{padding:16px 22px;margin-bottom:14px}.st{font-size:22px}.sd{font-size:16px}
  .topic{padding:18px 22px}.th{font-size:24px}.view{font-size:var(--fs)}
  .kv{grid-template-columns:1fr 1fr}
  .kvi+.kvi{border-top:0}
  .kvi:nth-child(n+3){border-top:var(--bd)}
  .kvi:nth-child(even){border-left:var(--bd)}
  .kvv{font-size:20px}
  .svdi{display:grid;grid-template-columns:1fr 1fr;margin-bottom:14px}
  .svdc+.svdc{border-top:0;border-left:var(--bd)}
  .svdg{grid-column:1/-1;border-top:var(--bd)}
  .retro{grid-template-columns:repeat(3,1fr)}
  .rc+.rc{border-top:0;border-left:var(--bd)}
  .dayh{padding-bottom:14px}.dn{font-size:15px;padding:7px 16px}.dt{font-size:32px}.dm{font-size:14px}
  .stops{margin-top:18px}.stop{padding:14px 0;gap:22px}.sw{width:110px}
  .stime{font-size:18px}.smeta{font-size:12px}
  .sname{font-size:22px}.snote{font-size:var(--fs);line-height:var(--lh)}.salt{font-size:15px}
  .stay,.tip{padding:12px 18px;font-size:16px;margin-top:14px}
  .total{padding:14px 22px}.total b{font-size:26px}
  .ckg{grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
  .ck{padding:18px 22px}.cki{font-size:var(--fs)}
  .quote{padding-left:30px;margin-top:26px}.qt{font-size:34px}
  .narr{gap:20px}.np{padding-left:26px}.np p{font-size:var(--fs);line-height:var(--lh)}
  .nh{font-size:22px}
  .apc{margin-bottom:18px}.apt{font-size:22px;padding:14px 20px}
  .ap{grid-template-columns:110px 1fr}.apk{padding:12px 14px;font-size:12px}
  .apv{padding:12px 18px;font-size:var(--fs);line-height:var(--lh)}
  /* 投屏时不显示「去问机器人」——那是读的人的动作，不是讲的人的。原始材料链接收进页脚。 */
  .ask{display:none}
  .srcbtn{margin-top:24px;font-size:16px;padding:10px 18px}
  .bot .src{margin-left:0}
  .bot .src a{color:var(--black);text-decoration:none;border-bottom:2px solid var(--black)}
  .bot{position:absolute;left:0;right:0;bottom:0;height:58px;margin:0;padding:0;gap:0;
    border-top:var(--bd);background:var(--white);align-items:stretch}
  .bot .c{padding:0 28px;display:flex;align-items:center}
  .bot .c+.c{border-left:var(--bd)}
  .dots{display:flex;margin-left:auto;border-left:var(--bd)}
  .dot{width:44px;border-left:var(--bd);cursor:pointer}
  .dot:first-child{border-left:0}.dot.on{background:var(--black)}
}
@media print{.slide{display:block!important;page-break-after:always}}
</style>
</head>
<body>
<div id="stage">
${cover}
${body}
<div class="ask">
  <div class="askh">这页是提炼，不是全部</div>
  <div class="askb">
    ${SRC?.url ? `<a class="askl" href="${esc(SRC.url)}" target="_blank" rel="noopener">↗ 看原始${esc(SRC.label || '妙记 / 逐字稿')}</a>` : `<span class="askl off">（这场没挂原始材料链接）</span>`}
    <span class="askt">想深入问：<b>回飞书私聊问机器人</b>，它手里有这场的逐字稿和上下文，能顺着往下挖。这页是死的，它是活的。</span>
  </div>
</div>
<div class="bot">
  <div class="c">${esc(meta.brand ?? '')}</div>
  <div class="c" id="sec"></div>
  ${SRC?.url ? `<div class="c src"><a href="${esc(SRC.url)}" target="_blank" rel="noopener">↗ 原始${esc(SRC.label || '妙记')}</a></div>` : ''}
  ${inferred ? `<div class="c">说话人归属由内容推断，可能有误差</div>` : ''}
  <div class="dots" id="dots"></div>
</div>
</div>
<script>
const stage=document.getElementById('stage'),slides=[...document.querySelectorAll('.slide')],
  dots=document.getElementById('dots'),sec=document.getElementById('sec');
const DECK=matchMedia('(min-width:1000px) and (min-aspect-ratio:5/4)');
slides.forEach((_,i)=>{const d=document.createElement('div');d.className='dot';d.onclick=()=>go(i);dots.appendChild(d)});
let cur=0;
function paint(){slides.forEach((s,j)=>s.classList.toggle('on',j===cur));
  [...dots.children].forEach((d,j)=>d.classList.toggle('on',j===cur));
  sec.textContent=slides[cur].dataset.sec}
function go(i){if(!DECK.matches)return;cur=Math.max(0,Math.min(slides.length-1,i));paint()}
function sync(){
  if(DECK.matches){stage.style.setProperty('--s',Math.min(innerWidth/1920,innerHeight/1080));paint()}
  else{stage.style.removeProperty('--s');slides.forEach(s=>s.classList.remove('on'));sec.textContent=''}}
addEventListener('resize',sync);DECK.addEventListener('change',sync);sync();
addEventListener('keydown',e=>{if(!DECK.matches)return;
  if(['ArrowRight','ArrowDown',' ','PageDown'].includes(e.key)){e.preventDefault();go(cur+1)}
  if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();go(cur-1)}});
addEventListener('click',e=>{if(!DECK.matches||e.target.closest('.dot'))return;
  go(e.clientX>innerWidth/2?cur+1:cur-1)});
</script>
</body></html>`;
}

export { CAP, esc };
