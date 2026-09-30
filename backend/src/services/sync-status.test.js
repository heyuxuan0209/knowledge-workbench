import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeChannelStatuses } from './sync-status.js';

test('单渠道失败会把整轮标为 partial，不再伪装全绿', () => {
  const result = summarizeChannelStatuses({
    aihot: { success: true },
    rss: { success: true, status: 'partial' },
    activeQuery: { success: true, status: 'skipped' },
  });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.channels, { aihot: 'success', rss: 'partial', activeQuery: 'skipped' });
});

test('所有实际执行渠道失败才算整轮 failure', () => {
  assert.equal(summarizeChannelStatuses({ rss: { success: false }, x: { status: 'skipped' } }).status, 'failure');
  assert.equal(summarizeChannelStatuses({ rss: { status: 'skipped' }, x: { status: 'skipped' } }).status, 'skipped');
});
