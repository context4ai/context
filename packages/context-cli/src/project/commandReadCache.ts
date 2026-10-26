import { recordContextDebugPerformance, currentDebugProjectRoot } from "./debugTrace.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { DerivedValueCache } from "./derivedValueCache.js";

interface CachedRead {
  stamp: string;
  /** The stamp was taken too soon after a change to prove later changes. */
  racy: boolean;
  value: Promise<unknown>;
}

const commandReads = new AsyncLocalStorage<Map<string, CachedRead>>();
const MAX_READS = 64;
/** File systems advance timestamps in coarse ticks (ext4 by kernel tick, some
 * by whole seconds). Adding a directory entry in the same tick as an earlier
 * change leaves dev/ino/size/mtime/ctime equal, so, like Git's racily-clean
 * rule, a listing whose directory changed within this window is never reused.
 * Files need no such guard: Context replaces them atomically (new inode). */
const RACY_WINDOW_NS = 1_000_000_000n;
const commandValues = new AsyncLocalStorage<DerivedValueCache>();

/** Cache one directory listing, never the entire subtree. Every traversal
 * checks each child directory so nested additions/removals remain visible. */
export async function readCommandDirectory(path: string) {
  const entries = await reuseCommandFileRead({ key: "directory-entries", paths: [path], racyWindow: true,
    read: () => readdir(path, { withFileTypes: true }) });
  return [...entries];
}

/** Memory only, owned by one command. Never retain a previous command's view of
 * mutable workspace files, and never cache failures or missing files. */
export function withCommandReadCache<T>(action: () => Promise<T>): Promise<T> {
  return commandReads.getStore() === undefined
    ? commandValues.run(new DerivedValueCache(), () => commandReads.run(new Map(), action))
    : action();
}

export async function reuseCommandFileRead<T>(input: {
  key: string;
  paths: readonly string[];
  /** Never reuse a read whose paths changed within the timestamp window. */
  racyWindow?: boolean;
  read: () => Promise<T>;
}): Promise<T> {
  const cache = commandReads.getStore();
  if (cache === undefined) return input.read();
  const paths = input.paths.map((path) => resolve(path));
  const key = JSON.stringify([input.key, paths]);
  let stamp: string;
  let racy = false;
  try {
    const takenNs = BigInt(Date.now()) * 1_000_000n;
    stamp = JSON.stringify(await Promise.all(paths.map(async (path) => {
      const file = await stat(path, { bigint: true });
      if (input.racyWindow && file.mtimeNs + RACY_WINDOW_NS > takenNs) racy = true;
      return [file.dev, file.ino, file.size, file.mtimeNs, file.ctimeNs].map(String);
    })));
  } catch {
    cache.delete(key);
    return input.read();
  }
  const cached = cache.get(key);
  const previous = cached?.racy ? undefined : cached;
  const projectRoot = currentDebugProjectRoot();
  if (projectRoot) await recordContextDebugPerformance({ projectRoot, operation: "command.read-cache", durationMs: 0,
    outcome: "success", counters: { paths_checked: paths.length, cache_hits: previous?.stamp === stamp ? 1 : 0,
      cache_misses: previous?.stamp === stamp ? 0 : 1, cache_invalidations: previous && previous.stamp !== stamp ? 1 : 0 },
    data: { cache_outcome: previous?.stamp === stamp ? "hit" : previous ? "changed" : "miss" } });
  if (previous?.stamp === stamp) return previous.value as Promise<T>;
  const value = Promise.resolve().then(input.read);
  cache.delete(key);
  if (cache.size >= MAX_READS) cache.delete(cache.keys().next().value!);
  const entry = { stamp, racy, value };
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
  const cache = commandValues.getStore();
  return cache ? cache.get(key, calculate) : calculate();
}
