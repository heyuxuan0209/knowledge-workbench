#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildDiaryPackage, parseRolloutLines, stripBridgeContext } from './daily-diary-data.mjs';
import { splitOutput } from './split-daily-diary-output.mjs';

assert.equal(stripBridgeContext('<recommended_plugins>secret</recommended_plugins>真正问题'), '真正问题');
const date = '2026-08-16';
const event = (payload, timestamp = '2026-08-16T10:00:00+02:00') => JSON.stringify({ timestamp, type: 'response_item', payload });
const parsed = parseRolloutLines([
  event({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: '不可收录' }] }),
  event({ type: 'message', role: 'user', internal_chat_message_metadata_passthrough: { turn_id: 'a' }, content: [{ type: 'input_text', text: '<feishu-bridge-capabilities>隐藏</feishu-bridge-capabilities>修复采集' }] }),
  event({ type: 'function_call', role: 'assistant', content: [{ type: 'output_text', text: '工具参数' }] }),
  event({ type: 'message', role: 'assistant', phase: 'commentary', internal_chat_message_metadata_passthrough: { turn_id: 'a' }, content: [{ type: 'output_text', text: '过程' }] }),
  event({ type: 'message', role: 'assistant', phase: 'final_answer', internal_chat_message_metadata_passthrough: { turn_id: 'a' }, content: [{ type: 'output_text', text: '已经修好' }] }),
  event({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '只回复 TEST_OK' }] }),
], date);
assert.deepEqual(parsed.conversations, [{ turnId: 'a', timestamp: '2026-08-16T10:00:00+02:00', user: '修复采集', assistant: '已经修好', assistantContext: ['过程'] }]);
const data = buildDiaryPackage({ date, rollout: parsed, commits: [{ subject: 'fix: 修复' }], events: [] });
assert.equal(data.counts.conversations, 1);
assert.match(data.rules.retention, /普通 Bug/);
assert.deepEqual(data.continuity, {});
assert.deepEqual(splitOutput('<!-- WORK_DIARY -->\n# 外脑手记 · 2026-08-16\n正文\n<!-- HANDOFF_DELTA -->\n# Agent 接手增量 · 2026-08-16\n增量\n<!-- MEMORY_INSTRUCTIONS -->\n# 明确记忆指令 · 2026-08-16\n记忆'), {
  diary: '# 外脑手记 · 2026-08-16\n正文',
  handoff: '# Agent 接手增量 · 2026-08-16\n增量',
  memory: '# 明确记忆指令 · 2026-08-16\n记忆',
});
console.log('daily-diary-data tests passed');
