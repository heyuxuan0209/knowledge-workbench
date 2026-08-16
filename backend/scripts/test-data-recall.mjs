#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildReminderText, findDueRecords } from './data-recall.mjs';

const DAY = 86_400_000;
const now = Date.parse('2026-08-16T08:00:00+08:00');
const record = (title, platform, status, ageDays) => ({
  record_id: `${platform}-${status}-${ageDays}`,
  fields: {
    平台化标题: title,
    平台: platform,
    回收状态: status,
    发布时间: now - ageDays * DAY,
  },
});

const due = findDueRecords([
  record('公众号到期稿', '公众号', '待回收D7', 7),
  record('知乎未到期稿', '知乎', '待回收D30', 29.9),
  record('知乎到期稿', '知乎', '待回收D30', 31),
  record('X 到期但不催', 'X', '待回收D7', 20),
  record('示例可删', '小红书', '待回收D7', 20),
  record('D3 暂不覆盖', '抖音', '待回收D3', 20),
  record('已经回收', '小红书', '已回收完', 40),
], now);

assert.equal(due.length, 2);
assert.deepEqual(due.map((item) => item.title), ['知乎到期稿', '公众号到期稿']);
assert.match(buildReminderText(due), /目前有 2 条/);
assert.match(buildReminderText(due), /X 平台不催/);
console.log('data recall tests passed');
