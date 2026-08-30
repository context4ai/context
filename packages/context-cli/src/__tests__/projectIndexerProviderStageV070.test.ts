import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import {
  indexerProviderBundleIntegrity,
  resolvedProviderReceiptDigest,
  type ExpectedProviderResolution,
  type ResolvedProviderBundle,
} from "@c4a/context";
import {
  recoverIndexerProviderStaging,
  stageIndexerProviderBundle,
  validateStagedIndexerProviderBundle,
} from "../project/indexerProviderStage.js";

const NOW = new Date("2026-08-27T10:00:00.000Z");
const MANIFEST = Buffer.from("protocol: context.indexer.provider/v1\nid: example-provider\n", "utf8");
const GUIDE = Buffer.from("# Provider guidance\n", "utf8");

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const FILES = [
  { path: "context-indexer.yaml", digest: digest(MANIFEST) },
  { path: "references/guide.md", digest: digest(GUIDE) },
];
const INTEGRITY = indexerProviderBundleIntegrity(FILES);

function expected(): ExpectedProviderResolution {
  return {
    indexerId: "example-indexer",
    providerId: "example-provider",
    skill: "example-provider",
    version: "1.2.3",
    integrity: INTEGRITY,
    distribution: {
      kind: "workspace",
      locator: "workspace://skills/example-provider",
    },
  };
}

function envelope(path: string, kind: "directory" | "archive" = "directory"): ResolvedProviderBundle {
  const value: ResolvedProviderBundle = {
    protocol: "context.indexer.resolved-provider-bundle/v1",
    request: {
      indexer_id: "example-indexer",
      provider_id: "example-provider",
      skill: "example-provider",
      version: "1.2.3",
      distribution: expected().distribution,
    },
    resolved: {
      integrity: INTEGRITY,
      manifest_digest: FILES[0]!.digest,
      issuer: "example-publisher",
      trust: "verified",
    },
    transport: {
      kind,
      path,
      expires_at: "2026-08-27T10:05:00.000Z",
    },
    files: FILES,
    receipt: {
      resolver: "example-host/2.0.0",
      resolved_at: NOW.toISOString(),
      authority_ref: "host-provider:example",
      receipt_digest: INTEGRITY,
    },
  };
  value.receipt.receipt_digest = resolvedProviderReceiptDigest(value);
  return value;
}

async function writeDirectoryBundle(root: string): Promise<void> {
  await mkdir(join(root, "references"), { recursive: true });
  await writeFile(join(root, "context-indexer.yaml"), MANIFEST);
  await writeFile(join(root, "references", "guide.md"), GUIDE);
}

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, "0");
  header.write(text, offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function tarEntry(path: string, bytes: Uint8Array, type = "0"): Buffer {
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, "utf8");
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, bytes.byteLength);
  writeOctal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  const checksum = sum.toString(8).padStart(6, "0");
  header.write(checksum, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 32;
  const body = Buffer.from(bytes);
  const padding = Buffer.alloc((512 - (body.byteLength % 512)) % 512);
  return Buffer.concat([header, body, padding]);
}

function bundleTar(entries: Array<{ path: string; bytes: Uint8Array; type?: string }> = [
  { path: "context-indexer.yaml", bytes: MANIFEST },
  { path: "references/guide.md", bytes: GUIDE },
]): Buffer {
  return Buffer.concat([
    ...entries.map((entry) => tarEntry(entry.path, entry.bytes, entry.type)),
    Buffer.alloc(1024),
  ]);
}

describe("Indexer Provider content-addressed stage", () => {
  test("verifies a directory transport, publishes atomically, and reuses the stable content", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-stage-"));
    const sourceA = join(root, "transport-a");
    const sourceB = join(root, "transport-b");
    await writeDirectoryBundle(sourceA);
    await writeDirectoryBundle(sourceB);

    const firstEnvelope = envelope(sourceA);
    const first = await stageIndexerProviderBundle({
      envelope: firstEnvelope,
      expected: expected(),
      runtimeRoot: join(root, "runtime"),
      now: NOW,
    });
    const secondEnvelope = envelope(sourceB);
    const second = await stageIndexerProviderBundle({
      envelope: secondEnvelope,
      expected: expected(),
      runtimeRoot: join(root, "runtime"),
      now: new Date(NOW.getTime() + 1_000),
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.stage_path).toBe(first.stage_path);
    expect(second.provider_fingerprint).toBe(first.provider_fingerprint);
    expect(JSON.stringify(second)).not.toContain(sourceA);
    expect(JSON.stringify(second)).not.toContain(sourceB);
    expect(await readFile(join(first.stage_path, "references", "guide.md"), "utf8"))
      .toBe(GUIDE.toString("utf8"));
    validateStagedIndexerProviderBundle(first, firstEnvelope);
    validateStagedIndexerProviderBundle(second, secondEnvelope);
  });

  test("stages canonical tar and tar-gzip transports with the same fingerprint", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-archive-stage-"));
    const plainPath = join(root, "provider.tar");
    const gzipPath = join(root, "provider.tgz");
    const tar = bundleTar();
    await writeFile(plainPath, tar);
    await writeFile(gzipPath, gzipSync(tar));

    const plain = await stageIndexerProviderBundle({
      envelope: envelope(plainPath, "archive"),
      expected: expected(),
      runtimeRoot: join(root, "runtime-a"),
      now: NOW,
    });
    const gzip = await stageIndexerProviderBundle({
      envelope: envelope(gzipPath, "archive"),
      expected: expected(),
      runtimeRoot: join(root, "runtime-b"),
      now: NOW,
    });

    expect(gzip.provider_fingerprint).toBe(plain.provider_fingerprint);
    expect(gzip.bundle_integrity).toBe(plain.bundle_integrity);
  });

  test("fails closed on transport tampering, extra files, unsafe archive entries, and stage corruption", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-invalid-stage-"));
    const source = join(root, "transport");
    await writeDirectoryBundle(source);
    const validEnvelope = envelope(source);
    const staged = await stageIndexerProviderBundle({
      envelope: validEnvelope,
      expected: expected(),
      runtimeRoot: join(root, "runtime"),
      now: NOW,
    });
    await writeFile(join(staged.stage_path, "unexpected.txt"), "corrupt\n", "utf8");
    await expect(stageIndexerProviderBundle({
      envelope: validEnvelope,
      expected: expected(),
      runtimeRoot: join(root, "runtime"),
      now: NOW,
    })).rejects.toThrow("stage is corrupt");

    const tampered = join(root, "tampered");
    await writeDirectoryBundle(tampered);
    await writeFile(join(tampered, "references", "guide.md"), "changed\n", "utf8");
    await expect(stageIndexerProviderBundle({
      envelope: envelope(tampered),
      expected: expected(),
      runtimeRoot: join(root, "runtime-tampered"),
      now: NOW,
    })).rejects.toThrow("complete file ledger");

    const unsafeArchive = join(root, "unsafe.tar");
    await writeFile(unsafeArchive, bundleTar([
      { path: "../escape", bytes: GUIDE },
    ]));
    await expect(stageIndexerProviderBundle({
      envelope: envelope(unsafeArchive, "archive"),
      expected: expected(),
      runtimeRoot: join(root, "runtime-unsafe"),
      now: NOW,
    })).rejects.toThrow("unsafe entry path");

    const symlinkArchive = join(root, "symlink.tar");
    await writeFile(symlinkArchive, bundleTar([
      { path: "context-indexer.yaml", bytes: new Uint8Array(), type: "2" },
    ]));
    await expect(stageIndexerProviderBundle({
      envelope: envelope(symlinkArchive, "archive"),
      expected: expected(),
      runtimeRoot: join(root, "runtime-symlink"),
      now: NOW,
    })).rejects.toThrow("not a regular file or directory");
  });

  test("cleans only interrupted stage directories and rejects expired delivery", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-stage-recovery-"));
    const providers = join(root, "runtime", "indexer-providers");
    await mkdir(join(providers, ".stage-deadbeef-orphan"), { recursive: true });
    await mkdir(join(providers, "keep-me"), { recursive: true });
    expect(await recoverIndexerProviderStaging(join(root, "runtime"))).toBe(1);
    expect(await readdir(providers)).toEqual(["keep-me"]);

    const source = join(root, "transport");
    await writeDirectoryBundle(source);
    await expect(stageIndexerProviderBundle({
      envelope: envelope(source),
      expected: expected(),
      runtimeRoot: join(root, "runtime"),
      now: new Date("2026-08-27T10:06:00.000Z"),
    })).rejects.toThrow("expired");
  });
});
