/** Greedy longest-first assignment; missing observations use the measured median. */
export function balancedTestShards(files, count, durations) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid shard count');
  const observed = Object.values(durations);
  if (observed.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Test durations must be positive finite milliseconds');
  }
  const orderedValues = observed.toSorted((a, b) => a - b);
  const fallback = orderedValues[Math.floor(orderedValues.length / 2)] ?? 1000;
  const weight = file => durations[file] ?? fallback;
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const shards = Array.from({ length: count }, () => ({ files: [], durationMs: 0 }));
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || compare(a, b))) {
    const target = shards.reduce((best, item) =>
      item.durationMs < best.durationMs ||
      (item.durationMs === best.durationMs && item.files.length < best.files.length) ? item : best);
    target.files.push(file);
    target.durationMs += weight(file);
  }
  for (const shard of shards) shard.files.sort(compare);
  return shards;
}
