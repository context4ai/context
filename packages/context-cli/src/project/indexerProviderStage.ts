import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { gunzip as gunzipCallback } from "node:zlib";
import { basename, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import {
  indexerProtocolDigest,
  resolvedProviderStableFingerprint,
  validateResolvedProviderBundle,
  type ExpectedProviderResolution,
  type ResolvedProviderBundle,
} from "@c4a/context";
import { collectIndexerBundleFiles } from "./indexerDistributionBuild.js";

const gunzip = promisify(gunzipCallback);
const TAR_BLOCK_SIZE = 512;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 128 * 1024 * 1024;

export interface StagedIndexerProviderBundle {
  protocol: "context.indexer.staged-provider-bundle/v1";
  provider_fingerprint: string;
  bundle_integrity: string;
  manifest_digest: string;
  files: Array<{ path: string; digest: string }>;
  stage_path: string;
  source_receipt_digest: string;
  staged_at: string;
  reused: boolean;
  receipt_digest: string;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameFiles(
  actual: readonly { path: string; digest: string }[],
  expected: readonly { path: string; digest: string }[],
): boolean {
  return actual.length === expected.length && actual.every((file, index) =>
    file.path === expected[index]?.path && file.digest === expected[index]?.digest
  );
}

function readTarText(block: Uint8Array, start: number, length: number): string {
  const bytes = block.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return Buffer.from(end < 0 ? bytes : bytes.subarray(0, end)).toString("utf8");
}

function readTarOctal(block: Uint8Array, start: number, length: number, label: string): number {
  const raw = readTarText(block, start, length).trim();
  if (!/^[0-7]+$/u.test(raw)) {
    throw new TypeError(`Provider archive has an invalid ${label}`);
  }
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Provider archive has an unsafe ${label}`);
  }
  return value;
}

function assertTarChecksum(block: Uint8Array): void {
  const expected = readTarOctal(block, 148, 8, "header checksum");
  let actual = 0;
  for (let index = 0; index < TAR_BLOCK_SIZE; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : (block[index] ?? 0);
  }
  if (actual !== expected) {
    throw new TypeError("Provider archive failed its tar header checksum");
  }
}

function archiveEntryPath(block: Uint8Array): string {
  const name = readTarText(block, 0, 100);
  const prefix = readTarText(block, 345, 155);
  const path = prefix.length > 0 ? `${prefix}/${name}` : name;
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new TypeError("Provider archive contains an unsafe entry path");
  }
  return path;
}

function parseTarBundle(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  let totalBytes = 0;
  let terminated = false;
  while (offset + TAR_BLOCK_SIZE <= bytes.length) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) {
      terminated = true;
      break;
    }
    assertTarChecksum(header);
    const path = archiveEntryPath(header);
    const size = readTarOctal(header, 124, 12, "entry size");
    const type = header[156] ?? 0;
    offset += TAR_BLOCK_SIZE;
    const end = offset + size;
    if (end > bytes.length) {
      throw new TypeError("Provider archive entry is truncated");
    }
    if (type === 0 || type === 48) {
      if (files.has(path)) throw new TypeError(`Provider archive repeats ${path}`);
      totalBytes += size;
      if (totalBytes > MAX_BUNDLE_BYTES) {
        throw new TypeError("Provider archive expands beyond the Bundle byte limit");
      }
      files.set(path, bytes.slice(offset, end));
    } else if (type !== 53) {
      throw new TypeError(`Provider archive entry ${path} is not a regular file or directory`);
    }
    offset += Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  }
  if (!terminated) throw new TypeError("Provider archive has no canonical tar terminator");
  return files;
}

async function readArchiveBundle(path: string): Promise<Map<string, Uint8Array>> {
  const archive = await readFile(path);
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new TypeError("Provider archive exceeds the transport byte limit");
  }
  const isGzip = archive[0] === 0x1f && archive[1] === 0x8b;
  const bytes = isGzip ? await gunzip(archive) : archive;
  if (bytes.byteLength > MAX_BUNDLE_BYTES) {
    throw new TypeError("Provider archive expands beyond the Bundle byte limit");
  }
  return parseTarBundle(bytes);
}

async function fsyncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function materializeDirectoryTransport(input: {
  bundle: ResolvedProviderBundle;
  target: string;
}): Promise<void> {
  const status = await lstat(input.bundle.transport.path);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new TypeError("Provider directory transport must be a real directory");
  }
  const actual = await collectIndexerBundleFiles(input.bundle.transport.path);
  if (!sameFiles(actual, input.bundle.files)) {
    throw new TypeError("Provider directory transport does not match its complete file ledger");
  }
  for (const file of input.bundle.files) {
    const destination = join(input.target, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(input.bundle.transport.path, file.path), destination);
    await fsyncPath(destination);
  }
}

async function materializeArchiveTransport(input: {
  bundle: ResolvedProviderBundle;
  target: string;
}): Promise<void> {
  const status = await lstat(input.bundle.transport.path);
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new TypeError("Provider archive transport must be a real file");
  }
  const entries = await readArchiveBundle(input.bundle.transport.path);
  const actual = [...entries.entries()]
    .map(([path, bytes]) => ({ path, digest: sha256(bytes) }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (!sameFiles(actual, input.bundle.files)) {
    throw new TypeError("Provider archive transport does not match its complete file ledger");
  }
  for (const file of input.bundle.files) {
    const bytes = entries.get(file.path);
    if (bytes === undefined) throw new TypeError(`Provider archive is missing ${file.path}`);
    const destination = join(input.target, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    await fsyncPath(destination);
  }
}

async function validateStagedFiles(
  path: string,
  files: readonly { path: string; digest: string }[],
): Promise<void> {
  const status = await lstat(path);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new TypeError("content-addressed Provider stage is not a real directory");
  }
  const actual = await collectIndexerBundleFiles(path);
  if (!sameFiles(actual, files)) {
    throw new TypeError("content-addressed Provider stage is corrupt");
  }
}

function stageReceiptDigest(
  value: Omit<StagedIndexerProviderBundle, "receipt_digest"> | StagedIndexerProviderBundle,
): string {
  return indexerProtocolDigest({
    protocol: value.protocol,
    provider_fingerprint: value.provider_fingerprint,
    bundle_integrity: value.bundle_integrity,
    manifest_digest: value.manifest_digest,
    files: value.files,
    stage_path: value.stage_path,
    source_receipt_digest: value.source_receipt_digest,
    staged_at: value.staged_at,
    reused: value.reused,
  });
}

export async function recoverIndexerProviderStaging(runtimeRoot: string): Promise<number> {
  if (!isAbsolute(runtimeRoot)) throw new TypeError("Indexer runtime root must be absolute");
  const providersRoot = join(runtimeRoot, "indexer-providers");
  await mkdir(providersRoot, { recursive: true });
  const entries = await readdir(providersRoot, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.name.startsWith(".stage-") || !entry.isDirectory()) continue;
    await rm(join(providersRoot, entry.name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

export async function stageIndexerProviderBundle(input: {
  envelope: unknown;
  expected: ExpectedProviderResolution;
  runtimeRoot: string;
  now?: Date;
}): Promise<StagedIndexerProviderBundle> {
  if (!isAbsolute(input.runtimeRoot)) throw new TypeError("Indexer runtime root must be absolute");
  const now = input.now ?? new Date();
  const bundle = validateResolvedProviderBundle(input.envelope, input.expected, now);
  const providersRoot = join(input.runtimeRoot, "indexer-providers");
  await mkdir(providersRoot, { recursive: true });
  const target = join(providersRoot, bundle.resolved.integrity.slice("sha256:".length));
  let reused = false;
  try {
    await validateStagedFiles(target, bundle.files);
    reused = true;
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) throw error;
    const temporary = await mkdtemp(join(providersRoot, `.stage-${bundle.resolved.integrity.slice(7, 23)}-`));
    try {
      if (bundle.transport.kind === "directory") {
        await materializeDirectoryTransport({ bundle, target: temporary });
      } else {
        await materializeArchiveTransport({ bundle, target: temporary });
      }
      await validateStagedFiles(temporary, bundle.files);
      await fsyncPath(temporary);
      try {
        await rename(temporary, target);
      } catch (renameError) {
        const collision = renameError instanceof Error && "code" in renameError &&
          (renameError.code === "EEXIST" || renameError.code === "ENOTEMPTY");
        if (!collision) throw renameError;
        await validateStagedFiles(target, bundle.files);
        reused = true;
      }
      await fsyncPath(providersRoot);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  const record: Omit<StagedIndexerProviderBundle, "receipt_digest"> = {
    protocol: "context.indexer.staged-provider-bundle/v1",
    provider_fingerprint: resolvedProviderStableFingerprint(bundle),
    bundle_integrity: bundle.resolved.integrity,
    manifest_digest: bundle.resolved.manifest_digest,
    files: bundle.files,
    stage_path: target,
    source_receipt_digest: bundle.receipt.receipt_digest,
    staged_at: now.toISOString(),
    reused,
  };
  return { ...record, receipt_digest: stageReceiptDigest(record) };
}

export function validateStagedIndexerProviderBundle(
  value: StagedIndexerProviderBundle,
  bundle: ResolvedProviderBundle,
): void {
  if (
    !isAbsolute(value.stage_path) ||
    basename(dirname(value.stage_path)) !== "indexer-providers" ||
    basename(value.stage_path) !== bundle.resolved.integrity.slice("sha256:".length)
  ) {
    throw new TypeError("staged Provider path is not the registered content-addressed location");
  }
  if (
    value.provider_fingerprint !== resolvedProviderStableFingerprint(bundle) ||
    value.bundle_integrity !== bundle.resolved.integrity ||
    value.manifest_digest !== bundle.resolved.manifest_digest ||
    !sameFiles(value.files, bundle.files) ||
    value.source_receipt_digest !== bundle.receipt.receipt_digest
  ) {
    throw new TypeError("staged Provider record does not match its resolved Bundle");
  }
  if (value.receipt_digest !== stageReceiptDigest(value)) {
    throw new TypeError("staged Provider receipt digest does not match its runtime delivery");
  }
}
