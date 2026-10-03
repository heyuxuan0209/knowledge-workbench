// 内容身份的确定性规则。采集入口可以不同，但指向同一原文 URL 时仍是同一篇文章。
// 这一层不做语义猜测，只去掉不改变文章身份的网址差异。
export function canonicalizeContentUrl(raw = '') {
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return String(raw || '').trim();
  }
}

// 只有 HTTP(S) 原文才能当作跨采集源的稳定身份；空值或脏值不得强制合并。
export function canonicalArticleIdentity(raw = '') {
  const canonical = canonicalizeContentUrl(raw);
  try {
    const url = new URL(canonical);
    return url.protocol === 'http:' || url.protocol === 'https:' ? canonical : null;
  } catch {
    return null;
  }
}
