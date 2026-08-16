#!/usr/bin/env node
/** 生成 Codex 工作日记的只读数据包：会话最终文本、Git 提交、自动化结果。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const TIME_ZONE = 'Europe/Paris';
const DEFAULT_REPOS = [
  '/home/bot/projects/knowledge-workbench',
  '/home/bot/codex-feishu-bridge',
];
const DEFAULT_LOGS = [
  '/home/bot/loops/data-recall.log',
  '/home/bot/loops/export-backfill.log',
  '/home/bot/loops/publish-audit.log',
  '/home/bot/loops/monthly-briefing.log',
];

export function localDate(date = new Date(), timeZone = TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function stripBridgeContext(text = '') {
  return String(text)
    .replace(/<recommended_plugins>[\s\S]*?<\/recommended_plugins>/gi, '')
    .replace(/<feishu-bridge-capabilities>[\s\S]*?<\/feishu-bridge-capabilities>/gi, '')
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, '')
    .trim();
}

function messageText(payload) {
  return (payload.content || [])
    .filter((item) => item.type === 'input_text' || item.type === 'output_text')
    .map((item) => item.text || '').join('\n').trim();
}

function isTestMessage(text) {
  const value = text.trim();
  return !value
    || /^\/?codex\s+bind\b/i.test(value)
    || /^只回复\s+[A-Z0-9_]+(?:。|！|!)?$/u.test(value)
    || /^[A-Z][A-Z0-9_]{5,}$/u.test(value);
}

function inTargetDate(timestamp, date) {
  const parsed = new Date(timestamp);
  return Number.isFinite(parsed.valueOf()) && localDate(parsed) === date;
}

export function parseRolloutLines(lines, date) {
  const turns = new Map();
  let ignored = 0;
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { ignored += 1; continue; }
    if (event.type !== 'response_item' || event.payload?.type !== 'message') continue;
    if (!inTargetDate(event.timestamp, date)) continue;
    const role = event.payload.role;
    if (role !== 'user' && role !== 'assistant') continue;
    if (role === 'assistant' && event.payload.phase !== 'final_answer') continue;
    const text = stripBridgeContext(messageText(event.payload));
    if (isTestMessage(text)) { ignored += 1; continue; }
    const turnId = event.payload.internal_chat_message_metadata_passthrough?.turn_id
      || `${event.timestamp}-${turns.size}`;
    const turn = turns.get(turnId) || { turnId, timestamp: event.timestamp, user: '', assistant: '' };
    if (role === 'user') turn.user = text.slice(0, 6000);
    else turn.assistant = text.slice(0, 8000);
    turns.set(turnId, turn);
  }
  return {
    conversations: [...turns.values()].filter((turn) => turn.user || turn.assistant)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-80),
    ignored,
  };
}

function rolloutFiles(root, date) {
  const dateDir = path.join(root, ...date.split('-').map((part, index) => index ? part : part));
  if (!fs.existsSync(dateDir)) return [];
  return fs.readdirSync(dateDir).filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(dateDir, name));
}

function readRollouts(root, date) {
  const files = rolloutFiles(root, date);
  const lines = files.flatMap((file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean));
  return { files, ...parseRolloutLines(lines, date) };
}

function gitCommits(repo, date) {
  if (!fs.existsSync(path.join(repo, '.git'))) return [];
  try {
    const output = execFileSync('git', ['-C', repo, 'log',
      `--since=${date} 00:00:00`, `--until=${date} 23:59:59`,
      '--pretty=format:%H%x09%aI%x09%s'], { encoding: 'utf8' }).trim();
    return output ? output.split('\n').map((line) => {
      const [hash, timestamp, ...subject] = line.split('\t');
      return { repo: path.basename(repo), hash: hash.slice(0, 12), timestamp, subject: subject.join('\t') };
    }) : [];
  } catch { return []; }
}

function automationEvents(files, date) {
  const useful = /(完成|成功|失败|ERROR|WARN|回填|巡检|同步|导出|start|done|failed)/i;
  return files.flatMap((file) => {
    if (!fs.existsSync(file)) return [];
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - 256 * 1024);
    const buffer = Buffer.alloc(stat.size - start);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buffer, 0, buffer.length, start); fs.closeSync(fd);
    return buffer.toString('utf8').split('\n')
      .filter((line) => line.includes(date) && useful.test(line))
      .slice(-60).map((line) => ({ log: path.basename(file), text: line.slice(0, 1200) }));
  }).slice(-160);
}

export function buildDiaryPackage({ date, rollout, commits = [], events = [], generatedAt = new Date() }) {
  return {
    schemaVersion: 1, date, generatedAt: generatedAt.toISOString(),
    rules: {
      evidenceOnly: '只写数据包内可验证事实；区分用户陈述、Agent 结论和系统日志',
      privacy: '不含推理、工具参数、审批内容、系统指令、密钥或原始流式日志',
      retention: '普通 Bug、权限位、路径和部署细节不进入长期记忆；只有重大决策或可复用经验才列为候选，且本任务不自动写入',
    },
    counts: { conversations: rollout.conversations.length, commits: commits.length, automationEvents: events.length, ignoredMessages: rollout.ignored },
    conversations: rollout.conversations, commits, automationEvents: events,
  };
}

async function main() {
  const arg = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  const date = arg('date') || localDate();
  const sessionsRoot = arg('sessions-root') || path.join(process.env.HOME || '/home/bot', '.codex/sessions');
  const output = arg('output');
  const rollout = readRollouts(sessionsRoot, date);
  const repos = (arg('repos') || DEFAULT_REPOS.join(',')).split(',').filter(Boolean);
  const logs = (arg('logs') || DEFAULT_LOGS.join(',')).split(',').filter(Boolean);
  const data = buildDiaryPackage({ date, rollout, commits: repos.flatMap((repo) => gitCommits(repo, date)), events: automationEvents(logs, date) });
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (output) fs.writeFileSync(output, text, { mode: 0o600 }); else process.stdout.write(text);
  console.error(`日记数据包：${rollout.files.length} 个会话文件，${data.counts.conversations} 个有效回合 → ${output || 'stdout'}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
