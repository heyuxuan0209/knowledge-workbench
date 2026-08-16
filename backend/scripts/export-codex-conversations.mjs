#!/usr/bin/env node
/** 从本机 Codex rollout 导出已清洗的对话层，不包含推理、工具、审批和系统消息。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { localDate, readRollouts } from './daily-diary-data.mjs';

export function redactSensitive(text = '') {
  return String(text)
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_OPENAI_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY))\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]');
}

export function exportConversations(root, date, generatedAt = new Date()) {
  const rollout = readRollouts(root, date);
  return {
    schemaVersion: 1,
    source: 'mac-codex',
    date,
    generatedAt: generatedAt.toISOString(),
    sourceFiles: rollout.files.length,
    ignoredMessages: rollout.ignored,
    conversations: rollout.conversations.map((turn) => ({
      ...turn,
      source: 'mac-codex',
      user: redactSensitive(turn.user),
      assistant: redactSensitive(turn.assistant),
      assistantContext: (turn.assistantContext || []).map(redactSensitive),
    })),
  };
}

async function main() {
  const arg = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  const root = arg('sessions-root') || path.join(process.env.HOME || '', '.codex/sessions');
  const date = arg('date') || localDate();
  const output = arg('output');
  const data = exportConversations(root, date);
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (output) fs.writeFileSync(output, text, { mode: 0o600 }); else process.stdout.write(text);
  console.error(`Mac Codex 对话导出：${data.sourceFiles} 个会话文件，${data.conversations.length} 个回合`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
