import test from 'node:test';
import assert from 'node:assert/strict';
import { diffReleaseText } from './release-diff.js';

test('关键版本 diff 区分保留、替换、删除和新增段落', () => {
  const result = diffReleaseText(
    '共同开头\n\n旧解释\n\n删除这一段\n\n共同结尾',
    '共同开头\n\n新解释\n\n共同结尾\n\n新增收束',
  );
  assert.deepEqual(result.stats, { added: 1, removed: 1, changed: 1, unchanged: 2 });
  assert.deepEqual(result.groups[1], { type: 'changed', before: ['旧解释'], after: ['新解释'] });
});

test('完全相同版本只有 unchanged', () => {
  const result = diffReleaseText('一\n\n二', '一\n\n二');
  assert.deepEqual(result.stats, { added: 0, removed: 0, changed: 0, unchanged: 2 });
});
