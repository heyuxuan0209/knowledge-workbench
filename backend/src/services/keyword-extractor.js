import OpenAI from 'openai';

const deepseekClient = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  baseURL: 'https://api.deepseek.com'
});

// 使用 Deepseek 提取关键词
export async function extractKeywords(title, summary) {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('⚠️  DEEPSEEK_API_KEY not set, skipping keyword extraction');
    return null;
  }

  try {
    const response = await deepseekClient.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: '你是一个关键词提取专家。从文章标题和摘要中提取 3-5 个最重要的关键词，用逗号分隔。只返回关键词，不要其他内容。'
        },
        {
          role: 'user',
          content: `标题：${title}\n摘要：${summary}`
        }
      ],
      temperature: 0.3,
      max_tokens: 50
    });

    const keywords = response.choices[0]?.message?.content?.trim();
    return keywords || null;
  } catch (error) {
    console.error('Failed to extract keywords:', error.message);
    return null;
  }
}

// 批量提取关键词（带延迟，避免 API 限流）
export async function batchExtractKeywords(items, delayMs = 500) {
  const results = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.log(`Extracting keywords for item ${i + 1}/${items.length}: ${item.title.substring(0, 30)}...`);

    const keywords = await extractKeywords(item.title, item.summary);
    results.push({
      ...item,
      extracted_keywords: keywords
    });

    // 延迟避免限流
    if (i < items.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
