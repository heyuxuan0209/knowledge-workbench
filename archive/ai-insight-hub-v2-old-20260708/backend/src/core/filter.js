/**
 * 简化筛选 - 直接使用 AI HOT 的精选内容
 * 只做基本的分数标注，不做过度筛选
 */
export function filterItems(items, preferences) {
  // 1. 只保留 AI HOT 精选的内容（selected: true）
  const selected = items.filter(item => {
    // 如果有 raw_data，解析它
    if (item.raw_data) {
      try {
        const raw = typeof item.raw_data === 'string'
          ? JSON.parse(item.raw_data)
          : item.raw_data;
        return raw.selected === true;
      } catch (e) {
        return false;
      }
    }
    return false;
  });

  // 2. 计算相关度分数（仅用于排序，不过滤）
  const scored = selected.map(item => {
    let relevance = 0;
    const titleLower = item.title.toLowerCase();
    const summaryLower = (item.summary || '').toLowerCase();
    const text = `${titleLower} ${summaryLower}`;

    // 关键词匹配加分
    preferences.keywords.include.forEach(keyword => {
      if (text.includes(keyword.toLowerCase())) {
        relevance += 10;
      }
    });

    // 分类匹配加分
    if (preferences.categories.includes(item.category)) {
      relevance += 15;
    }

    // AI HOT 原始分数作为基础
    relevance += (item.score || 50) * 0.5;

    return {
      ...item,
      relevance_score: Math.round(relevance)
    };
  });

  // 3. 按相关度和原始分数排序
  scored.sort((a, b) => {
    // 优先按相关度排序
    if (b.relevance_score !== a.relevance_score) {
      return b.relevance_score - a.relevance_score;
    }
    // 相关度相同则按 AI HOT 原始分数排序
    return (b.score || 0) - (a.score || 0);
  });

  // 4. 返回所有精选内容，不限制数量
  return scored;
}
