import assert from 'node:assert/strict';
import { safeInteractionRate } from './lib/metrics.mjs';

assert.equal(safeInteractionRate(2, 10), 0.2);
assert.equal(safeInteractionRate(0, 10), 0);
assert.equal(safeInteractionRate(10, 10), 1);
assert.equal(safeInteractionRate(3, 1), null);
assert.equal(safeInteractionRate(1, 0), null);
assert.equal(safeInteractionRate(-1, 10), null);

console.log('metrics tests passed');
