import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('视频来源完整度和全程补转状态可持久化', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kw-ingest-cache-test-'));
  process.env.DB_PATH = join(dir, 'app.db');
  try {
    const { getIngestSource, setIngestCache } = await import('./ingest-cache.js');
    const url = 'https://x.com/user/status/987654321';
    setIngestCache(url, { type: 'video' }, 'test', {
      body: 'partial transcript', transcript: [{ text: 'partial transcript' }],
      status: 'partial', note: '仅覆盖前 40 分钟', durationSeconds: 10800, fullAttempted: true,
    });
    assert.deepEqual(getIngestSource(url), {
      body: 'partial transcript', transcript: [{ text: 'partial transcript' }],
      status: 'partial', note: '仅覆盖前 40 分钟', durationSeconds: 10800, fullAttempted: true,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
