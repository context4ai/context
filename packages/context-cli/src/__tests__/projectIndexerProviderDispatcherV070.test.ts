import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  hostActionInputDigest,
  type HostActionResult,
  type JsonValue,
} from "@c4a/agent-graph";
import {
  buildIndexerProviderResolutionActionOutput,
  loadIndexerProviderManifest,
  resolvedProviderReceiptDigest,
  type IndexerDistribution,
} from "@c4a/context";
import YAML from "yaml";
import {
  dispatchProjectIndexerProviderResolution,
  stageProjectIndexerProviderResolution,
} from "../project/indexerProviderProjectFlow.js";
import { indexerProviderResolutionHostLocation } from "../project/indexerProviderDispatcher.js";
import { materializeBundledIndexerDistribution } from "../project/indexerDistributionBuild.js";
import { validateProjectIndexerSelectionProposal } from "../project/indexerSelectionProposal.js";
import { loadIndexerCustomization } from "../project/indexerCustomization.js";
import {
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
} from "../project/indexerBaseContracts.js";
import { validateIndexerSelectionFinal } from "../project/indexerSelectionValidation.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const NOW = new Date("2026-08-27T12:00:00.000Z");
const INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS = 120_000;

function requirement() {
  return {
    id: "service-understanding",
    reader_goals: ["understand"],
    coverage_domains: { "public-contract": "required" as const },
    target_scope: {
      targets: [{ source_ref: "repo:20260827/service", module_refs: [] }],
    },
    evidence_source_scope: {
      targets: [{ source_ref: "repo:20260827/service", module_refs: [] }],
    },
  };
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "context-indexer-dispatch-v070-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    name: "indexer-dispatch-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`);
  writeFileSync(join(root, "src", "indexers.yaml"), YAML.stringify({
    protocol: "context.indexer.registry/v1",
    requirements: [requirement()],
    indexers: [],
  }));
  return root;
}

function selection(input: {
  skill: string;
  version: string;
  integrity: string;
  distribution: IndexerDistribution;
}) {
  return {
    protocol: "context.indexer.selection-proposal-input/v1",
    project_ref: "project:indexer-dispatch-fixture",
    registry: {
      protocol: "context.indexer.registry/v1",
      requirements: [requirement()],
      indexers: [{
        id: "service-indexer",
        operations: ["main-index"],
        requirement_bindings: [{
          requirement_ref: "service-understanding",
          coverage_domains: ["public-contract"],
          owned_scope: { ref: "requirement:service-understanding#target_scope" },
          role: "primary",
        }],
        read_scope: { refs: ["requirement:service-understanding#target_scope"] },
        profile: {
          primary: { id: "component-library", provider: "community" },
        },
        providers: [{
          id: "community",
          role: "primary",
          skill: input.skill,
          version: input.version,
          integrity: input.integrity,
          distribution: input.distribution,
        }],
      }],
    },
  };
}

async function fixture() {
  const buildRoot = await mkdtemp(join(tmpdir(), "context-indexer-dispatch-assets-"));
  const assetsRoot = join(buildRoot, "indexers");
  const manifest = await materializeBundledIndexerDistribution({
    packageRoot: PACKAGE_ROOT,
    outputRoot: assetsRoot,
  });
  const provider = manifest.bundles.find((entry) =>
    entry.skill === "context-code-indexer"
  )!;
  return { assetsRoot, provider };
}

describe("0.7.0 two-stage Provider dispatcher", () => {
  test("exposes static, resolve, and stage as one guarded CLI chain", async () => {
    const root = project();
    const catalog = JSON.parse(await runCliInDir(root, [
      "indexer", "catalog", "--format", "json",
    ]));
    const provider = catalog.bundles.find((entry: { skill: string }) =>
      entry.skill === "context-code-indexer"
    );
    const proposal = selection(provider);
    const selectionPath = join(root, "selection.json");
    writeFileSync(selectionPath, `${JSON.stringify(proposal, null, 2)}\n`);
    const validation = JSON.parse(await runCliInDir(root, [
      "indexer", "validate-indexer-selection-proposal",
      "--input", selectionPath, "--format", "json",
    ]));
    const requestPath = join(root, "resolution-request.json");
    writeFileSync(
      requestPath,
      `${JSON.stringify(validation.resolution_requests[0], null, 2)}\n`,
    );
    const resolution = JSON.parse(await runCliInDir(root, [
      "indexer", "resolve-indexer-providers",
      "--selection", selectionPath,
      "--input", requestPath,
      "--format", "json",
    ]));
    expect(resolution).toMatchObject({ state: "resolved", resolver: "cli-bundled" });
    const resolutionPath = join(root, "resolution.json");
    writeFileSync(resolutionPath, `${JSON.stringify(resolution, null, 2)}\n`);
    const stage = JSON.parse(await runCliInDir(root, [
      "indexer", "stage-indexer-provider-bundle",
      "--selection", selectionPath,
      "--request", requestPath,
      "--input", resolutionPath,
      "--format", "json",
    ]));
    expect(stage.protocol).toBe("context.indexer.provider-stage-action-receipt/v1");
    expect(stage.staged.bundle_integrity).toBe(provider.integrity);
  });

  test("resolves cli-bundled only after static validation and stages by content digest", async () => {
    const root = project();
    const release = await fixture();
    const proposal = selection(release.provider);
    const validation = await validateProjectIndexerSelectionProposal({
      projectRoot: root,
      value: proposal,
    });
    const request = validation.resolution_requests[0]!;

    const resolved = await dispatchProjectIndexerProviderResolution({
      projectRoot: root,
      selection: proposal,
      request,
      assetsRoot: release.assetsRoot,
      now: NOW,
    });
    expect(resolved.state).toBe("resolved");
    if (resolved.state !== "resolved") throw new Error("expected resolved Provider");
    expect(resolved.resolver).toBe("cli-bundled");
    expect(resolved.output.request_digest).toBe(request.request_digest);

    const stage = await stageProjectIndexerProviderResolution({
      projectRoot: root,
      selection: proposal,
      request,
      resolution: resolved,
      now: NOW,
    });
    expect(stage.staged.stage_path).toContain(
      join(".tmp", "context-runtime", "indexer-providers"),
    );
    expect(readFileSync(join(stage.staged.stage_path, "context-indexer.yaml"), "utf8"))
      .toContain("protocol: context.indexer.provider/v1");
    expect(readFileSync(join(root, "src", "indexers.yaml"), "utf8"))
      .toContain("indexers: []");

    const providerManifest = await loadIndexerProviderManifest(stage.staged.stage_path);
    const customization = await loadIndexerCustomization({
      workspaceRoot: root,
      projectRef: validation.proposal.project_ref,
      indexer: validation.proposal.registry.indexers[0]!,
      manifest: providerManifest,
      providerIntegrity: release.provider.integrity,
    });
    const operators = bundledIndexerOperatorContract();
    const profiles = bundledIndexerProfileContract(operators);
    const finalReport = await validateIndexerSelectionFinal({
      registry: validation.proposal.registry,
      static_report: validation.static_report,
      resolved: [{
        indexer_id: request.provider.indexer_id,
        provider_id: request.provider.provider_id,
        bundle: resolved.output.envelope,
        staged: stage.staged,
        execution_policy_digest: null,
      }],
      customizations: [customization],
      operator_contract: operators,
      profile_contract: profiles,
    });
    expect(finalReport.static_report_digest).toBe(validation.static_report.report_digest);
    expect(finalReport.providers[0]).toMatchObject({
      indexer_id: "service-indexer",
      provider_id: "community",
      bundle_integrity: release.provider.integrity,
    });
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("returns a Host-action Resource for non-CLI distributions and consumes its inline result", async () => {
    const root = project();
    const release = await fixture();
    const localSelection = selection(release.provider);
    const localValidation = await validateProjectIndexerSelectionProposal({
      projectRoot: root,
      value: localSelection,
    });
    const localResolved = await dispatchProjectIndexerProviderResolution({
      projectRoot: root,
      selection: localSelection,
      request: localValidation.resolution_requests[0]!,
      assetsRoot: release.assetsRoot,
      now: NOW,
    });
    if (localResolved.state !== "resolved") throw new Error("expected local resolution");

    const workspaceDistribution: IndexerDistribution = {
      kind: "workspace",
      locator: "workspace://plugins/context/skills/context-code-indexer",
    };
    const hostSelection = selection({
      ...release.provider,
      distribution: workspaceDistribution,
    });
    const hostValidation = await validateProjectIndexerSelectionProposal({
      projectRoot: root,
      value: hostSelection,
    });
    const hostRequest = hostValidation.resolution_requests[0]!;
    const pending = await dispatchProjectIndexerProviderResolution({
      projectRoot: root,
      selection: hostSelection,
      request: hostRequest,
      now: NOW,
    });
    expect(pending.state).toBe("host-action-required");
    if (pending.state !== "host-action-required") throw new Error("expected Host Action");
    expect(pending.location).toMatchObject({
      schema: "agent-graph.resource-location.host-action.v1",
      materialize: {
        handler: "context.resolve-indexer-provider/v1",
        input: { schema: "context.indexer.resolve-provider-input/v1" },
        output_schema: "context.indexer.resolve-provider-output/v1",
      },
    });

    const envelope = structuredClone(localResolved.output.envelope);
    envelope.request.distribution = workspaceDistribution;
    envelope.resolved.trust = "verified";
    envelope.receipt.resolver = "codex/1.0.0";
    envelope.receipt.authority_ref = "host-visible-skill:context-code-indexer@0.6.19";
    envelope.receipt.receipt_digest = resolvedProviderReceiptDigest(envelope);
    const contextOutput = buildIndexerProviderResolutionActionOutput({
      request: hostRequest,
      envelope,
      now: NOW,
    });
    const location = indexerProviderResolutionHostLocation(hostRequest);
    const hostResult: HostActionResult = {
      schema: "agent-graph.host-action-result.v1",
      handler: location.materialize.handler,
      input_digest: hostActionInputDigest(location),
      output: {
        schema: location.materialize.output_schema,
        inline: contextOutput as unknown as JsonValue,
      },
      receipt: { adapter: "codex", adapter_version: "1.0.0" },
    };
    const consumed = await dispatchProjectIndexerProviderResolution({
      projectRoot: root,
      selection: hostSelection,
      request: hostRequest,
      host_result: hostResult,
      now: NOW,
    });
    expect(consumed).toMatchObject({
      state: "resolved",
      resolver: "host",
      host_receipt: { adapter: "codex", adapter_version: "1.0.0" },
    });

    const leakingResult = structuredClone(hostResult) as HostActionResult;
    if (!("inline" in leakingResult.output)) throw new Error("expected inline Host output");
    leakingResult.output.inline = {
      ...(leakingResult.output.inline as Record<string, JsonValue>),
      token: "fixture-secret-do-not-emit",
    } as JsonValue;
    await expect(dispatchProjectIndexerProviderResolution({
      projectRoot: root,
      selection: hostSelection,
      request: hostRequest,
      host_result: leakingResult,
      now: NOW,
    })).rejects.toThrow("blocked by the common output redaction boundary");

    const resourceDigest = `sha256:${"e".repeat(64)}`;
    const resourceResult: HostActionResult = {
      ...hostResult,
      output: {
        schema: location.materialize.output_schema,
        resource: {
          ref: "host-resource://context/indexer/provider-result",
          digest: resourceDigest,
        },
      },
    };
    await expect(dispatchProjectIndexerProviderResolution({
      projectRoot: root,
      selection: hostSelection,
      request: hostRequest,
      host_result: resourceResult,
      now: NOW,
    })).rejects.toThrow(/managed resource output/);
    const consumedResource = await dispatchProjectIndexerProviderResolution({
      projectRoot: root,
      selection: hostSelection,
      request: hostRequest,
      host_result: resourceResult,
      managed_output: {
        ref: "host-resource://context/indexer/provider-result",
        digest: resourceDigest,
        value: contextOutput,
      },
      now: NOW,
    });
    expect(consumedResource).toMatchObject({ state: "resolved", resolver: "host" });
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("does not materialize a request absent from the current static report", async () => {
    const root = project();
    const release = await fixture();
    const proposal = selection(release.provider);
    const validation = await validateProjectIndexerSelectionProposal({
      projectRoot: root,
      value: proposal,
    });
    const forged = structuredClone(validation.resolution_requests[0]!);
    forged.provider.version = "9.9.9";
    const runtimeRoot = join(root, ".tmp");
    await expect(dispatchProjectIndexerProviderResolution({
      projectRoot: root,
      selection: proposal,
      request: forged,
      assetsRoot: release.assetsRoot,
      now: NOW,
    })).rejects.toThrow(/stale or invalid|not authorized/);
    expect(existsSync(runtimeRoot)).toBe(false);
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);
});
