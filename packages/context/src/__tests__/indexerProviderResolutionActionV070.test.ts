import { describe, expect, test } from "bun:test";
import {
  buildIndexerProviderResolutionActionInput,
  buildIndexerProviderResolutionActionOutput,
  indexerProviderBundleIntegrity,
  resolvedProviderBundleSchema,
  resolvedProviderReceiptDigest,
  validateIndexerProviderResolutionActionInput,
  validateIndexerProviderResolutionActionOutput,
  type ResolvedProviderBundle,
} from "../index.js";

const MANIFEST_DIGEST = `sha256:${"a".repeat(64)}`;
const GUIDE_DIGEST = `sha256:${"b".repeat(64)}`;
const FILES = [
  { path: "context-indexer.yaml", digest: MANIFEST_DIGEST },
  { path: "references/indexer.md", digest: GUIDE_DIGEST },
];
const INTEGRITY = indexerProviderBundleIntegrity(FILES);

function request() {
  return buildIndexerProviderResolutionActionInput({
    protocol: "context.indexer.resolve-provider-input/v1",
    project_ref: "project:sample",
    selection_proposal_digest: `sha256:${"c".repeat(64)}`,
    static_report_digest: `sha256:${"d".repeat(64)}`,
    provider: {
      indexer_id: "service-indexer",
      provider_id: "community",
      skill: "context-code-indexer",
      version: "0.7.0",
      integrity: INTEGRITY,
      distribution: {
        kind: "workspace" as const,
        locator: "workspace://plugins/context/skills/context-code-indexer",
      },
    },
  });
}

function envelope(): ResolvedProviderBundle {
  const action = request();
  const value: ResolvedProviderBundle = {
    protocol: "context.indexer.resolved-provider-bundle/v1",
    request: {
      indexer_id: action.provider.indexer_id,
      provider_id: action.provider.provider_id,
      skill: action.provider.skill,
      version: action.provider.version,
      distribution: action.provider.distribution,
    },
    resolved: {
      integrity: action.provider.integrity,
      manifest_digest: MANIFEST_DIGEST,
      issuer: "context4ai/context",
      trust: "verified",
    },
    transport: {
      kind: "directory",
      path: "/tmp/context-indexer-provider",
      expires_at: "2026-08-27T13:00:00.000Z",
    },
    files: FILES,
    receipt: {
      resolver: "codex/1.0.0",
      resolved_at: "2026-08-27T12:00:00.000Z",
      authority_ref: "host-visible-skill:context-code-indexer@0.7.0",
      receipt_digest: MANIFEST_DIGEST,
    },
  };
  value.receipt.receipt_digest = resolvedProviderReceiptDigest(value);
  return resolvedProviderBundleSchema.parse(value);
}

describe("0.7.0 Context-owned Provider resolution Action", () => {
  test("binds exact selection/static digests and validates a resolved output", () => {
    const input = request();
    const output = buildIndexerProviderResolutionActionOutput({
      request: input,
      envelope: envelope(),
      now: new Date("2026-08-27T12:01:00.000Z"),
    });
    expect(validateIndexerProviderResolutionActionInput(input)).toEqual(input);
    expect(output.request_digest).toBe(input.request_digest);
    expect(validateIndexerProviderResolutionActionOutput({
      request: input,
      output,
      now: new Date("2026-08-27T12:01:00.000Z"),
    })).toEqual(output);
  });

  test("rejects stale request identity and output/envelope drift", () => {
    const input = request();
    expect(() => validateIndexerProviderResolutionActionInput({
      ...input,
      selection_proposal_digest: `sha256:${"e".repeat(64)}`,
    })).toThrow(/stale or invalid/);

    const output = buildIndexerProviderResolutionActionOutput({
      request: input,
      envelope: envelope(),
      now: new Date("2026-08-27T12:01:00.000Z"),
    });
    expect(() => validateIndexerProviderResolutionActionOutput({
      request: input,
      output: { ...output, request_digest: `sha256:${"f".repeat(64)}` },
      now: new Date("2026-08-27T12:01:00.000Z"),
    })).toThrow(/stale or invalid/);
  });
});
