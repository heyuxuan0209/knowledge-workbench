import { chat } from './llm.js';

// 事件簇拆分复核（P1 §六 返工③）：embedding 只管召回（易把"同主体+相似句式"的不同事件合起来），
// 聚簇后对每个多源簇做一次便宜的 DeepSeek 裁决——判成员是不是"同一个具体事件的多源报道"，
// 把"同主体不同事件 / 无关误聚"拆开。符合"embedding 管召回、便宜裁决管精度、代码管流程"的骨架。
// ~37 簇/天、每簇一次调用，成本忽略。失败/解析不出 → 原样不拆（不阻塞聚簇）。
//
// 返回：分组（成员下标数组的数组），如 [[0,1,2],[3]]。调用方保留 ≥2 的组、丢弃拆出的单条。

export async function splitReviewCluster(members) {
  if (members.length < 2) return [members.map((_, i) => i)];
  // 3 条以内且标题高度雷同的先不折腾；直接送审也行，这里统一送审（简单一致）
  const list = members.map((m, i) =>
    `${i}. 标题：${(m.zh_title || m.en_title || '').slice(0, 70)}\n   摘要：${(m.zh_summary || '').slice(0, 90)}`
  ).join('\n');

  const prompt = `下面 ${members.length} 条内容被自动聚成了"同一件事的多源报道"。请判断它们是不是指向**同一个具体事件实例**。

核心判据（只问一句）：能不能用一句话点名"这是**哪一件**具体的事"，且每条都在讲这**同一件**？
- ✅ 能点名同一件 → 归一组，**哪怕措辞/立场/来源/角度差异极大**。
  例：同一起"某模型入侵 HuggingFace"事故被写成"联合披露/自曝/作弊/取证"——都是那一起事故 → 一组；
  同一起"苹果诉 OpenAI"被写成起诉、回应、内幕——同一案 → 一组；同一个模型的预览/解禁/正式发布 → 一组。
- ❌ 点不出同一件、其实是**多个平行的不同事件** → 按事件拆开。
  例：同一家公司同期发布的 OCR、图像3.0、量化 是**三个不同产品**（三件事）→ 拆三组；
  "销售团队如何用X"和"数据科学团队如何用X"是**两篇不同主题的模板文**（两件事）→ 拆两组；
  Grok 的 Automations、Excel 插件、Outlook 插件是**三个不同功能发布** → 拆开；月初的报告和月末的另一产品是两件事 → 拆开。
  明显跑题的无关条 → 单独成组。

关键区别：**同一件事的不同写法 = 合**；**同一主体名下的不同事情 = 拆**。拿不准（真说不清是一件还是多件）时倾向合。
必须回带序号 i、覆盖全部 0..${members.length - 1}，只输出 JSON（不要代码块）：{"groups": [[0,1,2],[3]]}

${list}`;

  const result = await chat([{ role: 'user', content: prompt }], 'deepseek', null, { temperature: 0 });
  const fallback = [members.map((_, i) => i)];
  if (!result.success) return fallback;
  try {
    const s = result.content.indexOf('{'), e = result.content.lastIndexOf('}');
    if (s === -1 || e <= s) return fallback;
    const groups = JSON.parse(result.content.slice(s, e + 1)).groups;
    if (!Array.isArray(groups) || !groups.length) return fallback;
    // 只收合法且不重复的下标；LLM 漏掉的补成各自单组（安全，绝不丢条目）
    const seen = new Set();
    const clean = [];
    for (const g of groups) {
      if (!Array.isArray(g)) continue;
      const grp = g.filter(i => Number.isInteger(i) && i >= 0 && i < members.length && !seen.has(i) && (seen.add(i), true));
      if (grp.length) clean.push(grp);
    }
    for (let i = 0; i < members.length; i++) if (!seen.has(i)) clean.push([i]);
    return clean.length ? clean : fallback;
  } catch { return fallback; }
}

// 并发跑一批簇的拆分复核（限并发，避免打爆 DeepSeek）
export async function splitReviewAll(clustersMembers, { concurrency = 6 } = {}) {
  const out = new Array(clustersMembers.length);
  let idx = 0;
  async function worker() {
    while (idx < clustersMembers.length) {
      const my = idx++;
      out[my] = await splitReviewCluster(clustersMembers[my]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, clustersMembers.length) }, worker));
  return out;
}
