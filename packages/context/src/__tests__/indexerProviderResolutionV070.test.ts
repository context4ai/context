import { describe, expect, test } from "bun:test";
import {
  deriveIndexerProgramExecutionPolicy,
  authorizeIndexerProgramExecution,
  buildIndexerProgramExecutionAuthorizationReport,
  buildProjectLocalIndexerProgramExecutionAuthorizationReport,
  indexerCliReleaseManifestSchema,
  indexerDistributionSchema,
  indexerHostExecutionCapabilitiesSchema,
  indexerProviderBundleIntegrity,
  parseIndexerProviderManifest,
  resolvedProviderBundleSchema,
  resolvedProviderReceiptDigest,
  resolvedProviderStableFingerprint,
  validateResolvedProviderBundle,
  type ExpectedProviderResolution,
  type ResolvedProviderBundle,
} from "../index.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const FILES = [
  { path: "context-indexer.yaml", digest: DIGEST_A },
  { path: "scripts/index.mjs", digest: DIGEST_B },
] as const;
const BUNDLE_INTEGRITY = indexerProviderBundleIntegrity(FILES);

const EXPECTED: ExpectedProviderResolution = {
  indexerId: "application-indexer",
  providerId: "community",
  skill: "context-indexer-sample",
  version: "1.2.0",
  integrity: BUNDLE_INTEGRITY,
  distribution: {
    kind: "cli-bundled",
    locator: "cli-bundled://context/context-indexer-sample",
  },
};

const HOST_EXPECTED: ExpectedProviderResolution = {
  ...EXPECTED,
  distribution: {
    kind: "bundled",
    locator: "plugin://community-indexers/context-indexer-sample",
  },
};

function bundle(overrides: {
  trust?: ResolvedProviderBundle["resolved"]["trust"];
  transportPath?: string;
  expiresAt?: string;
  resolvedAt?: string;
  integrity?: string;
} = {}): ResolvedProviderBundle {
  const value: ResolvedProviderBundle = {
    protocol: "context.indexer.resolved-provider-bundle/v1",
    request: {
      indexer_id: EXPECTED.indexerId,
      provider_id: EXPECTED.providerId,
      skill: EXPECTED.skill,
      version: EXPECTED.version,
      distribution: EXPECTED.distribution,
    },
    resolved: {
      integrity: overrides.integrity ?? EXPECTED.integrity,
      manifest_digest: DIGEST_A,
      issuer: "context4ai/context",
      trust: overrides.trust ?? "first-party",
    },
    transport: {
      kind: "directory",
      path: overrides.transportPath ?? "/tmp/provider-bundle-a",
      expires_at: overrides.expiresAt ?? "2026-08-28T12:00:00.000Z",
    },
    files: [...FILES],
    receipt: {
      resolver: "context-cli/0.7.0",
      resolved_at: overrides.resolvedAt ?? "2026-08-27T11:55:00.000Z",
      authority_ref: "cli-release-manifest:indexer-bundles",
      receipt_digest: DIGEST_A,
    },
  };
  value.receipt.receipt_digest = resolvedProviderReceiptDigest(value);
  return resolvedProviderBundleSchema.parse(value);
}

function hostAdapterBundle(
  adapter: "codex" | "claude" | "cursor",
  transportSuffix: string,
): ResolvedProviderBundle {
  const value = bundle({
    transportPath: `/tmp/${adapter}-${transportSuffix}`,
    resolvedAt: `2026-08-27T11:5${transportSuffix}:00.000Z`,
  });
  value.request.distribution = HOST_EXPECTED.distribution;
  value.receipt.resolver = `${adapter}/1.0.0`;
  value.receipt.authority_ref = "plugin-release:context/community-indexers@1.0.0";
  value.receipt.receipt_digest = resolvedProviderReceiptDigest(value);
  return resolvedProviderBundleSchema.parse(value);
}

function providerManifest(withProgram = true) {
  return parseIndexerProviderManifest([
    "protocol: context.indexer.provider/v1",
    "id: context-indexer-sample",
    "version: 1.2.0",
    "domains: [code]",
    "activation:",
    "  target_kinds: [package]",
    "  required_signals:",
    "    - { id: source-present, description: A source is present. }",
    "  supporting_signals: []",
    "  negative_signals: []",
    "provides:",
    "  profiles: [component-library]",
    "  operations:",
    "    - { id: main-index, consumes: context.indexer.main-workset/v1, produces: context.indexer.main-result/v1 }",
    "provider:",
    ...(withProgram
      ? [
        "  program:",
        "    execution: { runtime: node, entry: scripts/index.mjs, args: [] }",
        "    protocol: context.indexer.program/v1",
        "    capabilities: [source.read, parser-facts.read, indexer-result.write]",
      ]
      : [
        "  instructions:",
        "    - { path: references/guidance.md, profiles: [component-library] }",
      ]),
    "",
  ].join("\n"));
}

const HOST = {
  protocol: "context.indexer.host-execution-capabilities/v1" as const,
  adapter: "codex",
  adapter_version: "1.0.0",
  sandboxed_program: false as const,
};

describe("ResolvedProviderBundleEnvelope", () => {
  test("validates exact selection identity, integrity, expiry, and receipt", () => {
    const resolved = validateResolvedProviderBundle(
      bundle(),
      EXPECTED,
      new Date("2026-08-27T12:00:00.000Z"),
    );
    expect(resolved.request.distribution).toEqual(EXPECTED.distribution);
    expect(resolved.files[0]?.path).toBe("context-indexer.yaml");
  });

  test("keeps stable freshness independent from transport and delivery timestamps", () => {
    const first = bundle();
    const rematerialized = bundle({
      transportPath: "/tmp/provider-bundle-b",
      expiresAt: "2026-08-29T12:00:00.000Z",
      resolvedAt: "2026-08-28T11:55:00.000Z",
    });

    expect(resolvedProviderStableFingerprint(rematerialized)).toBe(
      resolvedProviderStableFingerprint(first),
    );
    expect(rematerialized.receipt.receipt_digest).not.toBe(first.receipt.receipt_digest);
  });

  test("normalizes Codex, Claude, and Cursor deliveries to one portable Bundle identity", () => {
    const deliveries = (["codex", "claude", "cursor"] as const).map(
      (adapter, index) => validateResolvedProviderBundle(
        hostAdapterBundle(adapter, String(index + 1)),
        HOST_EXPECTED,
        new Date("2026-08-27T12:00:00.000Z"),
      ),
    );
    expect(new Set(deliveries.map((item) => item.resolved.integrity)).size).toBe(1);
    expect(new Set(deliveries.map(resolvedProviderStableFingerprint)).size).toBe(1);
    expect(new Set(deliveries.map((item) => item.receipt.receipt_digest)).size).toBe(3);
    expect(JSON.stringify(HOST_EXPECTED.distribution)).not.toContain("/tmp/");
    expect(() => indexerDistributionSchema.parse({
      kind: "workspace",
      locator: "/tmp/context-indexer-sample",
    })).toThrow();

    const otherSource = hostAdapterBundle("codex", "4");
    otherSource.request.distribution = {
      kind: "marketplace",
      locator: "marketplace://public/community/context-indexer-sample",
    };
    otherSource.receipt.receipt_digest = resolvedProviderReceiptDigest(otherSource);
    expect(() => validateResolvedProviderBundle(
      otherSource,
      HOST_EXPECTED,
      new Date("2026-08-27T12:00:00.000Z"),
    )).toThrow(/distribution/);
  });

  test("rejects selection drift, expired transport, and forged delivery receipts", () => {
    expect(() => validateResolvedProviderBundle(
      bundle({ integrity: DIGEST_B }),
      EXPECTED,
      new Date("2026-08-27T12:00:00.000Z"),
    )).toThrow(/integrity/);

    expect(() => validateResolvedProviderBundle(
      bundle({ expiresAt: "2026-08-27T11:59:59.000Z" }),
      EXPECTED,
      new Date("2026-08-27T12:00:00.000Z"),
    )).toThrow(/expired/);

    const forged = bundle();
    forged.transport.path = "/tmp/forged-path";
    expect(() => validateResolvedProviderBundle(
      forged,
      EXPECTED,
      new Date("2026-08-27T12:00:00.000Z"),
    )).toThrow(/receipt digest/);
  });

  test("requires a sorted file ledger with the exact manifest digest", () => {
    const unsorted = bundle();
    unsorted.files.reverse();
    expect(() => resolvedProviderBundleSchema.parse(unsorted)).toThrow(/sorted/);

    const mismatched = bundle();
    mismatched.resolved.manifest_digest = DIGEST_B;
    expect(() => resolvedProviderBundleSchema.parse(mismatched)).toThrow(/manifest_digest/);
  });

  test("defines a release-owned cli-bundled catalog without Host cache paths", () => {
    const manifest = indexerCliReleaseManifestSchema.parse({
      protocol: "context.indexer.cli-release-manifest/v1",
      package: "@c4a/context-cli",
      version: "0.7.0-preview.1",
      issuer: "context4ai/context",
      bundles: [{
        skill: EXPECTED.skill,
        version: EXPECTED.version,
        distribution: EXPECTED.distribution,
        integrity: EXPECTED.integrity,
        manifest_digest: DIGEST_A,
        files: [...FILES],
      }],
    });
    expect(manifest.bundles[0]?.distribution.kind).toBe("cli-bundled");

    expect(() => indexerCliReleaseManifestSchema.parse({
      ...manifest,
      bundles: [{
        ...manifest.bundles[0],
        distribution: {
          kind: "marketplace",
          locator: "marketplace://context/context-indexer-sample",
        },
      }],
    })).toThrow();
  });
});

describe("Indexer program execution policy", () => {
  test("runs declarative resources without treating them as a program", () => {
    expect(deriveIndexerProgramExecutionPolicy({
      manifest: providerManifest(false),
      bundle: bundle({ trust: "untrusted" }),
      host: HOST,
      projectRef: "project:sample",
    })).toMatchObject({
      level: "declarative",
      executable: true,
      sandboxedProgram: false,
    });
  });

  test("allows first-party and verified programs without claiming sandbox isolation", () => {
    for (const trust of ["first-party", "verified"] as const) {
      expect(deriveIndexerProgramExecutionPolicy({
        manifest: providerManifest(),
        bundle: bundle({ trust }),
        host: HOST,
        projectRef: "project:sample",
      })).toMatchObject({
        level: "trusted-program",
        executable: true,
        sandboxedProgram: false,
      });
    }
  });

  test("requires the Gate for project-local programs even over an allowlisted Provider", () => {
    const manifest = providerManifest();
    const allowlistedBundle = bundle({ trust: "first-party" });
    expect(() => buildIndexerProgramExecutionAuthorizationReport({
      project_ref: "project:sample",
      manifest,
      bundle: allowlistedBundle,
      dependency_set_digest: DIGEST_A,
      scope_digest: DIGEST_B,
      limits: {
        timeout_ms: 10_000,
        max_stdin_bytes: 1024,
        max_stdout_bytes: 4096,
        max_stderr_bytes: 4096,
      },
    })).toThrow(/do not require project authorization/);

    const report = buildProjectLocalIndexerProgramExecutionAuthorizationReport({
      project_ref: "project:sample",
      base_manifest: manifest,
      base_bundle: allowlistedBundle,
      program_path: "src/indexer/application-indexer/index.ts",
      program_content_digest: DIGEST_B,
      execution: {
        runtime: "node",
        entry: "src/indexer/application-indexer/index.ts",
        args: ["--format=json"],
      },
      capabilities: ["source.read", "indexer-result.write"],
      dependency_set_digest: DIGEST_A,
      scope_digest: DIGEST_B,
      limits: {
        timeout_ms: 10_000,
        max_stdin_bytes: 1024,
        max_stdout_bytes: 4096,
        max_stderr_bytes: 4096,
      },
    });
    const authorization = authorizeIndexerProgramExecution({
      report,
      authority_ref: "authority:indexer-program-execution",
      authority_scope_digest: DIGEST_A,
    });
    expect(authorization).toMatchObject({
      program_origin: "project-local",
      program_digest: report.program.program_digest,
      sandboxed_program: false,
    });
    expect(() => authorizeIndexerProgramExecution({
      report: {
        ...report,
        execution: { ...report.execution, entry: "src/indexer/other/index.ts" },
      },
      authority_ref: "authority:indexer-program-execution",
      authority_scope_digest: DIGEST_A,
    })).toThrow(/execution/);
  });

  test("requires an exact project authorization for an otherwise untrusted program", () => {
    const manifest = providerManifest();
    const projectBundle = bundle({ trust: "project-authorized" });
    const report = buildIndexerProgramExecutionAuthorizationReport({
      project_ref: "project:sample",
      manifest,
      bundle: projectBundle,
      dependency_set_digest: DIGEST_A,
      scope_digest: DIGEST_B,
      limits: {
        timeout_ms: 10_000,
        max_stdin_bytes: 1024,
        max_stdout_bytes: 4096,
        max_stderr_bytes: 4096,
      },
    });
    const authorization = authorizeIndexerProgramExecution({
      report,
      authority_ref: "authority:indexer-program-execution",
      authority_scope_digest: DIGEST_B,
    });
    expect(deriveIndexerProgramExecutionPolicy({
      manifest,
      bundle: projectBundle,
      host: HOST,
      authorization,
      projectRef: "project:sample",
    })).toMatchObject({
      level: "trusted-program",
      reason: "project-authorized-exact-digest",
    });

    const otherReport = buildIndexerProgramExecutionAuthorizationReport({
      project_ref: "project:other",
      manifest,
      bundle: projectBundle,
      dependency_set_digest: DIGEST_A,
      scope_digest: DIGEST_B,
      limits: {
        timeout_ms: 10_000,
        max_stdin_bytes: 1024,
        max_stdout_bytes: 4096,
        max_stderr_bytes: 4096,
      },
    });
    expect(deriveIndexerProgramExecutionPolicy({
      manifest,
      bundle: projectBundle,
      host: HOST,
      authorization: authorizeIndexerProgramExecution({
        report: otherReport,
        authority_ref: "authority:indexer-program-execution",
        authority_scope_digest: DIGEST_B,
      }),
      projectRef: "project:sample",
    })).toMatchObject({
      level: "advisory-only",
      executable: false,
    });
  });

  test("does not execute untrusted programs or accept a forged sandbox claim", () => {
    expect(deriveIndexerProgramExecutionPolicy({
      manifest: providerManifest(),
      bundle: bundle({ trust: "untrusted" }),
      host: HOST,
      projectRef: "project:sample",
    })).toMatchObject({
      level: "advisory-only",
      executable: false,
      reason: "untrusted-program-without-sandbox",
    });

    expect(() => indexerHostExecutionCapabilitiesSchema.parse({
      ...HOST,
      sandboxed_program: true,
      sandbox_receipt: DIGEST_A,
    })).toThrow();
  });
});
