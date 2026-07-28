import { feishuBase } from './feishu-auth.js';
import { upsertInboxItem } from '../db/feishu-inbox.js';

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

async function generateReply(text) {
  const { chat } = await import('./llm.js');
  const sys = `${USER_CONTEXT}
回应方式：中文、口语、简短（2-4 句）。是问题就给要点判断 + 一个提醒或反问；是想法就点出值得深挖的角度或一个坑。别客套、别复述原话、别列长清单。`;
  // chat() 返回 { success, content }（不抛错、不返回字符串）——读 content，失败则不回
  const res = await chat([{ role: 'system', content: sys }, { role: 'user', content: text }], 'deepseek');
  if (!res?.success) { console.warn('[feishu-bot] DeepSeek 生成回复失败:', res?.error); return ''; }
  return (res.content || '').trim();
}

async function handleMessage(data) {
  const msg = data?.message;
  console.log(`[feishu-bot] 收到消息事件: chat_type=${msg?.chat_type} msg_type=${msg?.message_type}`); // 诊断：确认事件到达
  if (!msg || msg.chat_type !== 'p2p') return; // 只收私信，群消息不碰
  const text = extractText(msg);
  if (!text) return; // 非文本（图片/文件等）跳过
  const chatId = msg.chat_id;
  const asked = isQuestion(text);

  let reply = null;
  if (asked) {
    try {
      reply = await generateReply(text);
      if (reply) await sendText(chatId, reply);
    } catch (e) {
      console.error('[feishu-bot] 回复失败（多半缺 im:message 发送权限，捕获照常）:', e.message);
    }
  }
  try {
    upsertInboxItem({
      objType: 'message', feishuId: msg.message_id,
      title: text.slice(0, 40), snippet: text, sourceName: '私信',
      suggested: 'idea', feishuTime: msg.create_time || null,
      extra: { chatId, asked, reply, senderId: data?.sender?.sender_id?.open_id || null },
    });
  } catch (e) { console.error('[feishu-bot] 捕获入库失败:', e.message); }
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
      'im.message.receive_v1': async (d) => { await handleMessage(d); },
    });
    wsClient.start({ eventDispatcher: dispatcher });
    wsRef = wsClient;
    started = true;
    console.log('🤖 飞书私信机器人已启动（长连接监听 im.message.receive_v1；陈述句静默记、问句才回）');
    return { ok: true };
  } catch (e) {
    console.error('[feishu-bot] 长连接启动失败:', e.message);
    return { ok: false, error: e.message };
  }
}

export function feishuBotStarted() { return started; }
