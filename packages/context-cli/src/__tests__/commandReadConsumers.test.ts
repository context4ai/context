import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCommandReadCache } from "../project/commandReadCache.js";
import { readApprovedKnowledgeMetadataIndex } from "../project/approvedKnowledgeMetadata.js";
import { indexerParserRuntimeManifestPath, readIndexerParserRuntimeIndexManifest } from "../project/indexerParserRuntimeIndex.js";
import { parserChunkFixture } from "./projectIndexerParserChunksV075.fixture.js";

describe("cached read consumers stay current after writes", () => {
  test("knowledge metadata notices new structure and never caches a parse failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-metadata-read-"));
    try {
      await mkdir(join(root, "knowledge"));
      const path = join(root, "knowledge/structure.yaml");
      const structure = (suffix: string) => ({ views: [{ path: `codeindex/${suffix}.md`, view_ref: `view:${suffix}` }] });
      await writeFile(path, JSON.stringify(structure("first")));
      await withCommandReadCache(async () => {
        const first = await readApprovedKnowledgeMetadataIndex(root);
        expect(first.byPath.has("codeindex/first.md")).toBe(true);
        expect(await readApprovedKnowledgeMetadataIndex(root)).toBe(first);
        await writeFile(path, JSON.stringify(structure("next")));
        const next = await readApprovedKnowledgeMetadataIndex(root);
        expect([...next.byPath.keys()]).toEqual(["codeindex/next.md"]);
        await writeFile(path, "views: [");
        expect((await readApprovedKnowledgeMetadataIndex(root)).byPath.size).toBe(0);
        await writeFile(path, JSON.stringify(structure("recovered")));
        expect([...(await readApprovedKnowledgeMetadataIndex(root)).byPath.keys()]).toEqual(["codeindex/recovered.md"]);
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("Parser manifest reuse is invalidated by a new execution or corrupt file", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-parser-manifest-read-"));
    try {
      const input = await parserChunkFixture(root);
      await withCommandReadCache(async () => {
        const first = await readIndexerParserRuntimeIndexManifest(input);
        expect(await readIndexerParserRuntimeIndexManifest(input)).toBe(first);
        const changed = await parserChunkFixture(root, true);
        const next = await readIndexerParserRuntimeIndexManifest(changed);
        expect(next.execution_digest).not.toBe(first.execution_digest);
        expect(next).toEqual(changed.manifest);
        await writeFile(indexerParserRuntimeManifestPath(root, input.indexer_id), "invalid");
        await expect(readIndexerParserRuntimeIndexManifest(input)).rejects.toThrow();
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
