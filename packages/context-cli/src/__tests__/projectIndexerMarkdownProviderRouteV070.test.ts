import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";
import {
  buildIndexerProviderRouteInput,
  type IndexerRegistry,
} from "@c4a/context";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { materializeBundledIndexerDistribution } from
  "../project/indexerDistributionBuild.js";
import {
  inspectProjectMarkdownProviderCapture,
  validateProjectMarkdownProviderSelection,
} from "../project/indexerMarkdownProviderRoute.js";
import { routeProjectIndexerProviderSelection } from
  "../project/indexerProviderRouting.js";
import { validateProjectIndexerSelectionProposal } from
  "../project/indexerSelectionProposal.js";
import { initContextProject } from "../project/workspace.js";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

function requirementRegistry(sourceRef: string): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "documentation-knowledge",
      reader_goals: ["understand-documentation"],
      coverage_domains: { "business-semantics": "required" },
      target_scope: { targets: [{ source_ref: sourceRef, module_refs: [] }] },
      evidence_source_scope: {
        targets: [{ source_ref: sourceRef, module_refs: [] }],
      },
    }],
    indexers: [],
  };
}

function selectedRegistry(input: {
  base: IndexerRegistry;
  provider: IndexerRegistry["indexers"][number]["providers"][number];
  customization?: "extend";
}): IndexerRegistry {
  return {
    ...input.base,
    indexers: [{
      id: "workspace-markdown",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "documentation-knowledge",
        coverage_domains: ["business-semantics"],
        owned_scope: { ref: "requirement:documentation-knowledge#target_scope" },
        role: "primary",
      }],
      read_scope: {
        refs: ["requirement:documentation-knowledge#evidence_source_scope"],
      },
      profile: {
        primary: { id: "documentation-site", provider: input.provider.id },
      },
      providers: [input.provider],
      ...(input.customization === undefined
        ? {}
        : { customization: { mode: input.customization } }),
    }],
  };
}

async function capturedProject() {
  const root = await mkdtemp(join(tmpdir(), "context-markdown-provider-"));
  temporaryRoots.push(root);
  const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
  const projectRoot = initialized.projectRoot;
  const docsRoot = join(root, "manual");
  await mkdir(docsRoot, { recursive: true });
  await writeFile(join(docsRoot, "intro.md"), "# Intro\n\nCaptured semantics.\n", "utf8");
  await runCliInDir(projectRoot, [
    "source", "add", "file", "20260828",
    "--module", "manual",
    "--local", docsRoot,
    "--format", "json",
  ]);
  await writeFile(join(projectRoot, "src", "index.ts"), [
    'import { captureFile, defineProject, source } from "@c4a/context";',
    "",
    'const manual = source("20260828", "manual", { type: "file" });',
    "",
    "export default defineProject({",
    "  sources: [manual],",
    "  phases: [captureFile({ source: manual })],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
  await runCliInDir(projectRoot, [
    "run", "capture:file:20260828/manual", "--format", "json",
  ]);
  const sourceRef = "file:20260828/manual";
  const registry = requirementRegistry(sourceRef);
  await writeFile(
    join(projectRoot, "src", "indexers.yaml"),
    YAML.stringify(registry),
    "utf8",
  );
  return { root, projectRoot, docsRoot, sourceRef, registry };
}

async function capturedProjectWithDistribution() {
  const fixture = await capturedProject();
  const assetsRoot = join(fixture.root, "assets");
  const release = await materializeBundledIndexerDistribution({
    packageRoot: PACKAGE_ROOT,
    outputRoot: assetsRoot,
  });
  return { ...fixture, assetsRoot, release };
}

describe("Markdown Provider Route", () => {
  test("ships only the unified main Indexer Result path for Markdown", async () => {
    const [
      manifest,
      instructions,
      classification,
      structure,
      editorial,
      routeSource,
      runSource,
      dependencySource,
    ] =
      await Promise.all([
        readFile(join(
          REPOSITORY_ROOT,
          "plugins/context/skills/context-markdown-indexer/context-indexer.yaml",
        ), "utf8"),
        readFile(join(
          REPOSITORY_ROOT,
          "plugins/context/skills/context-markdown-indexer/references/indexer.md",
        ), "utf8"),
        readFile(join(
          REPOSITORY_ROOT,
          "plugins/context/skills/context-markdown-indexer/references/classification.md",
        ), "utf8"),
        readFile(join(
          REPOSITORY_ROOT,
          "plugins/context/skills/context-markdown-indexer/references/structure-and-artifacts.md",
        ), "utf8"),
        readFile(join(
          REPOSITORY_ROOT,
          "plugins/context/skills/context-markdown-indexer/references/editorial-policy.md",
        ), "utf8"),
        readFile(join(PACKAGE_ROOT, "src/project/indexerMarkdownProviderRoute.ts"), "utf8"),
        readFile(join(
          REPOSITORY_ROOT,
          "packages/context/src/indexerMainRunProtocol.ts",
        ), "utf8"),
        readFile(join(
          REPOSITORY_ROOT,
          "packages/context/src/indexerArtifactDependencies.ts",
        ), "utf8"),
      ]);
    expect(manifest).toContain("consumes: context.indexer.main-workset/v1");
    expect(manifest).toContain("produces: context.indexer.main-result/v1");
    expect(instructions).toContain(
      "Never create a legacy `MarkdownCollectionSlice` or invoke the independent `alignProse` phase.",
    );
    expect(manifest).toContain("path: references/classification.md");
    expect(manifest).toContain("path: references/structure-and-artifacts.md");
    expect(manifest).toContain("path: references/editorial-policy.md");
    expect(classification).toContain("`document_kind`");
    expect(classification).toContain("`reader_goal`");
    expect(classification).toContain("not authorize a collection or output path");
    expect(structure).toContain("`promote-reader-artifact`");
    expect(structure).toContain("`retain-section-group`");
    expect(structure).toContain("`keep-unresolved`");
    expect(editorial).toContain("`unanswered-question-set`");
    expect(editorial).toContain("`request-input`");
    expect(editorial).toContain("Section-specific assessment");
    expect(`${manifest}\n${routeSource}\n${runSource}\n${dependencySource}`).not.toMatch(
      /MarkdownCollectionSlice|alignProse/u,
    );
  });

  test("requires current capture before Agent discovery and detects capture loss", async () => {
    const fixture = await capturedProject();
    const captureInput = {
      protocol: "context.indexer.markdown-provider-capture-input/v1",
      project_ref: "project:markdown-provider",
      source_refs: [fixture.sourceRef],
    };
    const current = await inspectProjectMarkdownProviderCapture({
      projectRoot: fixture.projectRoot,
      value: captureInput,
    });
    expect(current).toMatchObject({
      requested_source_refs: [fixture.sourceRef],
      unavailable_source_refs: [],
      outcome: "markdown-provider-discovery-required",
      graph_outcome: "completed",
    });

    await rm(join(fixture.projectRoot, "sources", "file", "20260828"), {
      recursive: true,
      force: true,
    });
    const stale = await inspectProjectMarkdownProviderCapture({
      projectRoot: fixture.projectRoot,
      value: captureInput,
    });
    expect(stale).toMatchObject({
      unavailable_source_refs: [fixture.sourceRef],
      outcome: "index-document-capture-not-current",
      graph_outcome: "blocked",
    });
  }, 15000);

  test("resolves and stages the exact CLI-bundled Markdown Provider", async () => {
    const fixture = await capturedProjectWithDistribution();
    const capture = await inspectProjectMarkdownProviderCapture({
      projectRoot: fixture.projectRoot,
      value: {
        protocol: "context.indexer.markdown-provider-capture-input/v1",
        project_ref: "project:markdown-provider",
        source_refs: [fixture.sourceRef],
      },
    });
    const bundle = fixture.release.bundles.find((candidate) =>
      candidate.skill === "context-markdown-indexer"
    )!;
    const selected = selectedRegistry({
      base: fixture.registry,
      provider: {
        id: "community",
        role: "primary",
        skill: bundle.skill,
        version: bundle.version,
        integrity: bundle.integrity,
        distribution: bundle.distribution,
      },
    });
    const routeInput = buildIndexerProviderRouteInput({
      project_ref: capture.project_ref,
      registry: selected,
      visible_skills: [{
        skill: bundle.skill,
        version: bundle.version,
        source_type: "cli-bundled",
      }],
      community_fallback_attempted: true,
    });
    const route = await routeProjectIndexerProviderSelection({
      projectRoot: fixture.projectRoot,
      value: routeInput,
    });
    const staticValidation = await validateProjectIndexerSelectionProposal({
      projectRoot: fixture.projectRoot,
      value: route.selection_proposal_input,
    });
    const result = await validateProjectMarkdownProviderSelection({
      projectRoot: fixture.projectRoot,
      assetsRoot: fixture.assetsRoot,
      value: {
        protocol: "context.indexer.markdown-provider-validation-input/v1",
        capture_report: capture,
        provider_route_input: routeInput,
        provider_route_report: route,
        static_validation: staticValidation,
      },
    });
    expect(result).toMatchObject({
      outcome: "markdown-provider-selection-current",
      graph_outcome: "completed",
      final_report: {
        protocol: "context.indexer.selection-final-report/v1",
      },
    });
  }, 15000);

  test("returns exact Host and customization boundaries instead of bypassing them", async () => {
    const fixture = await capturedProject();
    const capture = await inspectProjectMarkdownProviderCapture({
      projectRoot: fixture.projectRoot,
      value: {
        protocol: "context.indexer.markdown-provider-capture-input/v1",
        project_ref: "project:markdown-provider",
        source_refs: [fixture.sourceRef],
      },
    });
    const provider = {
      id: "external",
      role: "primary" as const,
      skill: "context-markdown-indexer-external",
      version: "1.0.0",
      integrity: `sha256:${"b".repeat(64)}`,
      distribution: {
        kind: "marketplace" as const,
        locator: "marketplace://public/example/context-markdown-indexer-external",
      },
    };
    const validate = async (customization?: "extend", hostResults?: unknown[]) => {
      const routeInput = buildIndexerProviderRouteInput({
        project_ref: capture.project_ref,
        registry: selectedRegistry({
          base: fixture.registry,
          provider,
          ...(customization === undefined ? {} : { customization }),
        }),
        visible_skills: [{
          skill: provider.skill,
          version: provider.version,
          source_type: "marketplace",
        }],
        community_fallback_attempted: true,
      });
      const route = await routeProjectIndexerProviderSelection({
        projectRoot: fixture.projectRoot,
        value: routeInput,
      });
      const staticValidation = await validateProjectIndexerSelectionProposal({
        projectRoot: fixture.projectRoot,
        value: route.selection_proposal_input,
      });
      return validateProjectMarkdownProviderSelection({
        projectRoot: fixture.projectRoot,
        value: {
          protocol: "context.indexer.markdown-provider-validation-input/v1",
          capture_report: capture,
          provider_route_input: routeInput,
          provider_route_report: route,
          static_validation: staticValidation,
          ...(hostResults === undefined ? {} : { host_results: hostResults }),
        },
      });
    };

    const host = await validate();
    expect(host).toMatchObject({
      outcome: "markdown-provider-host-resolution-required",
      graph_outcome: "partial",
      host_requests: [{
        state: "host-action-required",
        location: {
          schema: "agent-graph.resource-location.v2",
          materialize: {
            handler: "context.resolve-indexer-provider/v1",
          },
        },
      }],
    });
    const customization = await validate("extend");
    expect(customization).toMatchObject({
      outcome: "indexer-customization-required",
      graph_outcome: "blocked",
      indexer_ids: ["workspace-markdown"],
    });
    await expect(validate(undefined, [{
      indexer_id: "other-indexer",
      provider_id: "external",
      result: {},
    }])).rejects.toThrow(/not authorized for external resolution/);
  }, 15000);
});
