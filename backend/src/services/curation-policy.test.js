import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalArticleUrl, freshnessScore, rankCuratedCandidates } from './curation-policy.js';

const NOW = new Date('2026-09-29T12:00:00Z').getTime();

test('freshnessScore 使用固定时间锚点并兼容 SQLite 时间', () => {
  assert.equal(freshnessScore('2026-09-29 00:00:00', NOW), 18);
  assert.equal(freshnessScore('2026-09-25T12:00:01Z', NOW), 12);
  assert.equal(freshnessScore('2026-09-20T12:00:01Z', NOW), 6);
  assert.equal(freshnessScore('not-a-date', NOW), 0);
});

test('透明信号排序、理由和每源一条规则保持不变', () => {
  const rows = [
    { id: 'multi', source_id: 's1', created_at: '2026-09-20T12:00:01Z', sc: 3 },
    { id: 'same-source', source_id: 's1', created_at: '2026-09-29T00:00:00Z', reg: 1 },
    { id: 'registered', source_id: 's2', created_at: '2026-09-29T00:00:00Z', reg: 1 },
    { id: 'official', source_id: 's3', created_at: '2026-09-29T00:00:00Z', tier: 'T1' },
  ];
  const ranked = rankCuratedCandidates(rows, { limit: 3, now: NOW });
  assert.deepEqual(ranked.map(item => item.candidate.id), ['multi', 'registered', 'official']);
  assert.deepEqual(ranked.map(item => item.score), [40, 40, 36]);
  assert.deepEqual(ranked.map(item => item.why), ['3 源同报 · 今日热点', '你关注的一手源新作', '官方一手']);
});

test('显式 mute 在排序前过滤且可接受数组或 Set', () => {
  const rows = [
    { id: 'a', source_id: 's1', category: '模型', created_at: '2026-09-29T00:00:00Z' },
    { id: 'b', source_id: 's2', category: '产品', created_at: '2026-09-29T00:00:00Z' },
    { id: 'c', source_id: 's3', category: '行业', created_at: '2026-09-29T00:00:00Z' },
  ];
  const ranked = rankCuratedCandidates(rows, {
    now: NOW,
    mutes: { sources: ['s1'], contents: new Set(['b']) },
  });
  assert.deepEqual(ranked.map(item => item.candidate.id), ['c']);
});

test('事件簇非主条和证据不足条目不占精选名额', () => {
  const rows = [
    { id: 'primary', source_id: 's1', story_primary_id: 'primary', created_at: '2026-09-29T00:00:00Z', sc: 2 },
    { id: 'duplicate', source_id: 's2', story_primary_id: 'primary', created_at: '2026-09-29T00:00:00Z', reg: 1 },
    { id: 'unsupported', source_id: 's3', decision_verdict: 'exclude', created_at: '2026-09-29T00:00:00Z', tier: 'T1' },
    { id: 'brief', source_id: 's4', decision_verdict: 'brief', created_at: '2026-09-29T00:00:00Z', tier: 'T1' },
  ];
  const ranked = rankCuratedCandidates(rows, { limit: 12, now: NOW });
  assert.deepEqual(ranked.map(item => item.candidate.id), ['primary', 'brief']);
});

test('不同采集源指向同一原文时只占一个精选位', () => {
  const rows = [
    { id: 'rss', source_id: 'deepmind-rss', created_at: '2026-09-29T00:00:00Z', reg: 1,
      url: 'https://www.deepmind.google/blog/gemini-4-argon/?utm_source=rss' },
    { id: 'aihot', source_id: null, src: 'AI HOT', created_at: '2026-09-29T00:00:00Z', sc: 3,
      url: 'https://deepmind.google/blog/gemini-4-argon' },
    { id: 'replacement', source_id: 'anthropic', created_at: '2026-09-29T00:00:00Z', tier: 'T1',
      url: 'https://anthropic.com/news/example' },
  ];
  const ranked = rankCuratedCandidates(rows, { limit: 3, now: NOW });
  assert.deepEqual(ranked.map(item => item.candidate.id), ['aihot', 'replacement']);
});

test('原文 URL 去掉跟踪参数、www 和末尾斜杠', () => {
  assert.equal(
    canonicalArticleUrl({ url: 'https://WWW.Example.com/post/?utm_source=rss&b=2&a=1#part' }),
    'https://example.com/post?a=1&b=2',
  );
});
