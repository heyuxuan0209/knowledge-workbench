import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveVideoSourceState, shouldDeliverAsVideo } from './video-content.js';

test('旧调用方漏传 contentType 时，YouTube 和 B站仍路由到视频机器人', () => {
  assert.equal(shouldDeliverAsVideo({ url: 'https://youtu.be/abc' }), true);
  assert.equal(shouldDeliverAsVideo({ url: 'https://www.bilibili.com/video/BV1xx' }), true);
});

test('X 是否走视频机器人以摄入结果为准，不把普通推文误判为视频', () => {
  const url = 'https://x.com/user/status/123';
  assert.equal(shouldDeliverAsVideo({ url }), false);
  assert.equal(shouldDeliverAsVideo({ url, cached: { type: 'tweet' } }), false);
  assert.equal(shouldDeliverAsVideo({ url, cached: { type: 'video', metadata: { platform: 'X' } } }), true);
});

test('显式 video 类型兼容旧客户端，材料状态能区分完整、部分和失败', () => {
  assert.equal(shouldDeliverAsVideo({ contentType: 'video', url: 'https://example.com/a' }), true);
  assert.equal(deriveVideoSourceState({ sourceStatus: 'full' }), 'full');
  assert.equal(deriveVideoSourceState({ sourceTruncated: true }), 'partial');
  assert.equal(deriveVideoSourceState({ note: '视频转写失败，仅解读了推文文字' }), 'failed');
});
