import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { canonicalIndexerJson, indexerProtocolDigest, materializeIndexerStructuredContent, validateIndexerRenderedContentBlock } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { reuseCommandFileRead } from "./commandReadCache.js";

type Sections = ReturnType<typeof materializeIndexerStructuredContent>;
class RenderEntries extends Map<string, Sections> {
  hits = 0;
  misses = 0;
  override get(key: string): Sections | undefined {
    const value = super.get(key);
    if (value === undefined) this.misses++; else this.hits++;
    return value;
  }
}

const CACHE_PATH = ".tmp/context-runtime/indexer/candidate-render-cache.json";
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 256;

async function rendererIdentity(): Promise<string> {
  // In a built CLI, import.meta.url hashes the bundle containing the renderer.
  // Source launches also bind the actually resolved SDK bundle. No version-only
  // or TTL identity is used. Missing identities simply disable persisted reuse.
  const paths = [...new Set([fileURLToPath(import.meta.url), fileURLToPath(import.meta.resolve("@c4a/context"))])];
  return reuseCommandFileRead({ key: "candidate-renderer-identity", paths, read: async () => {
    const hash = createHash("sha256");
    for (const path of paths) hash.update(await readFile(path));
    return hash.digest("hex");
  } });
}

export async function loadCandidateRenderCache(root: string): Promise<{ entries: RenderEntries; identity?: string }> {
  const entries = new RenderEntries();
  let identity: string;
  try { identity = await rendererIdentity(); } catch { return { entries }; }
  const path = join(root, CACHE_PATH);
  try {
    if ((await stat(path)).size > MAX_BYTES) return { entries, identity };
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value.format !== 2 || value.renderer !== identity || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) return { entries, identity };
    for (const entry of value.entries) {
      if (typeof entry.key !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(entry.key) || !Array.isArray(entry.sections) ||
        indexerProtocolDigest(entry.sections) !== entry.digest) continue;
      for (const block of entry.sections) validateIndexerRenderedContentBlock(block);
      entries.set(entry.key, entry.sections);
    }
  } catch { /* A disposable optimization must never block production or recovery. */ }
  return { entries, identity };
}

export async function saveCandidateRenderCache(root: string, cache: Awaited<ReturnType<typeof loadCandidateRenderCache>>): Promise<void> {
  if (cache.identity === undefined) return;
  const entries = [...cache.entries].slice(-MAX_ENTRIES).map(([key, sections]) => ({ key, sections, digest: indexerProtocolDigest(sections) }));
  const text = canonicalIndexerJson({ format: 2, renderer: cache.identity, entries });
  if (Buffer.byteLength(text) > MAX_BYTES) return;
  try { await atomicWriteFile(join(root, CACHE_PATH), text); } catch { /* Cache is not a receipt or a delivery condition. */ }
}
