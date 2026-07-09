import OpenAI from 'openai';

// Deepseek API 配置（兼容 OpenAI SDK）
const deepseekClient = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  baseURL: 'https://api.deepseek.com'
});

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
      const stream = await deepseekClient.chat.completions.create({
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
      const response = await deepseekClient.chat.completions.create({
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
