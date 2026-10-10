#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const configPath = () => process.env.KW_CONTENT_CONFIG || resolve(homedir(), '.kw-content/config.json');

export function parseArgs(argv) {
  const flags = {};
  const words = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) { words.push(value); continue; }
    const key = value.slice(2);
    if (['json', 'dry-run', 'password-stdin', 'help'].includes(key)) flags[key] = true;
    else {
      const next = argv[index + 1];
      if (next == null || next.startsWith('--')) throw cliError('INVALID_ARGUMENT', `--${key} requires a value`);
      flags[key] = next; index += 1;
    }
  }
  return { flags, words };
}

function cliError(code, message, details = {}) {
  const error = new Error(message); error.code = code; Object.assign(error, details); return error;
}

async function loadConfig(env = process.env) {
  let file = {};
  const path = configPath();
  try { file = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw cliError('CONFIG_INVALID', `Cannot read ${path}: ${error.message}`); }
  return {
    baseUrl: String(env.KW_CONTENT_BASE_URL || file.baseUrl || 'http://localhost:3000').replace(/\/$/, ''),
    username: env.KW_CONTENT_USERNAME || file.username || '',
    password: env.KW_CONTENT_PASSWORD || file.password || '',
    authSource: env.KW_CONTENT_USERNAME || env.KW_CONTENT_PASSWORD ? 'env' : (file.username || file.password ? 'config' : 'missing'),
  };
}

async function api(path, { method = 'GET', body, config } = {}) {
  const cfg = config || await loadConfig();
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cfg.username || cfg.password) headers.Authorization = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`;
  let response;
  try { response = await fetch(`${cfg.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (error) { throw cliError('NETWORK_ERROR', `Cannot reach ${cfg.baseUrl}: ${error.message}`); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw cliError(response.status === 401 ? 'AUTH_REQUIRED' : 'API_ERROR', payload.error || `HTTP ${response.status}`, { status: response.status });
  return payload.data ?? payload;
}

async function resolveWork(input, config, client = api) {
  if (!input) throw cliError('INVALID_ARGUMENT', 'A work ID or title query is required');
  try {
    const exact = await client(`/api/works/${encodeURIComponent(input)}/lineage`, { config });
    return exact.work;
  } catch (error) { if (error.status !== 404) throw error; }
  const results = await client(`/api/works?query=${encodeURIComponent(input)}&limit=20`, { config });
  const exactTitle = results.filter(work => work.title === input);
  const matches = exactTitle.length ? exactTitle : results;
  if (!matches.length) throw cliError('NOT_FOUND', `No work matches: ${input}`);
  if (matches.length > 1) throw cliError('AMBIGUOUS', `More than one work matches: ${input}`, { matches: matches.map(work => ({ id: work.id, title: work.title })) });
  return matches[0];
}

function help() {
  return `kw-content — continue one KW work across Codex CLI, desktop AI, and KW

Usage:
  kw-content [--json] doctor
  kw-content [--json] init [--base-url URL] [--username NAME] [--password-stdin]
  kw-content [--json] works list [--query TEXT] [--limit N]
  kw-content [--json] works resolve <id-or-title>
  kw-content [--json] works get <id-or-title>
  kw-content [--json] releases get <release-id>
  kw-content [--json] handoff get <id-or-title> [--format markdown]
  kw-content [--json] continue <id-or-title> [--out FILE]
  kw-content [--json] checkpoint <id-or-title> --file FILE [--title TEXT] [--parent RELEASE] [--dry-run]
  kw-content [--json] request get </api/path>

Config precedence: KW_CONTENT_* environment variables, then ~/.kw-content/config.json.
Writes are explicit: checkpoint supports --dry-run and never publishes or deletes.`;
}

function human(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').replace(/[\r\n]+$/, '');
}

export async function run(argv, { output = console.log, errorOutput = console.error, apiClient = api } = {}) {
  const { flags, words } = parseArgs(argv);
  const jsonMode = !!flags.json;
  if (flags.help || !words.length || words[0] === 'help') { output(help()); return 0; }
  try {
    let data;
    const [noun, verb, id] = words;
    if (noun === 'init') {
      let existing = {};
      const path = configPath();
      try { existing = JSON.parse(await readFile(path, 'utf8')); } catch { /* first setup */ }
      const next = { ...existing };
      if (flags['base-url']) next.baseUrl = flags['base-url'].replace(/\/$/, '');
      if (flags.username) next.username = flags.username;
      if (flags['password-stdin']) next.password = await readStdin();
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await chmod(path, 0o600);
      data = { configPath: path, baseUrl: next.baseUrl || 'http://localhost:3000', usernameConfigured: !!next.username, passwordConfigured: !!next.password };
    } else if (noun === 'doctor') {
      const config = await loadConfig();
      let reachable = false; let service = null; let problem = null;
      try { service = await apiClient('/health', { config }); reachable = true; } catch (error) { problem = { code: error.code, message: error.message, status: error.status || null }; }
      data = { command: process.argv[1], configPath: configPath(), baseUrl: config.baseUrl, auth: { configured: !!(config.username && config.password), source: config.authSource }, reachable, service, problem };
    } else if (noun === 'works' && verb === 'list') {
      const limit = Math.min(Math.max(Number.parseInt(flags.limit || '20', 10) || 20, 1), 100);
      data = await apiClient(`/api/works?query=${encodeURIComponent(flags.query || '')}&limit=${limit}`);
    } else if (noun === 'works' && verb === 'resolve') {
      data = await resolveWork(id, undefined, apiClient);
    } else if (noun === 'works' && verb === 'get') {
      const work = await resolveWork(id, undefined, apiClient); data = await apiClient(`/api/works/${encodeURIComponent(work.id)}/lineage`);
    } else if (noun === 'releases' && verb === 'get') {
      if (!id) throw cliError('INVALID_ARGUMENT', 'A release ID is required');
      data = await apiClient(`/api/releases/${encodeURIComponent(id)}`);
    } else if (noun === 'handoff' && verb === 'get') {
      const work = await resolveWork(id, undefined, apiClient); data = await apiClient(`/api/works/${encodeURIComponent(work.id)}/handoff`);
      if (flags.format === 'markdown' && !jsonMode) { output(data.markdown); return 0; }
    } else if (noun === 'continue') {
      const work = await resolveWork(verb, undefined, apiClient); const handoff = await apiClient(`/api/works/${encodeURIComponent(work.id)}/handoff`);
      if (!handoff.release?.id) throw cliError('NOT_FOUND', 'This work has no Release to continue');
      const release = await apiClient(`/api/releases/${encodeURIComponent(handoff.release.id)}`);
      if (flags.out) {
        const out = resolve(flags.out); await mkdir(dirname(out), { recursive: true }); await writeFile(out, release.content || '', 'utf8');
        data = { work: handoff.work, release: handoff.release, platform: handoff.platform, confirmedPreferences: handoff.confirmedPreferences, file: out, bytes: Buffer.byteLength(release.content || '') };
      } else data = { ...handoff, content: release.content || '' };
    } else if (noun === 'checkpoint') {
      const work = await resolveWork(verb, undefined, apiClient); const file = flags.file && resolve(flags.file);
      if (!file) throw cliError('INVALID_ARGUMENT', 'checkpoint requires --file FILE');
      const content = await readFile(file, 'utf8');
      const handoff = await apiClient(`/api/works/${encodeURIComponent(work.id)}/handoff`);
      const title = flags.title || content.match(/^#\s+(.+)$/m)?.[1]?.trim() || handoff.work.title || basename(file);
      const body = {
        releaseKind: 'checkpoint', artifactType: 'document', artifactRefType: 'local_file', artifactRef: file,
        parentReleaseId: flags.parent || handoff.release?.id || null, title, content,
        originTool: 'codex_cli', creatorType: 'human_ai', provenanceStatus: 'confirmed',
        metadata: { platform: handoff.platform, handoffVersion: 1 },
      };
      if (flags['dry-run']) data = { dryRun: true, work: handoff.work, request: { ...body, content: undefined, contentLength: content.length, contentSha256: createHash('sha256').update(content).digest('hex') } };
      else data = await apiClient(`/api/works/${encodeURIComponent(work.id)}/releases`, { method: 'POST', body });
    } else if (noun === 'request' && verb === 'get') {
      if (!id?.startsWith('/api/')) throw cliError('INVALID_ARGUMENT', 'request get only accepts paths beginning with /api/');
      data = await apiClient(id);
    } else throw cliError('UNKNOWN_COMMAND', `Unknown command: ${words.join(' ')}`);

    output(jsonMode ? JSON.stringify({ ok: true, data }) : human(data));
    return 0;
  } catch (error) {
    const payload = { ok: false, error: { code: error.code || 'UNEXPECTED', message: error.message, ...(error.status ? { status: error.status } : {}), ...(error.matches ? { matches: error.matches } : {}) } };
    (jsonMode ? output : errorOutput)(jsonMode ? JSON.stringify(payload) : `${payload.error.code}: ${payload.error.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await run(process.argv.slice(2));
