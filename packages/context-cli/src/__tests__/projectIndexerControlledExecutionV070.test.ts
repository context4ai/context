import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildIndexerActivationRequest,
  buildIndexerFixedDependencySet,
  buildIndexerParserFactView,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterOutputDigest,
  indexerProtocolDigest,
  indexerProviderBundleIntegrity,
  loadIndexerProviderManifest,
  resolvedProviderReceiptDigest,
  type ExpectedProviderResolution,
  type ResolvedProviderBundle,
} from "@c4a/context";
import { INDEXER_OUTPUT_REDACTION_MARKER } from "@c4a/core";
import { ContextError } from "../lib/errors.js";
import { collectIndexerBundleFiles } from "../project/indexerDistributionBuild.js";
import { executeIndexerControlledRequest } from "../project/indexerControlledExecution.js";
import { stageIndexerProviderBundle } from "../project/indexerProviderStage.js";

const NOW = new Date("2026-08-28T10:00:00.000Z");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SOURCE_REF = "repo:sample";
const MODULE_REF = "module:app";
const FILE_REF = indexerEvidenceAdapterFileRef({
  source_ref: SOURCE_REF,
  module_ref: MODULE_REF,
  normalized_path: "src/index.ts",
});

const MANIFEST = [
  "protocol: context.indexer.provider/v1",
  "id: example-provider",
  "version: 1.2.3",
  "domains: [code]",
  "activation:",
  "  target_kinds: [package]",
  "  required_signals:",
  "    - { id: source-present, description: Source exists. }",
  "  supporting_signals:",
  "    - { id: public-entry, description: Public entry exists. }",
  "  negative_signals:",
  "    - { id: generated-only, description: Only generated sources exist. }",
  "  detector:",
  "    execution: { runtime: node, entry: scripts/detect.mjs, args: [] }",
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

const RUNTIME_PREFIX = [
  'import { createHash } from "node:crypto";',
  "const canonicalize = (value) => Array.isArray(value)",
  "  ? value.map(canonicalize)",
  "  : value !== null && typeof value === 'object'",
  "    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonicalize(item)]))",
  "    : value;",
  "const digest = (value) => `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;",
  "const chunks = [];",
  "for await (const chunk of process.stdin) chunks.push(chunk);",
  "const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
].join("\n");

function validDetectorScript(evidenceRef = FILE_REF): string {
  return `${RUNTIME_PREFIX}\n${[
    "const observations = request.signals.map((signal, index) => ({",
    "  signal_id: signal.id,",
    "  state: index === 0 ? 'present' : 'absent',",
    `  evidence_refs: index === 0 ? [${JSON.stringify(evidenceRef)}] : [],`,
    "}));",
    "const base = { protocol: 'context.indexer.activation-result/v1', request_digest: request.request_digest, observations };",
    "process.stdout.write(JSON.stringify({ ...base, result_digest: digest(base) }));",
  ].join("\n")}\n`;
}

function parserFactView() {
  const scope = {
    source_ref: SOURCE_REF,
    module_refs: [MODULE_REF],
    scope_digest: indexerProtocolDigest({
      source_ref: SOURCE_REF,
      module_refs: [MODULE_REF],
    }),
  };
  const base = {
    protocol: "context.indexer.evidence-adapter-result/v1" as const,
    adapter: {
      id: "sample-parser",
      package: "@example/sample-parser",
      export: "parse",
      version: "1.2.3",
      digest: digest("1"),
    },
    authorized_scope: scope,
    input_digest: digest("2"),
    precedence: 10,
    files: [{
      file_ref: FILE_REF,
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
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
      digest: digest("1"),
      capabilities: ["parser.typescript"],
      input_digest: digest("2"),
      output_digest: digest("3"),
    }],
  };
  return buildIndexerParserFactView({
    adapter_results: [{ ...base, output_digest: indexerEvidenceAdapterOutputDigest(base) }],
    fact_payloads: [],
    inventory_digest: digest("4"),
  });
}

async function controlledFixture(input: {
  root: string;
  script: string;
  limits?: {
    timeout_ms: number;
    max_stdin_bytes: number;
    max_stdout_bytes: number;
    max_stderr_bytes: number;
  };
}) {
  const transport = join(input.root, "transport");
  await mkdir(join(transport, "scripts"), { recursive: true });
  await mkdir(join(transport, "references"), { recursive: true });
  await writeFile(join(transport, "context-indexer.yaml"), MANIFEST, "utf8");
  await writeFile(join(transport, "scripts/detect.mjs"), input.script, "utf8");
  await writeFile(join(transport, "references/guidance.md"), "# Guidance\n", "utf8");
  const files = await collectIndexerBundleFiles(transport);
  const integrity = indexerProviderBundleIntegrity(files);
  const expected: ExpectedProviderResolution = {
    indexerId: "example-indexer",
    providerId: "example-provider",
    skill: "example-provider",
    version: "1.2.3",
    integrity,
    distribution: { kind: "workspace", locator: "workspace://skills/example-provider" },
  };
  const bundle: ResolvedProviderBundle = {
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
      expires_at: "2026-08-28T10:05:00.000Z",
    },
    files,
    receipt: {
      resolver: "example-host/2.0.0",
      resolved_at: NOW.toISOString(),
      authority_ref: "host-provider:example",
      receipt_digest: digest("0"),
    },
  };
  bundle.receipt.receipt_digest = resolvedProviderReceiptDigest(bundle);
  const staged = await stageIndexerProviderBundle({
    envelope: bundle,
    expected,
    runtimeRoot: join(input.root, "runtime"),
    now: NOW,
  });
  const manifest = await loadIndexerProviderManifest(staged.stage_path);
  const request = buildIndexerActivationRequest({
    manifest,
    bundle,
    dependencies: buildIndexerFixedDependencySet([]),
    scope: { source_ref: SOURCE_REF, module_refs: [MODULE_REF] },
    limits: input.limits ?? {
      timeout_ms: 5_000,
      max_stdin_bytes: 1024 * 1024,
      max_stdout_bytes: 64 * 1024,
      max_stderr_bytes: 64 * 1024,
    },
    project_ref: "project:sample",
    input_view: parserFactView(),
  });
  return { bundle, staged, request };
}

function reasonCode(error: unknown): unknown {
  return error instanceof ContextError ? error.detail?.reason_code : undefined;
}

async function expectReason(
  action: Promise<unknown>,
  expected: string,
): Promise<void> {
  try {
    await action;
    throw new Error(`expected ${expected}`);
  } catch (error) {
    expect(reasonCode(error)).toBe(expected);
  }
}

describe("controlled Indexer process execution", () => {
  test("passes canonical JSON through an empty environment and validates the exact Result", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-execution-"));
    const fixture = await controlledFixture({ root, script: validDetectorScript() });
    const executed = await executeIndexerControlledRequest(fixture);
    expect(executed.result).toMatchObject({
      protocol: "context.indexer.activation-result/v1",
      request_digest: fixture.request.request_digest,
    });
    expect(executed.receipt).toMatchObject({
      protocol: "context.indexer.controlled-execution-receipt/v1",
      resource: "activation-detector",
      request_digest: fixture.request.request_digest,
      exit_code: 0,
      stderr_tail: null,
    });
  });

  test("rejects timeout and stdout overflow with typed recovery codes", async () => {
    const timeoutRoot = await mkdtemp(join(tmpdir(), "context-indexer-timeout-"));
    const timeoutFixture = await controlledFixture({
      root: timeoutRoot,
      script: `${RUNTIME_PREFIX}\nawait new Promise(() => {});\n`,
      limits: {
        timeout_ms: 100,
        max_stdin_bytes: 1024 * 1024,
        max_stdout_bytes: 1024,
        max_stderr_bytes: 1024,
      },
    });
    await expectReason(
      executeIndexerControlledRequest(timeoutFixture),
      "indexer-controlled-timeout",
    );

    const outputRoot = await mkdtemp(join(tmpdir(), "context-indexer-output-"));
    const outputFixture = await controlledFixture({
      root: outputRoot,
      script: `${RUNTIME_PREFIX}\nprocess.stdout.write('x'.repeat(4096));\n`,
      limits: {
        timeout_ms: 5_000,
        max_stdin_bytes: 1024 * 1024,
        max_stdout_bytes: 1024,
        max_stderr_bytes: 1024,
      },
    });
    await expectReason(
      executeIndexerControlledRequest(outputFixture),
      "indexer-controlled-stdout-limit-exceeded",
    );
  });

  test("rejects stdin and stderr overflow with typed recovery codes", async () => {
    const stdinRoot = await mkdtemp(join(tmpdir(), "context-indexer-stdin-"));
    const stdinFixture = await controlledFixture({
      root: stdinRoot,
      script: validDetectorScript(),
      limits: {
        timeout_ms: 5_000,
        max_stdin_bytes: 128,
        max_stdout_bytes: 1024,
        max_stderr_bytes: 1024,
      },
    });
    await expectReason(
      executeIndexerControlledRequest(stdinFixture),
      "indexer-controlled-stdin-limit-exceeded",
    );

    const stderrRoot = await mkdtemp(join(tmpdir(), "context-indexer-stderr-limit-"));
    const stderrFixture = await controlledFixture({
      root: stderrRoot,
      script: `${RUNTIME_PREFIX}\nprocess.stderr.write('x'.repeat(4096));\n`,
      limits: {
        timeout_ms: 5_000,
        max_stdin_bytes: 1024 * 1024,
        max_stdout_bytes: 1024,
        max_stderr_bytes: 1024,
      },
    });
    await expectReason(
      executeIndexerControlledRequest(stderrFixture),
      "indexer-controlled-stderr-limit-exceeded",
    );
  });

  test("rejects invalid JSON and scope-expanding evidence", async () => {
    const invalidRoot = await mkdtemp(join(tmpdir(), "context-indexer-invalid-json-"));
    const invalidFixture = await controlledFixture({
      root: invalidRoot,
      script: `${RUNTIME_PREFIX}\nprocess.stdout.write('not-json');\n`,
    });
    await expectReason(
      executeIndexerControlledRequest(invalidFixture),
      "indexer-controlled-output-invalid-json",
    );

    const scopeRoot = await mkdtemp(join(tmpdir(), "context-indexer-scope-"));
    const scopeFixture = await controlledFixture({
      root: scopeRoot,
      script: validDetectorScript("fact:outside-scope"),
    });
    await expectReason(
      executeIndexerControlledRequest(scopeFixture),
      "indexer-controlled-result-invalid",
    );
  });

  test("rejects an explicitly writing program before execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-write-attempt-"));
    const marker = join(root, "written.txt");
    const fixture = await controlledFixture({
      root,
      script: [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(marker)}, "written");`,
        validDetectorScript(),
      ].join("\n"),
    });
    await expect(executeIndexerControlledRequest(fixture)).rejects.toThrow(
      /imports forbidden module node:fs/,
    );
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("redacts split stderr secrets from nonzero process diagnostics", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-stderr-"));
    const fixture = await controlledFixture({
      root,
      script: `${RUNTIME_PREFIX}\nprocess.stderr.write('Authorization: Bear'); process.stderr.write('er hidden-value'); process.exit(7);\n`,
    });
    try {
      await executeIndexerControlledRequest(fixture);
      throw new Error("expected controlled execution to fail");
    } catch (error) {
      expect(reasonCode(error)).toBe("indexer-controlled-nonzero-exit");
      const tail = error instanceof ContextError ? String(error.detail?.stderr_tail) : "";
      expect(tail).toContain(INDEXER_OUTPUT_REDACTION_MARKER);
      expect(tail).not.toContain("hidden-value");
    }
  });
});
