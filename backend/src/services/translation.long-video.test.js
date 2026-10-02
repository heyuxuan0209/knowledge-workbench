import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLongVideoChunks, summarizeLongVideo } from './translation.js';

test('长视频按字幕边界切块并覆盖到最后一个时间戳', () => {
  const transcript = Array.from({ length: 8 }, (_, index) => ({
    text: `segment-${index}-${'x'.repeat(20)}`,
    offset: index * 60_000,
    duration: 60_000,
  }));
  const chunks = buildLongVideoChunks({
    body: transcript.map(item => item.text).join(' '),
    transcript,
    metadata: { durationSeconds: 480 },
  }, 70);

  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].startSeconds, 0);
  assert.equal(chunks.at(-1).endSeconds, 480);
  assert.equal(chunks.map(chunk => chunk.text).join(' ').includes('segment-7'), true);
});

test('无结构化时间戳时按全文位置估算时间且不丢尾段', () => {
  const body = Array.from({ length: 12 }, (_, index) => `Sentence ${index}.`).join(' ');
  const chunks = buildLongVideoChunks({
    body,
    transcript: [],
    metadata: { durationSeconds: 7200 },
  }, 35);

  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].startSeconds, 0);
  assert.equal(Math.round(chunks.at(-1).endSeconds), 7200);
  assert.equal(chunks.map(chunk => chunk.text).join('').replaceAll(' ', ''), body.replaceAll(' ', ''));
});

test('长视频摘要逐段消费全部字幕并声明完整覆盖', async () => {
  const transcript = Array.from({ length: 10 }, (_, index) => ({
    text: `topic-${index}-${'x'.repeat(30)}`,
    offset: index * 1_200_000,
    duration: 1_200_000,
  }));
  const visited = [];
  const result = await summarizeLongVideo({
    title: 'Long video',
    body: transcript.map(item => item.text).join(' '),
    transcript,
    metadata: { sourceUrl: 'https://youtube.com/watch?v=test', durationSeconds: 12_000 },
  }, {
    summarizeSection: async (chunk, index, total) => {
      visited.push(chunk.text);
      return `## section ${index + 1}/${total}\n${chunk.text}`;
    },
  });

  assert.equal(visited.join(' ').includes('topic-9'), true);
  assert.match(result.zhBody, /全片覆盖说明/);
  assert.match(result.zhBody, /03:20:00/);
  assert.equal(result.coverage.coverageEndSeconds, 12_000);
  assert.equal(result.coverage.mode, 'full-transcript-map-reduce');
});

test('ASR 只覆盖前段时不得声称已覆盖全片', async () => {
  const result = await summarizeLongVideo({
    title: 'Long video without captions',
    body: 'partial transcript '.repeat(20),
    transcript: [{ text: 'partial transcript', offset: 0, duration: 2_400_000 }],
    sourceTruncated: true,
    metadata: { durationSeconds: 10_800 },
  }, { summarizeSection: async () => '## 00:00–40:00\n- partial' });

  assert.match(result.zhBody, /不代表全片/);
  assert.doesNotMatch(result.zhBody, /全片覆盖说明/);
  assert.equal(result.coverage.mode, 'partial-transcript-map-reduce');
});

test('B站和 X 视频共用全片分段摘要，不再只对 YouTube 生效', async () => {
  for (const platform of ['B站视频', 'X']) {
    const visited = [];
    const body = Array.from({ length: 10 }, (_, index) => `${platform}-尾段-${index}-${'x'.repeat(30)}`).join(' ');
    const result = await summarizeLongVideo({
      type: 'video', body, transcript: [], sourceStatus: 'full',
      metadata: { platform, sourceUrl: platform === 'X' ? 'https://x.com/a/status/1' : 'https://b23.tv/a', durationSeconds: 7200 },
    }, { summarizeSection: async (chunk) => { visited.push(chunk.text); return chunk.text; } });
    assert.equal(visited.join(' ').includes(`${platform}-尾段-9`), true);
    assert.equal(result.coverage.mode, 'full-transcript-map-reduce');
  }
});
