import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { validateIndexerParserFactView } from "@c4a/context";
import {
  indexerParserRuntimeManifestPath,
  readIndexerParserRuntimeSourceSlice,
  readIndexerParserRuntimeSourceMetadata,
  readIndexerParserRuntimeExecution,
} from "../project/indexerParserRuntimeIndex.js";
import { parserRuntimeReadCounters } from "../project/indexerParserRuntimeChunk.js";
import { parserChunkFixture } from "./projectIndexerParserChunksV075.fixture.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "context-file-chunks-"));
  roots.push(root);
  return parserChunkFixture(root);
}
async function metadata(input: Awaited<ReturnType<typeof fixture>>) {
  const root = dirname(indexerParserRuntimeManifestPath(input.projectRoot, input.indexer_id));
  return { root, value: JSON.parse(await readFile(join(root, "chunks", input.manifest.sources[0]!.chunk.file), "utf8")) as {
    files: Array<{ normalized_path: string; chunk: { file: string } }>;
  } };
}

describe("per-file parser runtime chunks", () => {
  test("coalesces concurrent cold reads and counts physical decoding once", async () => {
    const input = await fixture();
    const counters = parserRuntimeReadCounters();
    const slices = await Promise.all(Array.from({ length: 8 }, () =>
      readIndexerParserRuntimeSourceSlice({
        ...input, selection: { paths: ["config/first.json"] }, counters,
      })
    ));
    expect(slices.every((slice) => slice.fact_view.view_digest === slices[0]!.fact_view.view_digest)).toBe(true);
    expect(counters.parser_source_metadata_decode_count).toBe(1);
    expect(counters.parser_fact_chunk_decode_count).toBe(1);
    const { root, value } = await metadata(input);
    const first = value.files.find((file) => file.normalized_path === "config/first.json")!;
    expect(counters.parser_cache_read_bytes).toBe(
      input.manifest.sources[0]!.chunk.byte_length + (await stat(join(root, "chunks", first.chunk.file))).size,
    );
  });

  test("loads the question denominator from metadata without decoding any Fact payload", async () => {
    const input = await fixture();
    const counters = parserRuntimeReadCounters();
    const metadata = await readIndexerParserRuntimeSourceMetadata({ ...input, counters });
    expect(metadata.source_binding.source_identity_inventory).toEqual(input.execution.source_bindings[0]!.source_identity_inventory);
    expect(counters.parser_source_metadata_decode_count).toBe(1);
    expect(counters.parser_fact_chunk_decode_count).toBe(0);
    expect(counters.full_fact_blob_decode_count).toBe(0);
  });
  test("reads only selected files, gives the slice its own valid digest, and reuses decoded data within a command", async () => {
    const input = await fixture();
    const counters = parserRuntimeReadCounters();
    const selection = { paths: ["config/first.json"] };
    const first = await readIndexerParserRuntimeSourceSlice({ ...input, selection, counters });
    expect(first.fact_view.files.map((file) => file.normalized_path)).toEqual(selection.paths);
    expect(first.fact_view.view_digest).not.toBe(input.execution.fact_views[0]!.view_digest);
    expect(validateIndexerParserFactView(first.fact_view)).toEqual(first.fact_view);
    expect(counters.parser_fact_chunk_decode_count).toBe(1);
    expect(counters.full_fact_blob_decode_count).toBe(0);
    const warm = parserRuntimeReadCounters();
    expect(await readIndexerParserRuntimeSourceSlice({ ...input, selection, counters: warm })).toEqual(first);
    expect(warm).toEqual(parserRuntimeReadCounters());
    const member = first.fact_view.files[0]!.facts[0]!;
    expect((await readIndexerParserRuntimeSourceSlice({
      ...input, selection: { member_refs: [member.fact_ref] },
    })).fact_view).toEqual(first.fact_view);
  });

  test("does not read a corrupt unselected file, but rejects it when selected and after a cached file is changed", async () => {
    const input = await fixture();
    const cached = await readIndexerParserRuntimeSourceSlice({ ...input, selection: { paths: ["config/first.json"] } });
    const { root, value } = await metadata(input);
    const first = value.files.find((file) => file.normalized_path === "config/first.json")!;
    const second = value.files.find((file) => file.normalized_path === "config/second.json")!;
    await writeFile(join(root, "chunks", second.chunk.file), "corrupt\n");
    expect((await readIndexerParserRuntimeSourceSlice({ ...input, selection: { paths: ["config/first.json"] } })).fact_view)
      .toEqual(cached.fact_view);
    await expect(readIndexerParserRuntimeSourceSlice({ ...input, selection: { paths: ["config/second.json"] } }))
      .rejects.toThrow("corrupt");
    await writeFile(join(root, "chunks", first.chunk.file), "corrupt\n");
    await expect(readIndexerParserRuntimeSourceSlice({ ...input, selection: { paths: ["config/first.json"] } }))
      .rejects.toThrow("corrupt");
  });

  test("keeps unchanged file chunks and exactly reconstructs the full receipt", async () => {
    const input = await fixture();
    const before = await metadata(input);
    const second = before.value.files.find((file) => file.normalized_path === "config/second.json")!;
    const filePath = join(before.root, "chunks", second.chunk.file);
    const fileBefore = await stat(filePath);
    const changed = await parserChunkFixture(input.projectRoot, true);
    const after = await metadata(changed);
    expect(after.value.files.find((file) => file.normalized_path === "config/second.json")!.chunk.file).toBe(second.chunk.file);
    expect((await stat(filePath)).mtimeMs).toBe(fileBefore.mtimeMs);
    expect(await readIndexerParserRuntimeExecution(changed)).toEqual(changed.execution);
    const beforeFirst = before.value.files.find((file) => file.normalized_path === "config/first.json")!;
    expect(after.value.files.find((file) => file.normalized_path === "config/first.json")!.chunk.file).not.toBe(beforeFirst.chunk.file);
    await expect(stat(join(before.root, "chunks", beforeFirst.chunk.file))).rejects.toThrow();
  });

  test("does not turn an out-of-scope task selection into a full-source read", async () => {
    const input = await fixture();
    const counters = parserRuntimeReadCounters();
    await expect(readIndexerParserRuntimeSourceSlice({
      ...input, selection: { paths: ["../other-repo/secret.ts"] }, counters,
    })).rejects.toThrow("selects no files");
    expect(counters.parser_fact_chunk_decode_count).toBe(0);
    expect(counters.full_fact_blob_decode_count).toBe(0);
  });
});
