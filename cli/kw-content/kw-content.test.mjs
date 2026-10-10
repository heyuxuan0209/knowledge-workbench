import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, run } from './kw-content.mjs';

test('argument parser separates global flags and command words', () => {
  assert.deepEqual(parseArgs(['--json', 'works', 'list', '--limit', '3']), { flags: { json: true, limit: '3' }, words: ['works', 'list'] });
});

test('doctor stays machine-readable when auth or network is unavailable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kw-content-cli-'));
  const previous = process.env.KW_CONTENT_CONFIG;
  process.env.KW_CONTENT_CONFIG = join(dir, 'missing.json');
  process.env.KW_CONTENT_BASE_URL = 'http://127.0.0.1:1';
  const lines = [];
  try {
    const code = await run(['--json', 'doctor'], { output: value => lines.push(value), apiClient: async () => { const error = new Error('offline'); error.code = 'NETWORK_ERROR'; throw error; } });
    assert.equal(code, 0);
    const payload = JSON.parse(lines[0]);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.reachable, false);
    assert.equal(payload.data.problem.code, 'NETWORK_ERROR');
  } finally {
    previous === undefined ? delete process.env.KW_CONTENT_CONFIG : process.env.KW_CONTENT_CONFIG = previous;
    delete process.env.KW_CONTENT_BASE_URL;
    await rm(dir, { recursive: true, force: true });
  }
});

test('checkpoint dry-run reports hash without performing a write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kw-content-draft-'));
  const file = join(dir, 'draft.md');
  const requests = [];
  const apiClient = async (path, options = {}) => {
    requests.push(`${options.method || 'GET'} ${path}`);
    if (path === '/api/works/work-1/lineage') return { work: { id: 'work-1', title: '旧标题' }, releases: [] };
    if (path === '/api/works/work-1/handoff') return { work: { id: 'work-1', title: '旧标题' }, release: { id: 'rel-1' }, platform: 'gzh-long' };
    throw new Error(`unexpected request: ${path}`);
  };
  await writeFile(file, '# 新标题\n\n新正文');
  const lines = [];
  try {
    const code = await run(['--json', 'checkpoint', 'work-1', '--file', file, '--dry-run'], { output: value => lines.push(value), apiClient });
    assert.equal(code, 0);
    const payload = JSON.parse(lines[0]);
    assert.equal(payload.data.dryRun, true);
    assert.equal(payload.data.request.title, '新标题');
    assert.equal(requests.some(request => request.startsWith('POST ')), false);
    assert.match(await readFile(file, 'utf8'), /新正文/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
