/** Ordered, bounded work. Drain active work before reporting a failure. */
export async function mapParserWork<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new TypeError("parser concurrency must be a positive integer");
  }
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await run(items[index]!, index);
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  }));
  if (failed) throw failure;
  return results;
}
