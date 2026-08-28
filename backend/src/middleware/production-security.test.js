import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccessProtection, createCorsOptions, parseAllowedOrigins } from './production-security.js';

const call = (middleware, { path = '/', auth = '' } = {}) => new Promise((resolve) => {
  const headers = {};
  const req = { path, ip: '127.0.0.1', socket: {}, headers: { authorization: auth }, secure: false };
  const res = {
    statusCode: 200,
    setHeader(k, v) { headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ next: false, code: this.statusCode, body, headers }); },
  };
  middleware(req, res, () => resolve({ next: true, code: 200, headers }));
});

test('origin list is trimmed', () => {
  assert.deepEqual(parseAllowedOrigins('https://a.test, https://b.test'), ['https://a.test', 'https://b.test']);
});

test('production CORS accepts configured origin and rejects another origin', async () => {
  const options = createCorsOptions({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://kw.test' });
  await new Promise((resolve, reject) => options.origin('https://kw.test', (err, ok) => err ? reject(err) : (assert.equal(ok, true), resolve())));
  await new Promise((resolve) => options.origin('https://evil.test', (err) => { assert.match(err.message, /not allowed/); resolve(); }));
});

test('access protection leaves only minimal liveness public', async () => {
  const middleware = createAccessProtection({ ACCESS_PROTECTION_ENABLED: 'true', ACCESS_USERNAME: 'judge', ACCESS_PASSWORD: 'secret' });
  assert.equal((await call(middleware, { path: '/health/live' })).next, true);
  assert.equal((await call(middleware)).code, 401);
  const auth = `Basic ${Buffer.from('judge:secret').toString('base64')}`;
  assert.equal((await call(middleware, { auth })).next, true);
});

test('enabled protection fails closed when credentials are absent', () => {
  assert.throws(() => createAccessProtection({ ACCESS_PROTECTION_ENABLED: 'true' }), /requires/);
});
