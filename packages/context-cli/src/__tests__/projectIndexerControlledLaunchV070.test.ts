import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildIndexerActivationRequest,
  buildIndexerFixedDependencySet,
  buildIndexerParserFactView,
  indexerProviderBundleIntegrity,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterOutputDigest,
  indexerProtocolDigest,
  loadIndexerProviderManifest,
  resolvedProviderReceiptDigest,
  type ExpectedProviderResolution,
  type ResolvedProviderBundle,
} from "@c4a/context";
import {
  buildIndexerControlledLaunch,
  validateIndexerControlledLaunch,
} from "../project/indexerControlledLaunch.js";
import { collectIndexerBundleFiles } from "../project/indexerDistributionBuild.js";
import { stageIndexerProviderBundle } from "../project/indexerProviderStage.js";

const NOW = new Date("2026-08-27T10:00:00.000Z");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const MANIFEST = [
  "protocol: context.indexer.provider/v1",
  "id: example-provider",
  "version: 1.2.3",
  "domains: [code]",
  "activation:",
  "  target_kinds: [package]",
  "  required_signals:",
  "    - { id: source-present, description: Source exists. }",
  "  supporting_signals: []",
  "  negative_signals: []",
  "  detector:",
  "    execution: { runtime: node, entry: scripts/detect.mjs, args: [--json] }",
  "    protocol: context.indexer.activation/v1",
  "    capabilities: [parser-facts.read]",
  "    optional: true",
  "provides:",
  "  profiles: [component-library]",
  "  operations:",
  "    - { id: main-index, consumes: context.indexer.main-workset/v2, produces: context.indexer.main-result/v1 }",
  "provider:",
  "  instructions:",
  "    - { path: references/guidance.md, profiles: [component-library] }",
  "",
].join("\n");

function parserFactView() {
  const sourceRef = "repo:sample";
  const moduleRef = "module:app";
  const scope = {
    source_ref: sourceRef,
    module_refs: [moduleRef],
    scope_digest: indexerProtocolDigest({ source_ref: sourceRef, module_refs: [moduleRef] }),
  };
  const fileRef = indexerEvidenceAdapterFileRef({
    source_ref: sourceRef,
    module_ref: moduleRef,
    normalized_path: "src/index.ts",
  });
  const base = {
    protocol: "context.indexer.evidence-adapter-result/v1" as const,
    adapter: {
      id: "sample-parser",
      package: "@example/sample-parser",
      export: "parse",
      version: "1.2.3",
      digest: digest("4"),
    },
    authorized_scope: scope,
    input_digest: digest("5"),
    precedence: 10,
    files: [{
      file_ref: fileRef,
      source_ref: sourceRef,
      module_ref: moduleRef,
      normalized_path: "src/index.ts",
      role: "primary-owner" as const,
      coverage_tier: "ast-catalog" as const,
      disposition: "analyzed" as const,
      facts: [],
    }],
    diagnostics: [],
    toolchain: [{
      step: "parse-source",
      package: "@example/sample-parser",
      export: "parse",
      version: "1.2.3",
      digest: digest("4"),
      capabilities: ["parser.typescript"],
      input_digest: digest("5"),
      output_digest: digest("6"),
    }],
  };
  const result = { ...base, output_digest: indexerEvidenceAdapterOutputDigest(base) };
  return buildIndexerParserFactView({
    adapter_results: [result],
    fact_payloads: [],
    inventory_digest: digest("7"),
  });
}

async function fixture(root: string): Promise<{
  envelope: ResolvedProviderBundle;
  expected: ExpectedProviderResolution;
}> {
  const transport = join(root, "transport");
  await mkdir(join(transport, "scripts"), { recursive: true });
  await mkdir(join(transport, "references"), { recursive: true });
  await writeFile(join(transport, "context-indexer.yaml"), MANIFEST, "utf8");
  await writeFile(join(transport, "scripts", "detect.mjs"), "process.stdin.resume();\n", "utf8");
  await writeFile(join(transport, "references", "guidance.md"), "# Guidance\n", "utf8");
  const files = await collectIndexerBundleFiles(transport);
  const integrity = indexerProviderBundleIntegrity(files);
  const expected: ExpectedProviderResolution = {
    indexerId: "example-indexer",
    providerId: "example-provider",
    skill: "example-provider",
    version: "1.2.3",
    integrity,
    distribution: {
      kind: "workspace",
      locator: "workspace://skills/example-provider",
    },
  };
  const envelope: ResolvedProviderBundle = {
    protocol: "context.indexer.resolved-provider-bundle/v1",
    request: {
      indexer_id: expected.indexerId,
      provider_id: expected.providerId,
      skill: expected.skill,
      version: expected.version,
      distribution: expected.distribution,
    },
    resolved: {
      integrity,
      manifest_digest: files.find((file) => file.path === "context-indexer.yaml")!.digest,
      issuer: "example-publisher",
      trust: "verified",
    },
    transport: {
      kind: "directory",
      path: transport,
      expires_at: "2026-08-27T10:05:00.000Z",
    },
    files,
    receipt: {
      resolver: "example-host/2.0.0",
      resolved_at: NOW.toISOString(),
      authority_ref: "host-provider:example",
      receipt_digest: digest("0"),
    },
  };
  envelope.receipt.receipt_digest = resolvedProviderReceiptDigest(envelope);
  return { envelope, expected };
}

describe("controlled Indexer staged launch", () => {
  test("launches only the reverified content-addressed entry without shell or inherited env", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-controlled-launch-"));
    const { envelope, expected } = await fixture(root);
    const staged = await stageIndexerProviderBundle({
      envelope,
      expected,
      runtimeRoot: join(root, "runtime"),
      now: NOW,
    });
    const manifest = await loadIndexerProviderManifest(staged.stage_path);
    const request = buildIndexerActivationRequest({
      manifest,
      bundle: envelope,
      dependencies: buildIndexerFixedDependencySet([]),
      scope: { source_ref: "repo:sample", module_refs: ["module:app"] },
      limits: {
        timeout_ms: 10_000,
        max_stdin_bytes: 1024,
        max_stdout_bytes: 4096,
        max_stderr_bytes: 4096,
      },
      project_ref: "project:sample",
      input_view: parserFactView(),
    });
    const launch = await buildIndexerControlledLaunch({
      invocation: request.invocation,
      bundle: envelope,
      staged,
    });

    expect(launch.cwd.endsWith(staged.bundle_integrity.slice("sha256:".length))).toBe(true);
    expect(launch.entry_path.endsWith("/scripts/detect.mjs")).toBe(true);
    expect(launch.entry_path).toContain(staged.bundle_integrity.slice("sha256:".length));
    expect(launch.entry_path).not.toContain(envelope.transport.path);
    expect(launch).toMatchObject({
      resource: "activation-detector",
      runtime: "node",
      args: ["--json"],
      environment: "empty",
      shell: false,
    });
    await expect(validateIndexerControlledLaunch({
      launch,
      invocation: request.invocation,
      staged,
    })).resolves.toBeUndefined();

    const forged = structuredClone(launch);
    forged.entry_path = envelope.transport.path;
    await expect(validateIndexerControlledLaunch({
      launch: forged,
      invocation: request.invocation,
      staged,
    })).rejects.toThrow(/does not match/);
  });

  test("rejects stage tampering before producing a launch", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-controlled-launch-"));
    const { envelope, expected } = await fixture(root);
    const staged = await stageIndexerProviderBundle({
      envelope,
      expected,
      runtimeRoot: join(root, "runtime"),
      now: NOW,
    });
    const manifest = await loadIndexerProviderManifest(staged.stage_path);
    const request = buildIndexerActivationRequest({
      manifest,
      bundle: envelope,
      dependencies: buildIndexerFixedDependencySet([]),
      scope: { source_ref: "repo:sample", module_refs: ["module:app"] },
      limits: {
        timeout_ms: 10_000,
        max_stdin_bytes: 1024,
        max_stdout_bytes: 4096,
        max_stderr_bytes: 4096,
      },
      project_ref: "project:sample",
      input_view: parserFactView(),
    });
    await writeFile(join(staged.stage_path, "scripts", "detect.mjs"), "changed\n", "utf8");
    await expect(buildIndexerControlledLaunch({
      invocation: request.invocation,
      bundle: envelope,
      staged,
    })).rejects.toThrow(/stage changed/);
  });

  test("rejects a directly supplied unregistered Skill root even when its bytes match", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-unregistered-root-"));
    const { envelope, expected } = await fixture(root);
    const staged = await stageIndexerProviderBundle({
      envelope,
      expected,
      runtimeRoot: join(root, "runtime"),
      now: NOW,
    });
    const manifest = await loadIndexerProviderManifest(staged.stage_path);
    const request = buildIndexerActivationRequest({
      manifest,
      bundle: envelope,
      dependencies: buildIndexerFixedDependencySet([]),
      scope: { source_ref: "repo:sample", module_refs: ["module:app"] },
      limits: {
        timeout_ms: 10_000,
        max_stdin_bytes: 1024,
        max_stdout_bytes: 4096,
        max_stderr_bytes: 4096,
      },
      project_ref: "project:sample",
      input_view: parserFactView(),
    });
    const unregistered = {
      ...staged,
      stage_path: envelope.transport.path,
      receipt_digest: digest("f"),
    };
    unregistered.receipt_digest = indexerProtocolDigest({
      protocol: unregistered.protocol,
      provider_fingerprint: unregistered.provider_fingerprint,
      bundle_integrity: unregistered.bundle_integrity,
      manifest_digest: unregistered.manifest_digest,
      files: unregistered.files,
      stage_path: unregistered.stage_path,
      source_receipt_digest: unregistered.source_receipt_digest,
      staged_at: unregistered.staged_at,
      reused: unregistered.reused,
    });
    await expect(buildIndexerControlledLaunch({
      invocation: request.invocation,
      bundle: envelope,
      staged: unregistered,
    })).rejects.toThrow(/registered content-addressed location/);
  });
});
