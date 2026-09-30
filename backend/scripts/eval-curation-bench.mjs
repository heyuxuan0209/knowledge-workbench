#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { evaluateCurationGold, parseCurationGoldJsonl } from '../src/services/curation-bench.js';

const { values } = parseArgs({
  options: {
    gold: { type: 'string', short: 'g' },
    at: { type: 'string' },
    split: { type: 'string', default: 'all' },
    limit: { type: 'string', short: 'k', default: '12' },
  },
});

if (!values.gold || !values.at) {
  console.error('用法：npm run eval:curation -- --gold <gold.jsonl> --at <ISO 时间> [--split holdout] [--limit 12]');
  process.exitCode = 2;
} else {
  const now = new Date(values.at).getTime();
  const limit = Number(values.limit);
  if (!Number.isFinite(now)) throw new Error(`--at 不是合法时间：${values.at}`);
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`--limit 必须是正整数：${values.limit}`);
  const cases = parseCurationGoldJsonl(await readFile(values.gold, 'utf8'));
  const report = evaluateCurationGold(cases, { now, limit, split: values.split });
  console.log(JSON.stringify(report, null, 2));
}
