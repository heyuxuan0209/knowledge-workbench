#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function splitOutput(text) {
  const diaryMarker = '<!-- WORK_DIARY -->';
  const handoffMarker = '<!-- HANDOFF_DELTA -->';
  const diaryStart = text.indexOf(diaryMarker);
  const handoffStart = text.indexOf(handoffMarker);
  if (diaryStart < 0 || handoffStart <= diaryStart) throw new Error('Codex 输出缺少日记分隔标记');
  const diary = text.slice(diaryStart + diaryMarker.length, handoffStart).trim();
  const handoff = text.slice(handoffStart + handoffMarker.length).trim();
  if (!diary.startsWith('# 工作日记') || !handoff.startsWith('# Agent 接手增量')) {
    throw new Error('Codex 输出文档标题不符合约定');
  }
  return { diary, handoff };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [, , input, diaryOutput, handoffOutput] = process.argv;
  if (!input || !diaryOutput || !handoffOutput) {
    throw new Error('用法：split-daily-diary-output.mjs <input> <diary.md> <handoff.md>');
  }
  const { diary, handoff } = splitOutput(fs.readFileSync(input, 'utf8'));
  fs.writeFileSync(diaryOutput, `${diary}\n`, { mode: 0o600 });
  fs.writeFileSync(handoffOutput, `${handoff}\n`, { mode: 0o600 });
}
