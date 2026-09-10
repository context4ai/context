import { recordContextDebugPerformance, currentDebugProjectRoot } from "./debugTrace.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

interface CachedRead {
  stamp: string;
  value: Promise<unknown>;
}

const commandReads = new AsyncLocalStorage<Map<string, CachedRead>>();
const MAX_READS = 64;

/** Memory only, owned by one command. Never retain a previous command's view of
 * mutable workspace files, and never cache failures or missing files. */
export function withCommandReadCache<T>(action: () => Promise<T>): Promise<T> {
  return commandReads.getStore() === undefined
    ? commandReads.run(new Map(), action)
    : action();
}

export async function reuseCommandFileRead<T>(input: {
  key: string;
  paths: readonly string[];
  read: () => Promise<T>;
}): Promise<T> {
  const cache = commandReads.getStore();
  if (cache === undefined) return input.read();
  const paths = input.paths.map((path) => resolve(path));
  const key = JSON.stringify([input.key, paths]);
  let stamp: string;
  try {
    stamp = JSON.stringify(await Promise.all(paths.map(async (path) => {
      const file = await stat(path, { bigint: true });
      return [file.dev, file.ino, file.size, file.mtimeNs, file.ctimeNs].map(String);
    })));
  } catch {
    cache.delete(key);
    return input.read();
  }
  const previous = cache.get(key);
  const projectRoot = currentDebugProjectRoot();
  if (projectRoot) await recordContextDebugPerformance({ projectRoot, operation: "command.read-cache", durationMs: 0,
    outcome: "success", counters: { paths_checked: paths.length, cache_hits: previous?.stamp === stamp ? 1 : 0,
      cache_misses: previous?.stamp === stamp ? 0 : 1, cache_invalidations: previous && previous.stamp !== stamp ? 1 : 0 },
    data: { cache_outcome: previous?.stamp === stamp ? "hit" : previous ? "changed" : "miss" } });
  if (previous?.stamp === stamp) return previous.value as Promise<T>;
  const value = Promise.resolve().then(input.read);
  cache.delete(key);
  if (cache.size >= MAX_READS) cache.delete(cache.keys().next().value!);
  const entry = { stamp, value };
  cache.set(key, entry);
  try {
    const resolved = await value;
    // A composite read may load more than MAX_READS children. Keep its completed
    // aggregate hot after those children evict the in-flight entry, but never
    // replace a newer observation of this key.
    if (!cache.has(key)) {
      if (cache.size >= MAX_READS) cache.delete(cache.keys().next().value!);
      cache.set(key, entry);
    }
    return resolved;
  } catch (error) {
    if (cache.get(key) === entry) cache.delete(key);
    throw error;
  }
}

/** Pure, synchronous derived values share the existing command lifetime. Keys
 * must include all actual inputs; never use this for workspace authority checks. */
export function reuseCommandValue<T>(key: string, calculate: () => T): T {
  const cache = commandReads.getStore();
  if (!cache) return calculate();
  const cacheKey = `derived:${key}`;
  const existing = cache.get(cacheKey) as (CachedRead & { derived?: T }) | undefined;
  if (existing && "derived" in existing) return existing.derived as T;
  const derived = calculate();
  if (cache.size >= MAX_READS) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, { stamp: key, value: Promise.resolve(derived), derived } as CachedRead & { derived: T });
  return derived;
}
