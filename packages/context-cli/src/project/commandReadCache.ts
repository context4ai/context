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
  if (previous?.stamp === stamp) return previous.value as Promise<T>;
  const value = Promise.resolve().then(input.read);
  cache.delete(key);
  if (cache.size >= MAX_READS) cache.delete(cache.keys().next().value!);
  const entry = { stamp, value };
  cache.set(key, entry);
  try {
    return await value;
  } catch (error) {
    if (cache.get(key) === entry) cache.delete(key);
    throw error;
  }
}
