#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function splitOutput(text) {
  const diaryMarker = '<!-- WORK_DIARY -->';
  const handoffMarker = '<!-- HANDOFF_DELTA -->';
  const memoryMarker = '<!-- MEMORY_INSTRUCTIONS -->';
  const diaryStart = text.indexOf(diaryMarker);
  const handoffStart = text.indexOf(handoffMarker);
  const memoryStart = text.indexOf(memoryMarker);
  if (diaryStart < 0 || handoffStart <= diaryStart || memoryStart <= handoffStart) throw new Error('Codex 输出缺少日记分隔标记');
  const diary = text.slice(diaryStart + diaryMarker.length, handoffStart).trim();
  const handoff = text.slice(handoffStart + handoffMarker.length, memoryStart).trim();
  const memory = text.slice(memoryStart + memoryMarker.length).trim();
  if (!diary.startsWith('# 外脑手记') || !handoff.startsWith('# Agent 接手增量') || !memory.startsWith('# 明确记忆指令')) {
    throw new Error('Codex 输出文档标题不符合约定');
  }
  return { diary, handoff, memory };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [, , input, diaryOutput, handoffOutput, memoryOutput] = process.argv;
  if (!input || !diaryOutput || !handoffOutput || !memoryOutput) {
    throw new Error('用法：split-daily-diary-output.mjs <input> <diary.md> <handoff.md> <memory.md>');
  }
  const { diary, handoff, memory } = splitOutput(fs.readFileSync(input, 'utf8'));
  fs.writeFileSync(diaryOutput, `${diary}\n`, { mode: 0o600 });
  fs.writeFileSync(handoffOutput, `${handoff}\n`, { mode: 0o600 });
  fs.writeFileSync(memoryOutput, `${memory}\n`, { mode: 0o600 });
}
