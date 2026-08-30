import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  hostActionInputDigest,
  type HostActionResult,
  type JsonValue,
} from "@c4a/agent-graph";
import {
  buildIndexerProviderResolutionActionOutput,
  indexerProviderBundleIntegrity,
  loadIndexerProviderManifest,
  resolvedProviderReceiptDigest,
  type IndexerDistribution,
  type ResolvedProviderBundle,
} from "@c4a/context";
import YAML from "yaml";
import {
  dispatchProjectIndexerProviderResolution,
  stageProjectIndexerProviderResolution,
} from "../project/indexerProviderProjectFlow.js";
import { indexerProviderResolutionHostLocation } from
  "../project/indexerProviderDispatcher.js";
import {
  collectIndexerBundleFiles,
  materializeBundledIndexerDistribution,
} from "../project/indexerDistributionBuild.js";
import { validateProjectIndexerSelectionProposal } from
  "../project/indexerSelectionProposal.js";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..");
const NOW = new Date("2026-08-29T12:00:00.000Z");
const INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS = 120_000;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

function requirement() {
  return {
    id: "service-understanding",
    reader_goals: ["understand"],
    coverage_domains: { "public-contract": "required" as const },
    target_scope: {
      targets: [{ source_ref: "repo:20260829/anonymous-service", module_refs: [] }],
    },
    evidence_source_scope: {
      targets: [{ source_ref: "repo:20260829/anonymous-service", module_refs: [] }],
    },
  };
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-install-resolve-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "anonymous-install-resolve-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src", "indexers.yaml"), YAML.stringify({
    protocol: "context.indexer.registry/v1",
    requirements: [requirement()],
    indexers: [],
  }), "utf8");
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
    project_ref: "project:anonymous-install-resolve-fixture",
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

async function directInstalledPlugin(root: string) {
  const pluginRoot = join(root, "installed-plugins", "c4a");
  await cp(join(REPOSITORY_ROOT, "plugins", "context", "repo-install", "codex"), pluginRoot, {
    recursive: true,
  });
  const bundleRoot = join(root, "installed-skills", "context-code-indexer");
  await cp(
    join(REPOSITORY_ROOT, "plugins", "context", "skills", "context-code-indexer"),
    bundleRoot,
    { recursive: true },
  );
  const manifest = await loadIndexerProviderManifest(bundleRoot);
  const files = await collectIndexerBundleFiles(bundleRoot);
  const manifestFile = files.find((file) => file.path === "context-indexer.yaml");
  if (manifestFile === undefined) throw new Error("direct plugin has no Indexer manifest");
  return {
    pluginRoot,
    bundleRoot,
    files,
    manifest,
    manifestDigest: manifestFile.digest,
    integrity: indexerProviderBundleIntegrity(files),
  };
}

describe("Indexer install and resolver modes", () => {
  test("resolves a directly installed plugin through the Host bundled authority", async () => {
    const root = await project();
    const installed = await directInstalledPlugin(root);
    expect(await readFile(join(installed.pluginRoot, ".codex-plugin", "plugin.json"), "utf8"))
      .toContain('"name": "c4a"');
    const distribution: IndexerDistribution = {
      kind: "bundled",
      locator: "plugin://c4a/context-code-indexer",
    };
    const proposal = selection({
      skill: installed.manifest.id,
      version: installed.manifest.version,
      integrity: installed.integrity,
      distribution,
    });
    const validation = await validateProjectIndexerSelectionProposal({
      projectRoot: root,
      value: proposal,
    });
    const request = validation.resolution_requests[0]!;
    const pending = await dispatchProjectIndexerProviderResolution({
      projectRoot: root,
      selection: proposal,
      request,
      now: NOW,
    });
    expect(pending.state).toBe("host-action-required");
    if (pending.state !== "host-action-required") throw new Error("expected Host resolution");

    const envelope: ResolvedProviderBundle = {
      protocol: "context.indexer.resolved-provider-bundle/v1",
      request: {
        indexer_id: request.provider.indexer_id,
        provider_id: request.provider.provider_id,
        skill: installed.manifest.id,
        version: installed.manifest.version,
        distribution,
      },
      resolved: {
        integrity: installed.integrity,
        manifest_digest: installed.manifestDigest,
        issuer: "context4ai/context-plugin",
        trust: "verified",
      },
      transport: {
        kind: "directory",
        path: installed.bundleRoot,
        expires_at: new Date(NOW.getTime() + 300_000).toISOString(),
      },
      files: installed.files,
      receipt: {
        resolver: "codex/host-bundled-v1",
        resolved_at: NOW.toISOString(),
        authority_ref: "plugin-install:c4a/context-code-indexer@1.0.0",
        receipt_digest: installed.integrity,
      },
    };
    envelope.receipt.receipt_digest = resolvedProviderReceiptDigest(envelope);
    const output = buildIndexerProviderResolutionActionOutput({ request, envelope, now: NOW });
    const location = indexerProviderResolutionHostLocation(request);
    const hostResult: HostActionResult = {
      schema: "agent-graph.host-action-result.v1",
      handler: location.materialize.handler,
      input_digest: hostActionInputDigest(location),
      output: {
        schema: location.materialize.output_schema,
        inline: output as unknown as JsonValue,
      },
      receipt: { adapter: "codex", adapter_version: "1.0.0" },
    };
    const resolved = await dispatchProjectIndexerProviderResolution({
      projectRoot: root,
      selection: proposal,
      request,
      host_result: hostResult,
      now: NOW,
    });
    expect(resolved).toMatchObject({ state: "resolved", resolver: "host" });
    const staged = await stageProjectIndexerProviderResolution({
      projectRoot: root,
      selection: proposal,
      request,
      resolution: resolved,
      now: NOW,
    });
    expect(staged.staged.bundle_integrity).toBe(installed.integrity);
    expect(await readFile(join(staged.staged.stage_path, "context-indexer.yaml"), "utf8"))
      .toContain("id: context-code-indexer");
  }, 15_000);

  test("resolves headless cli-bundled only from the exact CLI release manifest", async () => {
    const root = await project();
    for (const hostRoot of [".claude", ".codex", ".agents"]) {
      const decoy = join(root, hostRoot, "skills", "context-code-indexer");
      await mkdir(decoy, { recursive: true });
      await writeFile(join(decoy, "context-indexer.yaml"), [
        "protocol: context.indexer.provider/v1",
        "id: context-code-indexer",
        "version: 9.9.9",
        "marker: decoy-host-skill",
        "",
      ].join("\n"), "utf8");
    }
    const assetsRoot = join(root, "cli-release-indexers");
    const release = await materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      outputRoot: assetsRoot,
    });
    const bundled = release.bundles.find((entry) => entry.skill === "context-code-indexer")!;
    const proposal = selection({
      skill: bundled.skill,
      version: bundled.version,
      integrity: bundled.integrity,
      distribution: bundled.distribution,
    });
    const validation = await validateProjectIndexerSelectionProposal({
      projectRoot: root,
      value: proposal,
    });
    const request = validation.resolution_requests[0]!;
    const resolved = await dispatchProjectIndexerProviderResolution({
      projectRoot: root,
      selection: proposal,
      request,
      assetsRoot,
      now: NOW,
    });
    expect(resolved).toMatchObject({
      state: "resolved",
      resolver: "cli-bundled",
      output: {
        envelope: {
          resolved: { integrity: bundled.integrity, trust: "first-party" },
          receipt: { authority_ref: `cli-release-manifest:indexer-bundles@${release.version}` },
        },
      },
    });
    const staged = await stageProjectIndexerProviderResolution({
      projectRoot: root,
      selection: proposal,
      request,
      resolution: resolved,
      now: NOW,
    });
    const stagedManifest = await readFile(
      join(staged.staged.stage_path, "context-indexer.yaml"),
      "utf8",
    );
    expect(stagedManifest).toContain("version: 1.0.0");
    expect(stagedManifest).not.toContain("decoy-host-skill");
    expect(staged.staged.files).toEqual(bundled.files);
    for (const pluginManifest of [
      join(root, ".claude-plugin", "plugin.json"),
      join(root, ".codex-plugin", "plugin.json"),
      join(root, ".agents", "plugins", "marketplace.json"),
    ]) {
      await expect(readFile(pluginManifest, "utf8")).rejects.toThrow();
    }
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);
});
