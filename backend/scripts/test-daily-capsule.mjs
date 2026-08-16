#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateCapsule } from './validate-daily-capsule.mjs';

const ledger = { date: '2026-08-16', conversations: [{ evidenceRef: 'turn:0001', user: '刚才说的：\n- 记住：不要猜我的偏好' }], commits: [], automationEvents: [] };
const capsule = {
  date: '2026-08-16', coverage: [], coreInsight: '', decisions: [],
  explicitMemoryInstructions: [{ quote: '记住：不要猜我的偏好', scope: '协作', evidenceRefs: ['turn:0001'] }],
  corrections: [], openThreads: [], dailyHypotheses: [], unknownUnknowns: [], omittedNoise: [],
  evidenceIndex: [{ ref: 'turn:0001', type: 'user', summary: '明确记忆指令' }],
};
assert.equal(validateCapsule(ledger, capsule).explicitMemoryInstructions, 1);
assert.equal(validateCapsule(ledger, {
  ...capsule,
  explicitMemoryInstructions: [{ quote: '记住：不要猜我的偏好', scope: '协作', evidenceRefs: ['turn:0001'] }],
}).explicitMemoryInstructions, 1);
assert.throws(() => validateCapsule(ledger, { ...capsule, explicitMemoryInstructions: [{ quote: '编造', scope: '协作', evidenceRefs: ['turn:0001'] }] }), /不是用户原文/);
console.log('daily-capsule tests passed');
