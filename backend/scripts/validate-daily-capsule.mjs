#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const allRefs = (capsule) => [
  ...capsule.decisions, ...capsule.explicitMemoryInstructions, ...capsule.corrections,
  ...capsule.openThreads, ...capsule.dailyHypotheses, ...capsule.unknownUnknowns,
].flatMap((item) => item.evidenceRefs || []);

const normalizeQuoteLayout = (text) => text
  .replace(/(?:^|\n)\s*[-*]\s+/g, '')
  .replace(/\s+/g, '');

export function validateCapsule(ledger, capsule) {
  const errors = [];
  if (capsule.date !== ledger.date) errors.push(`日期不一致：${capsule.date} != ${ledger.date}`);
  const validRefs = new Set([
    ...ledger.conversations.map((item) => item.evidenceRef),
    ...ledger.commits.map((item) => item.evidenceRef),
    ...ledger.automationEvents.map((item) => item.evidenceRef),
  ]);
  for (const ref of allRefs(capsule)) if (!validRefs.has(ref)) errors.push(`未知证据引用：${ref}`);
  const conversationsByRef = new Map(ledger.conversations.map((item) => [item.evidenceRef, item]));
  for (const instruction of capsule.explicitMemoryInstructions) {
    const normalizedQuote = normalizeQuoteLayout(instruction.quote);
    const linkedUserTexts = instruction.evidenceRefs
      .map((ref) => conversationsByRef.get(ref)?.user || '')
      .filter(Boolean);
    if (!linkedUserTexts.some((text) => normalizeQuoteLayout(text).includes(normalizedQuote))) {
      errors.push(`明确记忆指令不是用户原文：${instruction.quote.slice(0, 80)}`);
    }
  }
  const indexed = new Set(capsule.evidenceIndex.map((item) => item.ref));
  for (const ref of new Set(allRefs(capsule))) if (!indexed.has(ref)) errors.push(`证据索引缺失：${ref}`);
  if (errors.length) throw new Error(errors.join('\n'));
  return {
    conversations: ledger.conversations.length,
    usedEvidence: new Set(allRefs(capsule)).size,
    decisions: capsule.decisions.length,
    explicitMemoryInstructions: capsule.explicitMemoryInstructions.length,
    openThreads: capsule.openThreads.length,
  };
}

function render(capsule, metrics) {
  const lines = [`# 每日上下文胶囊 · ${capsule.date}`, '', `> ${capsule.coreInsight}`, '',
    `覆盖入口：${capsule.coverage.map((item) => `${item.source}（${item.generatedAt || '未知截止时间'}）`).join('；') || '无'}`,
    `压缩：${metrics.conversations} 个对话回合 → ${metrics.usedEvidence} 条使用证据`, ''];
  const section = (title, items, format) => {
    lines.push(`## ${title}`, '');
    if (!items.length) lines.push('无。', ''); else items.forEach((item) => lines.push(`- ${format(item)}`));
    lines.push('');
  };
  section('决定与取舍', capsule.decisions, (x) => `${x.statement}（${x.status}；${x.scope}）`);
  section('明确记忆指令', capsule.explicitMemoryInstructions, (x) => `“${x.quote}”（${x.scope}）`);
  section('纠正', capsule.corrections, (x) => `${x.before} → ${x.after}；${x.reason}`);
  section('开放线程', capsule.openThreads, (x) => `${x.topic}［${x.state}］；下一判断：${x.nextDecision}；阻塞：${x.blocker || '无'}`);
  section('每日假设（不进入长期记忆）', capsule.dailyHypotheses, (x) => `${x.hypothesis}（${x.confidence}）；反例/不确定性：${x.counterEvidence}；验证：${x.cheapestTest}`);
  section('可能的未知未知', capsule.unknownUnknowns, (x) => `${x.hiddenAssumption}；若成立：${x.impact}；验证：${x.cheapestTest}`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const [, , ledgerFile, capsuleFile, markdownFile] = process.argv;
  if (!ledgerFile || !capsuleFile) throw new Error('用法：validate-daily-capsule.mjs <ledger.json> <capsule.json> [report.md]');
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  const capsule = JSON.parse(fs.readFileSync(capsuleFile, 'utf8'));
  const metrics = validateCapsule(ledger, capsule);
  if (markdownFile) fs.writeFileSync(markdownFile, render(capsule, metrics), { mode: 0o600 });
  console.log(JSON.stringify(metrics));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
