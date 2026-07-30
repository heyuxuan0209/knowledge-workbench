import { feishuBase } from './feishu-auth.js';
import { upsertInboxItem, markTriagedByFeishuId } from '../db/feishu-inbox.js';

// 笔记机器人独立应用（ADR-056：一个飞书应用只许一个长连接消费者）。
// 主应用 FEISHU_APP_ID 已被 Claude 桥独占事件流，本机器人用 FEISHU_BOT_APP_ID/SECRET（.env）。
// 未配独立凭证时不回退主应用——回退就是重蹈事件被随机分流的覆辙，宁可不启动。
const botAppId = () => process.env.FEISHU_BOT_APP_ID || '';
const botAppSecret = () => process.env.FEISHU_BOT_APP_SECRET || '';
const botConfigured = () => !!(botAppId() && botAppSecret());

// 本应用自己的 tenant_access_token（缓存到过期前 60s）；不复用 feishu-auth 的缓存（那是主应用的）。
let botTok = { token: null, exp: 0 };
async function getBotToken() {
  const now = Date.now();
  if (botTok.token && now < botTok.exp - 60_000) return botTok.token;
  const res = await fetch(`${feishuBase()}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: botAppId(), app_secret: botAppSecret() }),
  });
  const j = await res.json();
  if (j.code !== 0 || !j.tenant_access_token) throw new Error(`笔记机器人鉴权失败(${j.code}): ${j.msg || '未知错误'}`);
  botTok = { token: j.tenant_access_token, exp: now + (j.expire || 7200) * 1000 };
  return botTok.token;
}

// 飞书私信捕获机器人（ADR-039，用户拍板：私信直连 + 默认静默 + 问句才回）。
// 机制：飞书**长连接**（WebSocket）收 im.message.receive_v1 事件——本地后端不用公网 URL。
//   · 只收**私信**(chat_type=p2p)：每条文本 → 进「灵感·待整理」（obj_type=message, suggested=idea）。
//   · **陈述句静默记**、**问句(？/?结尾)才回一句**（DeepSeek，几句话），回复也随捕获一起留痕。
// 只读捕获不花 LLM；仅问句触发一次 DeepSeek + 一次发消息（需 im:message 发送权限）。
// 旧机器人已停用（用户确认），事件订阅切长连接不冲突。

let started = false;
let wsRef = null;

function extractText(message) {
  if (!message || message.message_type !== 'text') return '';
  try { return (JSON.parse(message.content).text || '').trim(); } catch { return ''; }
}
// 问句：全/半角问号结尾 → 想要反馈；否则静默记
const isQuestion = (t) => /[?？]\s*$/.test(t);

// 发一条文本回私信（用本应用令牌——chat_id 是应用维度的，拿主应用令牌发不进这个会话）
async function sendText(chatId, text) {
  const token = await getBotToken();
  const res = await fetch(`${feishuBase()}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) }),
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`发送失败(${j.code}): ${j.msg || '未知错误'}`);
}

// 用户背景 + 理解口径——决定回复答不答得对路（改这一处即可，日后可移到设置页）。
const USER_CONTEXT = `你在跟【用户本人】私聊，当他的思考搭子。
背景：用户是独立 AI 产品人 / 内容创作者，自己在做一个"知识→内容"的工作台（把高价值信息沉淀成认知、再产出多平台内容：公众号/小红书/抖音等）；日常关注 AI 产品与模型、Agent、内容创作、独立开发。
理解口径（重要）：消息里的术语默认按 **AI / 科技 / 产品 / 内容创作** 领域理解，**不要往金融、炒币、投资标的上带**。例如 "fable5"/"Fable 5" 指 Anthropic 的 Claude Fable 5 模型；"上"多半指"要不要用/接入/上手"，不是"建仓"。拿不准就往 AI/产品/写作 场景靠。`

async function generateReply(text, cardHits = []) {
  const { chat } = await import('./llm.js');
  // 命中灵感库时把卡喂进上下文——回复要能接上"你自己存过的方案"，而不是泛泛而谈
  const ctx = cardHits.length
    ? `\n他自己的「产品灵感库」里有相关存货，回复时自然引用（这是他之前亲手存的，比外部建议优先）：\n${cardHits.map(n => (n.excerpt || '').slice(0, 220)).join('\n---\n')}`
    : '';
  const sys = `${USER_CONTEXT}${ctx}
回应方式：中文、口语、简短（2-4 句）。是问题就给要点判断 + 一个提醒或反问；是想法就点出值得深挖的角度或一个坑。别客套、别复述原话、别列长清单。`;
  // chat() 返回 { success, content }（不抛错、不返回字符串）——读 content，失败则不回
  const res = await chat([{ role: 'system', content: sys }, { role: 'user', content: text }], 'deepseek');
  if (!res?.success) { console.warn('[feishu-bot] DeepSeek 生成回复失败:', res?.error); return ''; }
  return (res.content || '').trim();
}

// ===== 产品灵感库·无界面试点（ADR-060）：飞书私信是用户的真实入口 =====
const apiBase = () => `http://127.0.0.1:${process.env.PORT || 3000}`;

// 查灵感库：只认带卡标记的素材，分数过槛才算命中（沿用实测阈值，宁可空手不硬凑）
async function searchCards(text) {
  try {
    const r = await fetch(`${apiBase()}/api/notes/search-semantic?q=${encodeURIComponent(text.slice(0, 200))}&limit=5`);
    const j = await r.json();
    return (j.data || [])
      .filter(n => (n.score || 0) >= 0.6 && /^【(方案卡|灵感卡)/.test(n.excerpt || ''))
      .slice(0, 2);
  } catch (e) { console.warn('[feishu-bot] 查灵感库失败:', e.message); return []; }
}

function cardBrief(n) {
  const ex = n.excerpt || '';
  const head = ex.split('\n')[0].replace(/^【[^】]*】/, '');
  const sol = ex.match(/【方案】([^\n]+)/)?.[1];
  return sol ? `「${head}」→ ${sol}` : `「${head}」`;
}

// 非问句分诊：方案/启发→攒卡；需求→查库；其余→note。
// 宁漏勿凑：拿不准一律 note（硬凑的卡比没有更毒，同留痕钩子的哲学）。
async function triageMessage(text) {
  const { chat } = await import('./llm.js');
  const sys = `${USER_CONTEXT}
把这条私信分类，只输出 JSON、不要其它文字。kind 取值：
- "solution"：丢来一个具体工具/项目/做法，且流露想用、有启发、值得存（常带链接或名字）
- "inspiration"：一段观点/见闻给了他产品上的启发（没有具体工具）
- "need"：他说想做某东西/想解决某问题，在找办法
- "note"：其它（随手记、感想、日常）——拿不准一律 note
kind=solution 时补字段：problem（他日后会拿来搜回这张卡的一句大白话：这方案解决什么）、solution（名字）、url（消息里的链接，没有则空串）、gist（要点一句）、adapt（对他的知识工作台怎么用，一句，口气是提议）
kind=inspiration 时补：insight（启发一句）、source（来源）、application（对他产品的应用提议一句）`;
  const res = await chat([{ role: 'system', content: sys }, { role: 'user', content: text }], 'deepseek');
  if (!res?.success) return { kind: 'note' };
  try { return JSON.parse(res.content.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch { return { kind: 'note' }; }
}

// 走本机 /api/notes 存卡——复用标题/关键词/向量/主题匹配整条管道，存入即可被语义检索
async function saveCard(t, text) {
  const isSol = t.kind === 'solution';
  const excerpt = isSol
    ? `【方案卡·问题】${t.problem || text.slice(0, 60)}\n【方案】${t.solution || ''}${t.url ? ` — ${t.url}` : ''}\n【要点】${t.gist || ''}\n【怎么改造进我的产品】${t.adapt || ''}`
    : `【灵感卡·启发】${t.insight || text.slice(0, 60)}\n【来源】${t.source || '飞书私信'}\n【对我产品的应用】${t.application || ''}`;
  const r = await fetch(`${apiBase()}/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ excerpt, noteType: 'insight', sourceTitle: (isSol ? t.solution : t.source) || null, sourceUrl: t.url || null }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.error || '保存失败');
  // 回执带上方案名/链接——用户发的是裸链接时，不带这个他认不出这卡对应哪条消息（2026-07-29 实证）
  const receipt = isSol
    ? `🧩 已存方案卡：「${t.problem}」→ ${t.solution || ''}${t.url ? `\n${t.url}` : ''}\n「怎么改造」那栏是我起草的，要改直接说。`
    : `💡 已存灵感卡：「${t.insight}」`;
  return { receipt, noteId: j.data?.id || null };
}

async function handleMessage(data) {
  const msg = data?.message;
  console.log(`[feishu-bot] 收到消息事件: chat_type=${msg?.chat_type} msg_type=${msg?.message_type}`); // 诊断：确认事件到达
  if (!msg || msg.chat_type !== 'p2p') return; // 只收私信，群消息不碰
  const text = extractText(msg);
  if (!text) return; // 非文本（图片/文件等）跳过
  const chatId = msg.chat_id;
  const asked = isQuestion(text);

  // 幂等闸门（必须在任何 LLM/回复之前）：飞书对未及时确认的事件会拉长间隔重推十几个小时
  //（2026-07-29 实证：同一条消息 09:18→21:55 五连推，每推重过一遍 DeepSeek → 存了 5 张措辞各异的变体卡）。
  // 先按 message_id 入库占位，重推到这里直接落空；存成卡后再回头把占位条标 accepted（不出双份）。
  const isNew = upsertInboxItem({
    objType: 'message', feishuId: msg.message_id,
    title: text.slice(0, 40), snippet: text, sourceName: '私信',
    suggested: 'idea', feishuTime: msg.create_time || null,
    extra: { chatId, asked, senderId: data?.sender?.sender_id?.open_id || null },
  });
  if (!isNew) { console.log('[feishu-bot] 重推事件已处理过，跳过:', msg.message_id); return; }

  if (asked) {
    try {
      // 试点检索半环：先查他自己的灵感库，命中就带着答（ADR-060）
      const hits = await searchCards(text);
      let reply = await generateReply(text, hits);
      if (hits.length) {
        reply = `📌 你之前存过：${hits.map(cardBrief).join('；')}\n${reply}`;
        console.log(`[feishu-bot] 灵感库捞回命中 ${hits.length} 张（问句）`);
      }
      if (reply) await sendText(chatId, reply);
    } catch (e) {
      console.error('[feishu-bot] 回复失败（多半缺 im:message 发送权限，捕获照常）:', e.message);
    }
  } else {
    // 试点捕获半环：非问句先分诊——方案/启发攒卡并回执，需求查库回聊，其余照旧静默（ADR-060）
    try {
      const t = await triageMessage(text);
      if (t.kind === 'solution' || t.kind === 'inspiration') {
        const { receipt, noteId } = await saveCard(t, text);
        // 卡已入素材库——占位的待整理条标记落地，收件箱不再出现这条
        markTriagedByFeishuId(msg.message_id, { status: 'accepted', resultKind: 'note', resultId: noteId });
        await sendText(chatId, receipt);
      } else if (t.kind === 'need') {
        const hits = await searchCards(text);
        if (hits.length) {
          const reply = `📌 灵感库里你存过：${hits.map(cardBrief).join('；')}`;
          console.log(`[feishu-bot] 灵感库捞回命中 ${hits.length} 张（需求）`);
          await sendText(chatId, reply);
        }
      }
    } catch (e) {
      console.error('[feishu-bot] 试点分诊失败（消息照常进待整理）:', e.message);
    }
  }
}

// 启动长连接监听。幂等；未配置/启动失败只记日志不中断服务。
export async function startFeishuBot() {
  if (started) return { ok: true, already: true };
  if (!botConfigured()) return { ok: false, error: '笔记机器人未配置（.env 缺 FEISHU_BOT_APP_ID / FEISHU_BOT_APP_SECRET），未启动' };
  if (process.env.FEISHU_BOT_ENABLED === 'false') return { ok: false, error: 'FEISHU_BOT_ENABLED=false，私信机器人已手动关闭' };
  try {
    const lark = await import('@larksuiteoapi/node-sdk');
    const wsClient = new lark.WSClient({
      appId: botAppId(),
      appSecret: botAppSecret(),
    });
    const dispatcher = new lark.EventDispatcher({}).register({
      // 不 await——处理链里有 DeepSeek（动辄 10s+），await 会让 SDK 的事件确认迟到，
      // 飞书判投递失败后拉长间隔重推十几小时（变体卡连环案的另一半根因）。
      // 立即返回先确认，重活后台跑；失败靠幂等闸门保证重推无害。
      'im.message.receive_v1': (d) => { handleMessage(d).catch(e => console.error('[feishu-bot] 后台处理失败:', e.message)); },
    });
    wsClient.start({ eventDispatcher: dispatcher });
    wsRef = wsClient;
    started = true;
    console.log('🤖 飞书私信机器人已启动（长连接监听 im.message.receive_v1；问句带库答、方案/启发攒卡、需求查库、其余静默记——ADR-060 试点）');
    return { ok: true };
  } catch (e) {
    console.error('[feishu-bot] 长连接启动失败:', e.message);
    return { ok: false, error: e.message };
  }
}

export function feishuBotStarted() { return started; }
