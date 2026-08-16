import assert from 'node:assert/strict';
import { buildBriefingPackage, currentMonthCst, monthRange } from './monthly-briefing-data.mjs';

const { start, end } = monthRange('2026-08');
assert.equal(new Date(start).toISOString(), '2026-07-31T16:00:00.000Z');
assert.equal(new Date(end).toISOString(), '2026-08-31T16:00:00.000Z');
assert.equal(currentMonthCst(new Date('2026-08-31T16:30:00Z')), '2026-09');

const pkg = buildBriefingPackage({
  month: '2026-08',
  generatedAt: new Date('2026-08-16T00:00:00Z'),
  contentRecords: [{ record_id: 'content-1', fields: { 母稿标题: '母稿', 验证结论: '成立' } }],
  publishRecords: [
    {
      record_id: 'pub-1',
      fields: {
        平台化标题: '文章 A', 平台: '小红书', 发布时间: Date.parse('2026-08-03T10:00:00+08:00'),
        关联母稿: [{ record_id: 'content-1' }], D3曝光: '100', D3互动率: 0.1,
      },
    },
    { record_id: 'old', fields: { 平台化标题: '旧文', 平台: '小红书', 发布时间: Date.parse('2026-07-01T10:00:00+08:00') } },
  ],
});
assert.equal(pkg.counts.publications, 1);
assert.equal(pkg.counts.linkedContents, 1);
assert.equal(pkg.publications[0].metrics.D3.exposure, 100);
assert.equal(pkg.byPlatform['小红书'].stages[0].sampleSize, 1);
assert.equal(pkg.missing.D7.length, 1);
console.log('monthly briefing data tests passed');
