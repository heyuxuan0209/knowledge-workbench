import { chat } from './llm.js';

// 容错解析 LLM 的 JSON：DeepSeek 偶尔加代码围栏或前后缀说明，直接 JSON.parse 整段会挂 →
// 截取第一个 { 到最后一个 } 再 parse。失败返回 null（调用方按"本轮没结果"降级，绝不错位）。
function extractJson(text) {
  if (!text) return null;
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

// Feed 内容相关性过滤与摘要（2026-07-14 用户决策）：
// - 保留口径：AI / 软件工程 / 科技产品与创业 相关；纯社会新闻、生活方式类不入库
// - 一次 LLM 调用批量判断，控制成本（Deepseek，几十条标题一次 ≈ ¥0.001）

// items: [{ id, title }] → Set<id>（相关的 id 集合）。LLM 失败时保守放行全部（宁多勿漏）。
//
// ⚠️ 配对铁律（2026-07-23 title/summary 错位 bug 定位）：批处理结果**必须靠 LLM 回带的序号 i
// 显式绑定**，绝不靠数组下标位置对齐。旧实现用 flags[i]/arr[i] 按位置 zip 回来，一旦 LLM
// 漏一条/合并/重排，后面全体错位一格 → 相邻条目张冠李戴（实证：Bilibili/X 相邻两条互串摘要）。
export async function filterRelevant(items) {
  if (!items.length) return new Set();

  const list = items.map((it, i) => `${i}. ${it.title}`).join('\n');
  const result = await chat([{
    role: 'user',
    content: `逐条判断以下标题是否与「AI / 软件工程 / 科技产品与创业」相关。
纯社会新闻、慈善捐赠、健康生活、政治等无关内容判 false。
必须回带每条的序号 i（就是下面给的编号，别改、别合并、别漏）。
只输出 JSON（不要代码块）：{"results": [{"i": 0, "relevant": true}, {"i": 1, "relevant": false}, ...]}

${list}`,
  }]);

  if (!result.success) {
    console.warn('⚠️ relevance filter LLM failed, keeping all:', result.error);
    return new Set(items.map(it => it.id));
  }
  try {
    const arr = extractJson(result.content)?.results;
    if (!Array.isArray(arr)) throw new Error('bad shape');
    // 宁多勿漏：默认全留，只删「LLM 明确按序号 i 判定 false」的——序号绑定，漏判的条目安全保留
    const kept = new Set(items.map(it => it.id));
    for (const e of arr) {
      if (Number.isInteger(e?.i) && e.i >= 0 && e.i < items.length && e.relevant === false) {
        kept.delete(items[e.i].id);
      }
    }
    return kept;
  } catch {
    console.warn('⚠️ relevance filter parse failed, keeping all');
    return new Set(items.map(it => it.id));
  }
}

// 批量生成一句话中文摘要。items: [{ id, title, excerpt }] → Map<id, summary>
// excerpt 为原文首段（可为空，为空则基于标题保守概括并注明）
// 配对靠 LLM 回带的序号 i 显式绑定（见 filterRelevant 上方铁律），漏判的条目不给摘要、绝不错位。
export async function batchSummarize(items) {
  if (!items.length) return new Map();

  const list = items.map((it, i) =>
    `${i}. 标题：${it.title}\n   原文摘录：${(it.excerpt || '（无，仅有标题）').slice(0, 600)}`
  ).join('\n\n');

  const prompt = `为以下每条内容写一句中文摘要（40-70字，说清"讲了什么、为什么值得看"）。
有原文摘录的基于摘录写；只有标题的基于标题保守概括，不要编造细节。
必须回带每条的序号 i（就是下面给的编号，与该条一一对应，别改、别合并、别漏）。
只输出 JSON（不要代码块）：{"summaries": [{"i": 0, "summary": "..."}, {"i": 1, "summary": "..."}, ...]}

${list}`;

  const map = new Map();
  // 一次重试：瞬时 API 失败/整段没解析出来，不该让整批条目静默丢摘要（漏摘要在同步侧会常驻 null）
  for (let attempt = 0; attempt < 2 && map.size === 0; attempt++) {
    const result = await chat([{ role: 'user', content: prompt }]);
    if (!result.success) continue;
    const arr = extractJson(result.content)?.summaries;
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      const i = e?.i, summary = e?.summary;
      if (Number.isInteger(i) && i >= 0 && i < items.length && typeof summary === 'string' && summary.trim()) {
        map.set(items[i].id, summary.trim()); // 按 i 绑定，不按数组位置——彻底断掉错位
      }
    }
  }
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
