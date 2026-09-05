import { createHash } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { indexerProtocolDigest } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { LIFECYCLE_ROOT } from "./lifecyclePaths.js";
import type { InstalledIndexerParserPackage } from "./indexerParserRuntimeImport.js";
import type {
  IndexerParserRuntimeExecutionReceipt,
  IndexerParserRuntimeSourceBinding,
} from "./indexerParserRuntimeExecution.js";
import {
  readIndexerRuntimeChunk,
  writeIndexerRuntimeChunk,
  runtimeChunkFor as chunkFor,
  parserRuntimeReadCounters,
  type IndexerRuntimeChunk as ContentChunk,
  type IndexerRuntimeReadCounters,
} from "./indexerParserRuntimeChunk.js";

const INDEX_ROOT = join(LIFECYCLE_ROOT, "indexer-parser-executions");
const INDEX_FORMAT = 5 as const;

export interface IndexerParserRuntimeSourceIndexEntry {
  source_ref: string;
  module_ref: string | null;
  binding_digest: string;
  fact_view_digest: string;
  chunk: ContentChunk;
}

interface IndexerParserRuntimeIndexPayload {
  cache_format: typeof INDEX_FORMAT;
  indexer_id: string;
  indexer_digest: string;
  source_registry_digest: string;
  profile_contract_digest: string;
  execution_plan_digest: string;
  execution_digest: string;
  parser_packages: InstalledIndexerParserPackage[];
  parser_package_set_digest: string;
  global_chunk: ContentChunk;
  sources: IndexerParserRuntimeSourceIndexEntry[];
}

export interface IndexerParserRuntimeIndexManifest
  extends IndexerParserRuntimeIndexPayload {
  manifest_digest: string;
}

export interface IndexerParserRuntimeSourceSlice {
  source_binding: IndexerParserRuntimeSourceBinding;
  fact_view: IndexerParserRuntimeExecutionReceipt["fact_views"][number];
}

export interface IndexerParserSourceSelection {
  member_refs?: readonly string[];
  paths?: readonly string[];
}

interface SourceMetadata {
  source_binding: IndexerParserRuntimeSourceBinding;
  fact_view: Omit<IndexerParserRuntimeSourceSlice["fact_view"], "files">;
  files: Array<{ file_ref: string; normalized_path: string; chunk: ContentChunk }>;
}

interface IndexerParserRuntimeGlobalSlice {
  protocol: IndexerParserRuntimeExecutionReceipt["protocol"];
  execution_plan_digest: string;
  profile_contract_digest: string;
  dependency_intent_set_digest: string;
  import_receipts: IndexerParserRuntimeExecutionReceipt["import_receipts"];
  adapter_results: IndexerParserRuntimeExecutionReceipt["adapter_results"];
  merge: IndexerParserRuntimeExecutionReceipt["merge"];
  execution_digest: string;
}

function indexIdentity(indexerId: string): string {
  return createHash("sha256").update(indexerId).digest("hex");
}

function runtimeRoot(projectRoot: string, indexerId: string): string {
  return join(projectRoot, INDEX_ROOT, indexIdentity(indexerId));
}

export function indexerParserRuntimeManifestPath(
  projectRoot: string,
  indexerId: string,
): string {
  return join(runtimeRoot(projectRoot, indexerId), "manifest.json");
}

function chunkPath(projectRoot: string, indexerId: string, file: string): string {
  return join(runtimeRoot(projectRoot, indexerId), "chunks", file);
}

function canonicalText(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function sourceKey(value: { source_ref: string; module_ref: string | null }): string {
  return `${value.source_ref}\u0000${value.module_ref ?? ""}`;
}

function parseChunk(value: unknown, label: string): ContentChunk {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.digest !== "string" ||
    typeof candidate.file !== "string" ||
    !/^[a-f0-9]{64}\.json$/u.test(candidate.file) ||
    typeof candidate.byte_length !== "number" ||
    !Number.isSafeInteger(candidate.byte_length) ||
    candidate.byte_length < 0
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return candidate as unknown as ContentChunk;
}

function manifestPayload(
  value: IndexerParserRuntimeIndexManifest,
): IndexerParserRuntimeIndexPayload {
  const { manifest_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

export function validateIndexerParserRuntimeIndexManifest(
  value: unknown,
): IndexerParserRuntimeIndexManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("parser runtime index manifest must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const digestFields = [
    "indexer_digest",
    "source_registry_digest",
    "profile_contract_digest",
    "execution_plan_digest",
    "execution_digest",
    "parser_package_set_digest",
    "manifest_digest",
  ];
  if (
    candidate.cache_format !== INDEX_FORMAT ||
    typeof candidate.indexer_id !== "string" ||
    digestFields.some((field) => typeof candidate[field] !== "string") ||
    !Array.isArray(candidate.parser_packages) ||
    !Array.isArray(candidate.sources)
  ) {
    throw new TypeError("parser runtime index manifest shape is invalid");
  }
  const globalChunk = parseChunk(candidate.global_chunk, "parser runtime global chunk");
  const sources = candidate.sources.map((value, index) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`parser runtime source index ${index} must be an object`);
    }
    const source = value as Record<string, unknown>;
    if (
      typeof source.source_ref !== "string" ||
      (source.module_ref !== null && typeof source.module_ref !== "string") ||
      typeof source.binding_digest !== "string" ||
      typeof source.fact_view_digest !== "string"
    ) {
      throw new TypeError(`parser runtime source index ${index} is invalid`);
    }
    return {
      source_ref: source.source_ref,
      module_ref: source.module_ref as string | null,
      binding_digest: source.binding_digest,
      fact_view_digest: source.fact_view_digest,
      chunk: parseChunk(source.chunk, `parser runtime source chunk ${index}`),
    };
  }).sort((left, right) => sourceKey(left).localeCompare(sourceKey(right)));
  if (
    sources.some((source, index) =>
      sourceKey(source) !== sourceKey((candidate.sources as unknown as typeof sources)[index]!)
    ) ||
    new Set(sources.map(sourceKey)).size !== sources.length
  ) {
    throw new TypeError("parser runtime source index must be canonical and unique");
  }
  const manifest = {
    ...(candidate as unknown as IndexerParserRuntimeIndexManifest),
    global_chunk: globalChunk,
    sources,
  };
  if (indexerProtocolDigest(manifestPayload(manifest)) !== manifest.manifest_digest) {
    throw new TypeError("parser runtime index manifest digest is invalid");
  }
  return manifest;
}

async function readChunk<T>(input: {
  projectRoot: string;
  indexer_id: string;
  chunk: ContentChunk;
  kind?: "metadata" | "facts";
  counters?: IndexerRuntimeReadCounters;
}): Promise<T> {
  return readIndexerRuntimeChunk<T>({
    path: chunkPath(input.projectRoot, input.indexer_id, input.chunk.file),
    chunk: input.chunk,
    kind: input.kind ?? "metadata",
    ...(input.counters === undefined ? {} : { counters: input.counters }),
  });
}

export async function readIndexerParserRuntimeIndexManifest(input: {
  projectRoot: string;
  indexer_id: string;
}): Promise<IndexerParserRuntimeIndexManifest> {
  const text = await readFile(
    indexerParserRuntimeManifestPath(input.projectRoot, input.indexer_id),
    "utf8",
  );
  return validateIndexerParserRuntimeIndexManifest(JSON.parse(text));
}

export async function readIndexerParserRuntimeSourceMetadata(input: {
  projectRoot: string;
  indexer_id: string;
  manifest: IndexerParserRuntimeIndexManifest;
  source_ref: string;
  module_ref: string | null;
  counters?: IndexerRuntimeReadCounters;
}): Promise<SourceMetadata> {
  const matches = input.manifest.sources.filter((source) =>
    source.source_ref === input.source_ref && source.module_ref === input.module_ref
  );
  if (matches.length !== 1) {
    throw new TypeError("parser runtime index requires one exact source slice");
  }
  const metadata = await readChunk<SourceMetadata>({
    ...input,
    chunk: matches[0]!.chunk,
  });
  if (metadata.source_binding.binding_digest !== matches[0]!.binding_digest ||
      metadata.fact_view.view_digest !== matches[0]!.fact_view_digest ||
      metadata.source_binding.source_ref !== input.source_ref ||
      metadata.source_binding.module_ref !== input.module_ref) {
    throw new TypeError("parser source metadata does not match its index");
  }
  if (!Array.isArray(metadata.files) || metadata.files.some((file) =>
    typeof file.file_ref !== "string" || typeof file.normalized_path !== "string"
  ) || new Set(metadata.files.map((file) => file.file_ref)).size !== metadata.files.length) {
    throw new TypeError("parser source file index is invalid");
  }
  for (const file of metadata.files) parseChunk(file.chunk, "parser file chunk");
  return metadata;
}

export async function readIndexerParserRuntimeSourceSlice(input: {
  projectRoot: string;
  indexer_id: string;
  manifest: IndexerParserRuntimeIndexManifest;
  source_ref: string;
  module_ref: string | null;
  selection?: IndexerParserSourceSelection;
  counters?: IndexerRuntimeReadCounters;
}): Promise<IndexerParserRuntimeSourceSlice> {
  const metadata = await readIndexerParserRuntimeSourceMetadata(input);
  let selected = metadata.files;
  if (input.selection !== undefined) {
    const refs = new Set(input.selection.member_refs ?? []);
    const paths = new Set(input.selection.paths ?? []);
    for (const file of metadata.source_binding.source_identity_inventory.files) {
      if (file.facts.some((fact) => refs.has(fact.fact_ref))) paths.add(file.normalized_path);
    }
    selected = selected.filter((file) => refs.has(file.file_ref) || paths.has(file.normalized_path));
    if (selected.length === 0) throw new RangeError("parser task selects no files in its source binding");
  }
  const factCounters = parserRuntimeReadCounters();
  const files: IndexerParserRuntimeSourceSlice["fact_view"]["files"] = [];
  try {
    for (let offset = 0; offset < selected.length; offset += 16) {
      files.push(...await Promise.all(selected.slice(offset, offset + 16).map((file) => readChunk<
        IndexerParserRuntimeSourceSlice["fact_view"]["files"][number]
      >({ ...input, chunk: file.chunk, kind: "facts", counters: factCounters }))));
    }
  } finally {
    if (input.counters !== undefined) {
      input.counters.parser_cache_read_bytes += factCounters.parser_cache_read_bytes;
      input.counters.parser_fact_chunk_decode_count += factCounters.parser_fact_chunk_decode_count;
    }
  }
  if (input.counters !== undefined && selected.length === metadata.files.length &&
      factCounters.parser_fact_chunk_decode_count > 0) {
    input.counters.full_fact_blob_decode_count += 1;
  }
  if (selected.length === metadata.files.length) {
    return { source_binding: metadata.source_binding, fact_view: { ...metadata.fact_view, files } };
  }
  // A slice has its own valid content digest, never the whole source's digest.
  const { view_digest: _digest, ...header } = metadata.fact_view;
  void _digest;
  const view = {
    ...header, files,
    fact_set_digest: indexerProtocolDigest(files.map((file) => ({ file_ref: file.file_ref, facts: file.facts }))),
  };
  return { source_binding: metadata.source_binding, fact_view: { ...view, view_digest: indexerProtocolDigest(view) } };
}

export async function readIndexerParserRuntimeExecution(input: {
  projectRoot: string;
  indexer_id: string;
  manifest: IndexerParserRuntimeIndexManifest;
  counters?: IndexerRuntimeReadCounters;
}): Promise<IndexerParserRuntimeExecutionReceipt> {
  const [global, ...sources] = await Promise.all([
    readChunk<IndexerParserRuntimeGlobalSlice>({
      projectRoot: input.projectRoot,
      indexer_id: input.indexer_id,
      chunk: input.manifest.global_chunk,
      kind: "facts",
      ...(input.counters === undefined ? {} : { counters: input.counters }),
    }),
    ...input.manifest.sources.map((source) =>
      readIndexerParserRuntimeSourceSlice({ ...input, source_ref: source.source_ref, module_ref: source.module_ref })
    ),
  ]);
  return {
    ...global,
    source_bindings: sources.map((source) => source.source_binding),
    fact_views: sources.map((source) => source.fact_view),
  };
}

export async function writeIndexerParserRuntimeIndex(input: {
  projectRoot: string;
  indexer_id: string;
  indexer_digest: string;
  source_registry_digest: string;
  parser_packages: InstalledIndexerParserPackage[];
  parser_package_set_digest: string;
  execution: IndexerParserRuntimeExecutionReceipt;
}): Promise<IndexerParserRuntimeIndexManifest> {
  const factViews = new Map(input.execution.fact_views.map((view) => [
    sourceKey({
      source_ref: view.authorized_scope.source_ref,
      module_ref: view.authorized_scope.module_refs[0] ?? null,
    }),
    view,
  ]));
  const sourceChunks = input.execution.source_bindings.map((binding) => {
    const view = factViews.get(sourceKey(binding));
    if (view === undefined) throw new TypeError("parser runtime source binding has no Fact View");
    const fileChunks = view.files.map((file) => ({ file, ...chunkFor(file) }));
    const { files: _files, ...header } = view;
    void _files;
    const chunk = chunkFor({
      source_binding: binding,
      fact_view: header,
      files: fileChunks.map(({ file, descriptor }) => ({
        file_ref: file.file_ref, normalized_path: file.normalized_path, chunk: descriptor,
      })),
    } satisfies SourceMetadata);
    return {
      entry: {
        source_ref: binding.source_ref,
        module_ref: binding.module_ref,
        binding_digest: binding.binding_digest,
        fact_view_digest: view.view_digest,
        chunk: chunk.descriptor,
      },
      text: chunk.text,
      fileChunks,
    };
  }).sort((left, right) => sourceKey(left.entry).localeCompare(sourceKey(right.entry)));
  const global = chunkFor({
    protocol: input.execution.protocol,
    execution_plan_digest: input.execution.execution_plan_digest,
    profile_contract_digest: input.execution.profile_contract_digest,
    dependency_intent_set_digest: input.execution.dependency_intent_set_digest,
    import_receipts: input.execution.import_receipts,
    adapter_results: input.execution.adapter_results,
    merge: input.execution.merge,
    execution_digest: input.execution.execution_digest,
  } satisfies IndexerParserRuntimeGlobalSlice);
  const chunks = [global, ...sourceChunks.flatMap((chunk) => [
    { descriptor: chunk.entry.chunk, text: chunk.text }, ...chunk.fileChunks,
  ])];
  for (let offset = 0; offset < chunks.length; offset += 16) {
    await Promise.all(chunks.slice(offset, offset + 16).map((chunk) => writeIndexerRuntimeChunk({
      path: chunkPath(input.projectRoot, input.indexer_id, chunk.descriptor.file),
      chunk: chunk.descriptor, text: chunk.text,
    })));
  }
  const payload: IndexerParserRuntimeIndexPayload = {
    cache_format: INDEX_FORMAT,
    indexer_id: input.indexer_id,
    indexer_digest: input.indexer_digest,
    source_registry_digest: input.source_registry_digest,
    profile_contract_digest: input.execution.profile_contract_digest,
    execution_plan_digest: input.execution.execution_plan_digest,
    execution_digest: input.execution.execution_digest,
    parser_packages: [...input.parser_packages],
    parser_package_set_digest: input.parser_package_set_digest,
    global_chunk: global.descriptor,
    sources: sourceChunks.map((chunk) => chunk.entry),
  };
  const manifest = validateIndexerParserRuntimeIndexManifest({
    ...payload,
    manifest_digest: indexerProtocolDigest(payload),
  });
  await atomicWriteFile(
    indexerParserRuntimeManifestPath(input.projectRoot, input.indexer_id),
    canonicalText(manifest),
  );
  const retained = new Set(chunks.map((chunk) => chunk.descriptor.file));
  const chunkRoot = join(runtimeRoot(input.projectRoot, input.indexer_id), "chunks");
  const files = await readdir(chunkRoot).catch(() => [] as string[]);
  await Promise.all(files.filter((file) => !retained.has(file)).map((file) =>
    rm(join(chunkRoot, file), { force: true })
  ));
  return manifest;
}
