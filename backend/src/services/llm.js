import OpenAI from 'openai';

// 延迟到首次调用才创建客户端（而不是模块加载时），因为 API key 来自 .env，只有先跑过
// dotenv.config() 才读得到——ESM 的 import 在模块体自身代码之前就已解析执行完毕，如果在顶层
// 创建客户端，任何"先 import 依赖了 llm.js 的模块、再调 dotenv.config()"的入口（比如 CLI 直接
// `node src/services/sync-rss.js` 跑同步脚本）都会在 apiKey 为空字符串时提前抛错。
let deepseekClient = null;
function getDeepseekClient() {
  if (!deepseekClient) {
    deepseekClient = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseURL: 'https://api.deepseek.com'
    });
  }
  return deepseekClient;
}

// Claude API 配置（备选）
// TODO: 后续实现 Anthropic SDK


// 计算成本（Deepseek 价格：¥1/M tokens）
function calculateCost(tokens, provider = 'deepseek') {
  if (provider === 'deepseek') {
    return (tokens / 1_000_000) * 1.0; // ¥1/M tokens
  }
  // Claude 价格可以后续添加
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
    const modelName = model || 'deepseek-chat';

    try {
      const stream = await getDeepseekClient().chat.completions.create({
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
export async function chat(messages, provider = 'deepseek', model = null) {
  if (provider === 'deepseek') {
    const modelName = model || 'deepseek-chat';

    try {
      const response = await getDeepseekClient().chat.completions.create({
        model: modelName,
        messages: messages
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
