import { feishuConfigured, feishuFetch } from './feishu-auth.js';
import { upsertInboxItem } from '../db/feishu-inbox.js';

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

// 发一条文本回私信（需 im:message 发送权限；无权限会抛，捕获不受影响）
async function sendText(chatId, text) {
  await feishuFetch('/open-apis/im/v1/messages', {
    method: 'POST',
    query: { receive_id_type: 'chat_id' },
    body: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) },
  });
}

async function generateReply(text) {
  const { chat } = await import('./llm.js');
  const sys = '你是用户的思考搭子。用户在飞书私信里随手抛来一个想法或问题。用中文、口语、简短（2-4 句）回应：是问题就给要点判断 + 一个提醒或反问；是想法就点出值得深挖的角度或一个坑。别客套、别复述原话、别列长清单。';
  const out = await chat([{ role: 'system', content: sys }, { role: 'user', content: text }], 'deepseek', null, { maxTokens: 300 });
  return (out || '').trim();
}

async function handleMessage(data) {
  const msg = data?.message;
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
  if (!feishuConfigured()) return { ok: false, error: '飞书未配置，私信机器人未启动' };
  if (process.env.FEISHU_BOT_ENABLED === 'false') return { ok: false, error: 'FEISHU_BOT_ENABLED=false，私信机器人已手动关闭' };
  try {
    const lark = await import('@larksuiteoapi/node-sdk');
    const wsClient = new lark.WSClient({
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
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
