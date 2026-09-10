import { loadIndexerRegistry, DEFAULT_INDEXER_REGISTRY_PATH } from "@c4a/context";
import { realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { reuseCommandFileRead } from "./commandReadCache.js";

/** Parse the same registry once per unchanged command input. Resolve the path
 * on every access so a symlink edit cannot bypass the workspace boundary. */
export async function loadCurrentIndexerRegistry(root: string): ReturnType<typeof loadIndexerRegistry> {
  const workspace = await realpath(resolve(root));
  const path = await realpath(resolve(workspace, DEFAULT_INDEXER_REGISTRY_PATH));
  const local = relative(workspace, path);
  if (local.startsWith("..") || isAbsolute(local)) throw new TypeError("Indexer registry must stay inside the Context workspace");
  const loaded = await reuseCommandFileRead({ key: "validated-indexer-registry", paths: [path], read: () => loadIndexerRegistry(workspace) });
  // Some configuration callers edit their copy before saving. Do not let a
  // not-yet-persisted edit contaminate other reads in the same invocation.
  return structuredClone(loaded);
}
