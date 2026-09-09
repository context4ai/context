import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexerProtocolDigest, buildIndexerRenderedContentBlock } from "@c4a/context";
import { loadCandidateRenderCache, saveCandidateRenderCache } from "../project/candidateRenderCache.js";

test("render memo survives commands but ignores damaged content and a different renderer", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-render-cache-"));
  try {
    const cache = await loadCandidateRenderCache(root);
    const markdown = "# Public API\n";
    const key = indexerProtocolDigest({ source: "current" });
    const sections = [buildIndexerRenderedContentBlock({ layer: "semantic-prose", evidence_refs: ["source:public"], markdown })];
    cache.entries.set(key, sections);
    await saveCandidateRenderCache(root, cache);
    expect((await loadCandidateRenderCache(root)).entries.get(key)).toEqual(sections);
    const path = join(root, ".tmp/context-runtime/indexer/candidate-render-cache.json");
    const original = await readFile(path, "utf8");
    await writeFile(path, original.replace("# Public API", "# Broken API"));
    expect((await loadCandidateRenderCache(root)).entries.size).toBe(0);
    const changed = JSON.parse(original); changed.renderer = "different-actual-sdk";
    await writeFile(path, JSON.stringify(changed));
    expect((await loadCandidateRenderCache(root)).entries.size).toBe(0);
    await writeFile(path, "not json");
    expect((await loadCandidateRenderCache(root)).entries.size).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
