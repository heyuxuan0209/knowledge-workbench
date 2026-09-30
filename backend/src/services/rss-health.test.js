import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMultipleFeeds } from './rss.js';

test('批量 RSS 保留逐源成功与失败，成功空 feed 不算故障', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes('broken')) return new Response('upstream down', { status: 503 });
    return new Response(`<?xml version="1.0"?><rss version="2.0"><channel><title>Quiet Feed</title><link>https://quiet.example</link><description>No updates</description></channel></rss>`, {
      status: 200,
      headers: { 'content-type': 'application/rss+xml' },
    });
  };
  try {
    const result = await parseMultipleFeeds(['https://quiet.example/feed.xml', 'https://broken.example/feed.xml']);
    assert.equal(result.items.length, 0);
    assert.equal(result.feedsInfo.length, 1);
    assert.equal(result.feedResults.length, 2);
    assert.equal(result.feedResults[0].success, true);
    assert.equal(result.feedResults[0].itemCount, 0);
    assert.equal(result.feedResults[1].success, false);
    assert.match(result.feedResults[1].error, /HTTP 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
