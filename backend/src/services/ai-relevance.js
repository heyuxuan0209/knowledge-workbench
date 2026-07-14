import { chat } from './llm.js';

// Feed 内容相关性过滤与摘要（2026-07-14 用户决策）：
// - 保留口径：AI / 软件工程 / 科技产品与创业 相关；纯社会新闻、生活方式类不入库
// - 一次 LLM 调用批量判断，控制成本（Deepseek，几十条标题一次 ≈ ¥0.001）

// items: [{ id, title }] → Set<id>（相关的 id 集合）。LLM 失败时保守放行全部（宁多勿漏）。
export async function filterRelevant(items) {
  if (!items.length) return new Set();

  const list = items.map((it, i) => `${i}. ${it.title}`).join('\n');
  const result = await chat([{
    role: 'user',
    content: `逐条判断以下标题是否与「AI / 软件工程 / 科技产品与创业」相关。
纯社会新闻、慈善捐赠、健康生活、政治等无关内容判 false。
只输出 JSON（不要代码块）：{"relevant": [true/false 数组，与序号一一对应]}

${list}`,
  }]);

  if (!result.success) {
    console.warn('⚠️ relevance filter LLM failed, keeping all:', result.error);
    return new Set(items.map(it => it.id));
  }
  try {
    const cleaned = result.content.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const flags = JSON.parse(cleaned).relevant;
    const kept = new Set();
    items.forEach((it, i) => { if (flags[i]) kept.add(it.id) });
    return kept;
  } catch {
    console.warn('⚠️ relevance filter parse failed, keeping all');
    return new Set(items.map(it => it.id));
  }
}

// 批量生成一句话中文摘要。items: [{ id, title, excerpt }] → Map<id, summary>
// excerpt 为原文首段（可为空，为空则基于标题保守概括并注明）
export async function batchSummarize(items) {
  if (!items.length) return new Map();

  const list = items.map((it, i) =>
    `${i}. 标题：${it.title}\n   原文摘录：${(it.excerpt || '（无，仅有标题）').slice(0, 600)}`
  ).join('\n\n');

  const result = await chat([{
    role: 'user',
    content: `为以下每条内容写一句中文摘要（40-70字，说清"讲了什么、为什么值得看"）。
有原文摘录的基于摘录写；只有标题的基于标题保守概括，不要编造细节。
只输出 JSON（不要代码块）：{"summaries": ["...", ...]}，与序号一一对应。

${list}`,
  }]);

  const map = new Map();
  if (!result.success) return map;
  try {
    const cleaned = result.content.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const arr = JSON.parse(cleaned).summaries;
    items.forEach((it, i) => { if (arr[i]) map.set(it.id, arr[i]) });
  } catch { /* 解析失败则无摘要，不阻塞同步 */ }
  return map;
}

// 抓取网页首段文字（供 HN 摘要用），失败返回 null，不抛错
export async function fetchFirstParagraph(url, timeoutMs = 10000) {
  try {
    const { ingestUrl } = await import('./content-ingestion.js');
    const race = await Promise.race([
      ingestUrl(url),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    if (race.fetchStatus !== 'success') return null;
    return race.body?.slice(0, 800) || null;
  } catch {
    return null;
  }
}
