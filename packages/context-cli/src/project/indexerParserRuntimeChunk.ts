import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { atomicWriteFile } from "../lib/atomicWrite.js";

export interface IndexerRuntimeChunk { digest: string; file: string; byte_length: number }
export interface IndexerRuntimeReadCounters {
  parser_cache_read_bytes: number;
  parser_source_metadata_decode_count: number;
  parser_fact_chunk_decode_count: number;
  full_fact_blob_decode_count: number;
}
export function parserRuntimeReadCounters(): IndexerRuntimeReadCounters {
  return {
    parser_cache_read_bytes: 0, parser_source_metadata_decode_count: 0,
    parser_fact_chunk_decode_count: 0, full_fact_blob_decode_count: 0,
  };
}
export function runtimeChunkDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
export function runtimeChunkFor(value: unknown) {
  const text = `${JSON.stringify(value)}\n`;
  const bytes = Buffer.from(text);
  const digest = runtimeChunkDigest(bytes);
  return { descriptor: { digest, file: `${digest.slice(7)}.json`, byte_length: bytes.byteLength }, text };
}

// Command-local, bounded decoded cache. Immutable names alone are insufficient:
// check the file identity too, so corruption/replacement invalidates a cached read.
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const decoded = new Map<string, { stamp: string; value: unknown; bytes: number }>();
const reading = new Map<string, { stamp: string; promise: Promise<unknown> }>();
let cacheBytes = 0;
function forget(path: string) {
  const current = decoded.get(path);
  if (current !== undefined) cacheBytes -= current.bytes;
  decoded.delete(path);
}
export async function readIndexerRuntimeChunk<T>(input: {
  path: string;
  chunk: IndexerRuntimeChunk;
  kind: "metadata" | "facts";
  counters?: IndexerRuntimeReadCounters;
}): Promise<T> {
  const info = await stat(input.path);
  const stamp = [input.chunk.digest, info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(":");
  const cached = decoded.get(input.path);
  if (cached?.stamp === stamp) {
    decoded.delete(input.path);
    decoded.set(input.path, cached);
    return cached.value as T;
  }
  const pending = reading.get(input.path);
  if (pending?.stamp === stamp) return pending.promise as Promise<T>;
  forget(input.path);
  const promise = decodeRuntimeChunk<T>(input, stamp);
  reading.set(input.path, { stamp, promise });
  try {
    return await promise;
  } finally {
    if (reading.get(input.path)?.promise === promise) reading.delete(input.path);
  }
}

async function decodeRuntimeChunk<T>(input: {
  path: string;
  chunk: IndexerRuntimeChunk;
  kind: "metadata" | "facts";
  counters?: IndexerRuntimeReadCounters;
}, stamp: string): Promise<T> {
  const bytes = await readFile(input.path);
  if (input.counters !== undefined) input.counters.parser_cache_read_bytes += bytes.byteLength;
  if (bytes.byteLength !== input.chunk.byte_length || runtimeChunkDigest(bytes) !== input.chunk.digest) {
    throw new TypeError(`parser runtime chunk ${input.chunk.file} is corrupt`);
  }
  const value = JSON.parse(bytes.toString("utf8")) as T;
  if (input.counters !== undefined) {
    if (input.kind === "facts") input.counters.parser_fact_chunk_decode_count += 1;
    else input.counters.parser_source_metadata_decode_count += 1;
  }
  if (bytes.byteLength <= MAX_CACHE_BYTES) {
    // A replacement may finish while a prior read is still in flight. Count the
    // stored entry once; future reads still check the file's current identity.
    forget(input.path);
    while (cacheBytes + bytes.byteLength > MAX_CACHE_BYTES && decoded.size > 0) {
      forget(decoded.keys().next().value!);
    }
    decoded.set(input.path, { stamp, value, bytes: bytes.byteLength });
    cacheBytes += bytes.byteLength;
  }
  return value;
}

export async function writeIndexerRuntimeChunk(input: {
  path: string; chunk: IndexerRuntimeChunk; text: string;
}): Promise<void> {
  // Preserve unchanged chunk identity/mtime; rebuild corrupt chunks explicitly.
  const previous = await readFile(input.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (previous?.byteLength === input.chunk.byte_length && runtimeChunkDigest(previous) === input.chunk.digest) return;
  forget(input.path);
  await atomicWriteFile(input.path, input.text);
}
