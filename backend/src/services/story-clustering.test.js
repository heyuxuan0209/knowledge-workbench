import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeContentUrl,
  clusterByVectors,
  countDistinctPublishers,
  eventTitlesCompatible,
} from './story-clustering.js';

const vec = degrees => {
  const r = degrees * Math.PI / 180;
  return [Math.cos(r), Math.sin(r)];
};

function item(id, title, day, score = 100) {
  return { id, zh_title: title, published_at: `2026-09-${String(day).padStart(2, '0')}T08:00:00Z`, external_score: score };
}

test('同一家族的不同模型版本不能并成同一事件', () => {
  assert.equal(eventTitlesCompatible('OpenAI 发布 GPT-6 Astra', '隆重推出 GPT-6.1 Sol'), false);
  assert.equal(eventTitlesCompatible('Claude Opus 5.5 发布', 'Claude Sonnet 5.5 发布'), false);
  assert.equal(eventTitlesCompatible('GPT-6.1 Sol 正式发布', '开发者实测 GPT-6.1 Sol'), true);
  assert.equal(eventTitlesCompatible('GPT-6 Sol 与 GPT-6 Luna 对比', 'GPT-6 Sol 成本下降'), true);
});

test('事件簇最多跨 7 天，长期演进不冒充同一事件', () => {
  const contents = [item('a', '某产品正式发布', 1), item('b', '某产品正式发布后的一个月回顾', 12, 90)];
  const byId = new Map([['a', vec(0)], ['b', vec(0)]]);
  const clusters = clusterByVectors(contents, byId, 0.75);
  assert.deepEqual(clusters.map(c => c.memberIds), [['a'], ['b']]);
});

test('候选必须仍像事件主条，阻止质心滚雪球吸入远端内容', () => {
  const contents = [
    item('a', '同一事件报道 A', 1, 100),
    item('b', '同一事件报道 B', 1, 90),
    item('c', '相关但开始偏移 C', 1, 80),
    item('d', '同主题下的另一件事 D', 1, 70),
  ];
  const byId = new Map([['a', vec(0)], ['b', vec(20)], ['c', vec(40)], ['d', vec(60)]]);
  const clusters = clusterByVectors(contents, byId, 0.75);
  assert.deepEqual(clusters[0].memberIds, ['a', 'b', 'c']);
  assert.deepEqual(clusters[1].memberIds, ['d']);
});

test('展示层按标准化原文 URL 去掉跨渠道重复记录', () => {
  assert.equal(
    canonicalizeContentUrl('https://www.example.com/news/?utm_source=rss&b=2&a=1#top'),
    'https://example.com/news?a=1&b=2',
  );
  const members = [
    { id: 'rss', source_id: 'official', url: 'https://example.com/news?utm_source=rss' },
    { id: 'aihot', source_id: null, url: 'https://www.example.com/news/' },
    { id: 'other', source_id: 'media', url: 'https://media.test/report' },
  ];
  assert.equal(countDistinctPublishers(members), 2);
});
