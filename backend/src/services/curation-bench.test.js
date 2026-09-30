import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCurationGold, parseCurationGoldJsonl } from './curation-bench.js';

const NOW = new Date('2026-09-29T12:00:00Z').getTime();

test('JSONL 金标校验重复 case 和非法 decision', () => {
  assert.throws(
    () => parseCurationGoldJsonl('{"caseId":"a","decision":"good","candidate":{"id":"1"}}'),
    /decision 无效/,
  );
  assert.throws(
    () => parseCurationGoldJsonl([
      '{"caseId":"a","decision":"either","candidate":{"id":"1"}}',
      '{"caseId":"a","decision":"reject","candidate":{"id":"2"}}',
    ].join('\n')),
    /caseId 重复/,
  );
});

test('评测报告暴露漏推、误推、理由覆盖和分层结果', () => {
  const cases = [
    { caseId: 'must-hot', decision: 'must_surface', stratum: 'multi_source', candidate: { id: 'a', source_id: 's1', sc: 3, created_at: '2026-09-20T12:00:01Z' } },
    { caseId: 'must-shadowed', decision: 'must_surface', stratum: 'registered', candidate: { id: 'b', source_id: 's1', reg: 1, created_at: '2026-09-29T00:00:00Z' } },
    { caseId: 'okay', decision: 'acceptable', stratum: 'official', candidate: { id: 'c', source_id: 's2', tier: 'T1', created_at: '2026-09-29T00:00:00Z' } },
    { caseId: 'bad', decision: 'reject', stratum: 'fresh_only', candidate: { id: 'd', source_id: 's3', created_at: '2026-09-29T00:00:00Z' } },
  ];
  const report = evaluateCurationGold(cases, { limit: 3, now: NOW });
  assert.equal(report.metrics.mustSurfaceRecallAtK, 0.5);
  assert.equal(report.metrics.precisionAtK, 0.6667);
  assert.equal(report.metrics.rejectsSurfaced, 1);
  assert.equal(report.metrics.reasonCoverageAtK, 1);
  assert.equal(report.metrics.sourceDiversityAtK, 1);
  assert.equal(report.byStratum.registered.mustSurfaceRecallAtK, 0);
  assert.deepEqual(report.selected.map(item => item.caseId), ['must-hot', 'okay', 'bad']);
});

test('必须固定评测时间，防止新鲜度漂移', () => {
  assert.throws(
    () => evaluateCurationGold([{ caseId: 'a', decision: 'either', candidate: { id: '1' } }]),
    /固定的 now/,
  );
});
