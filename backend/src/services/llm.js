import OpenAI from 'openai';

// Deepseek API 配置（兼容 OpenAI SDK）。
// 惰性初始化：ESM import 提升会让模块级 new OpenAI() 先于 CLI 脚本的 dotenv.config()
// 执行，此时 DEEPSEEK_API_KEY 还没加载，新版 openai SDK 直接抛错。
let _client = null;
function deepseekClient() {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseURL: 'https://api.deepseek.com'
    });
  }
  return _client;
}

// Qwen（阿里云百炼，OpenAI 兼容）——高频杂活省钱通道（2026-08-03，成本分级）。
// 分工：相关性打分/翻译/起标题/提关键词等简单高频活走 qwen（输入¥0.2/M,便宜5倍）；
// 写稿/报告/thread/同化等生成任务留 deepseek v4-pro（质量优先）。调用点用 chat(msgs,'qwen') 指定。
let _qwenClient = null;
function qwenClient() {
  if (!_qwenClient) {
    _qwenClient = new OpenAI({
      apiKey: process.env.QWEN_API_KEY || '',
      baseURL: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    });
  }
  return _qwenClient;
}
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen3.5-flash';

// Deepseek 模型名（2026-07 改版：deepseek-chat 作废，官方只认 deepseek-v4-pro / deepseek-v4-flash）。
// 默认走 v4-pro（质量优先，对齐内容北极星）；可用 DEEPSEEK_MODEL 覆盖（如批量任务省钱切 v4-flash）。
export const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';

// Claude API 配置（备选）
// TODO: 后续实现 Anthropic SDK

// 计算成本（粗估，仅用于日志）。qwen3.5-flash 约 ¥0.2/M 输入,deepseek-v4-pro 约 ¥3/M 输入。
function calculateCost(tokens, provider = 'deepseek') {
  if (provider === 'qwen') return (tokens / 1_000_000) * 0.5;   // qwen flash 混合估
  if (provider === 'deepseek') return (tokens / 1_000_000) * 3.0; // v4-pro 混合估
  return 0;
}

// 统计 tokens（简单估算：中文 ~1.5 tokens/字，英文 ~0.75 tokens/词）
function estimateTokens(text) {
  const chineseChars = (text.match(/[一-龥]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return Math.ceil(chineseChars * 1.5 + englishWords * 0.75);
}

// 流式聊天（SSE）
export async function* streamChat(messages, provider = 'deepseek', model = null) {
  if (provider === 'deepseek') {
    const modelName = model || DEFAULT_MODEL;

    try {
      const stream = await deepseekClient().chat.completions.create({
        model: modelName,
        messages: messages,
        stream: true
      });

      let fullContent = '';
      let totalTokens = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          fullContent += delta;
          yield {
            type: 'content',
            content: delta
          };
        }
      }

      // 估算 tokens（实际应该从 API 返回中获取）
      const inputTokens = messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
      const outputTokens = estimateTokens(fullContent);
      totalTokens = inputTokens + outputTokens;

      const cost = calculateCost(totalTokens, provider);

      yield {
        type: 'done',
        tokens: totalTokens,
        cost: cost,
        content: fullContent
      };
    } catch (error) {
      yield {
        type: 'error',
        error: error.message
      };
    }
  } else if (provider === 'claude') {
    // TODO: 实现 Claude API
    yield {
      type: 'error',
      error: 'Claude provider not implemented yet'
    };
  } else {
    yield {
      type: 'error',
      error: `Unknown provider: ${provider}`
    };
  }
}

// 非流式聊天（用于测试）
// options.temperature：报告类生成传 0——同样的输入尽量给同样的输出，
// 否则"重新生成"每次内容都变，用户无法信任报告（2026-07-16 反馈 #1）
export async function chat(messages, provider = 'deepseek', model = null, options = {}) {
  if (provider === 'deepseek' || provider === 'qwen') {
    const isQwen = provider === 'qwen';
    const client = isQwen ? qwenClient() : deepseekClient();
    const modelName = model || (isQwen ? QWEN_MODEL : DEFAULT_MODEL);

    try {
      const response = await client.chat.completions.create({
        model: modelName,
        messages: messages,
        // qwen3.5 默认开思考模式(慢+多花输出钱),杂活一律关掉
        ...(isQwen ? { enable_thinking: false } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {})
      });

      const content = response.choices[0]?.message?.content || '';
      const tokens = response.usage?.total_tokens || estimateTokens(content);
      const cost = calculateCost(tokens, provider);

      return {
        success: true,
        content,
        tokens,
        cost
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  } else {
    return {
      success: false,
      error: `Unknown provider: ${provider}`
    };
  }
}
