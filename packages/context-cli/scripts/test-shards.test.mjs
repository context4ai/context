import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balancedTestShards } from './test-shards.mjs';
test('balances uneven durations, retains each file once and is input-order independent', () => {
  const durations = { a: 100, b: 90, c: 80, d: 70, e: 60, f: 50, g: 40, h: 30 };
  const files = Object.keys(durations);
  const result = balancedTestShards(files, 4, durations);
  assert.deepEqual(result.map(x => x.durationMs), [130, 130, 130, 130]);
  assert.deepEqual(result.flatMap(x => x.files).sort(), files);
  assert.deepEqual(result, balancedTestShards(files.toReversed(), 4, durations));
});
test('new files use median, selected scopes stay separate and empty shards are valid', () => {
  const result = balancedTestShards(['new', 'a'], 4, { a: 5, b: 10, c: 20 });
  assert.equal(result.reduce((sum, x) => sum + x.durationMs, 0), 15);
  assert.deepEqual(result.flatMap(x => x.files).sort(), ['a', 'new']);
  assert.equal(result.filter(x => x.files.length === 0).length, 2);
  assert.throws(() => balancedTestShards(['a'], 0, {}));
  assert.throws(() => balancedTestShards(['a'], 1, { a: -1 }));
});
