import test from 'node:test';
import assert from 'node:assert/strict';
import { deepseekControls } from './llm.js';

test('Deepseek thinking is disabled unless a caller explicitly opts in', () => {
  assert.deepEqual(deepseekControls({ maxTokens: 1200 }), {
    thinking: { type: 'disabled' },
    max_tokens: 1200,
  });
  assert.deepEqual(deepseekControls({ thinking: true }), {
    thinking: { type: 'enabled' },
  });
});
