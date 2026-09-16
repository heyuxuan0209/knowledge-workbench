import test from 'node:test';
import assert from 'node:assert/strict';
import { takeNewCandidates } from './sync-rss.js';

const item = (id, published_at) => ({ content: { id, published_at } });

test('RSS LLM candidates exclude IDs already stored and cap newest unseen items', () => {
  const rows = [
    item('old', '2026-09-15 08:00:00'),
    item('new-1', '2026-09-15 09:00:00'),
    item('new-2', '2026-09-15 10:00:00'),
  ];
  assert.deepEqual(
    takeNewCandidates(rows, new Set(['old']), 1).map(x => x.content.id),
    ['new-2'],
  );
});
