import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  buildIndexerProviderRouteInput,
  type IndexerRegistry,
} from "@c4a/context";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { loadContextWorkflowProvider } from "../project/workflow/workflowProvider.js";
import { planForHostHandler } from "../project/workflow/workflowHostPlans.js";
import { emptyObservation } from "./projectWorkflowProviderV0610.fixtures.js";

const INTEGRITY = `sha256:${"a".repeat(64)}`;

function registry(): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "workspace-knowledge",
      reader_goals: ["understand-system"],
      coverage_domains: { architecture: "required" },
      target_scope: {
        targets: [{ source_ref: "repo:sample", module_refs: ["module:app"] }],
      },
      evidence_source_scope: {
        targets: [{ source_ref: "repo:sample", module_refs: ["module:app"] }],
      },
    }],
    indexers: [],
  };
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-provider-route-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "provider-route-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src", "indexers.yaml"), YAML.stringify(registry()), "utf8");
  return root;
}

function selectedRegistry(): IndexerRegistry {
  const selected = registry();
  selected.indexers = [{
    id: "architecture-indexer",
    operations: ["main-index"],
    requirement_bindings: [{
      requirement_ref: "workspace-knowledge",
      coverage_domains: ["architecture"],
      owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
      role: "primary",
    }],
    read_scope: { refs: ["requirement:workspace-knowledge#target_scope"] },
    profile: { primary: { id: "domain-service", provider: "community" } },
    providers: [{
      id: "community",
      role: "primary",
      skill: "context-code-indexer",
      version: "0.7.0",
      integrity: INTEGRITY,
      distribution: {
        kind: "cli-bundled",
        locator: "cli-bundled://context/context-code-indexer",
      },
    }],
  }];
  return selected;
}

describe("project Indexer Provider routing", () => {
  test("routes no match to community fallback without writing runtime or source state", async () => {
    const root = await project();
    const registryPath = join(root, "src", "indexers.yaml");
    const before = await readFile(registryPath, "utf8");
    const input = buildIndexerProviderRouteInput({
      project_ref: "project:provider-route-fixture",
      registry: registry(),
      visible_skills: [{
        skill: "context-code-indexer",
        version: "0.7.0",
        source_type: "cli-bundled",
      }],
      community_fallback_attempted: false,
    });
    const inputPath = join(root, "provider-route-input.json");
    await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
    const result = JSON.parse(await runCliInDir(root, [
      "indexer", "route-indexer-provider-selection",
      "--input", inputPath,
      "--format", "json",
    ]));

    expect(result.route).toEqual({
      outcome: "community-fallback-required",
      graph_outcome: "partial",
      next_action: "configure-community-indexer-fallback",
    });
    expect(await readFile(registryPath, "utf8")).toBe(before);
    expect(existsSync(join(root, ".tmp"))).toBe(false);
  });

  test("hands a closed fallback selection to the existing static validation Action", async () => {
    const root = await project();
    const input = buildIndexerProviderRouteInput({
      project_ref: "project:provider-route-fixture",
      registry: selectedRegistry(),
      visible_skills: [{
        skill: "context-code-indexer",
        version: "0.7.0",
        source_type: "cli-bundled",
      }],
      community_fallback_attempted: true,
    });
    const inputPath = join(root, "provider-route-input.json");
    await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
    const route = JSON.parse(await runCliInDir(root, [
      "indexer", "route-indexer-provider-selection",
      "--input", inputPath,
      "--format", "json",
    ]));
    expect(route.route.outcome).toBe("selection-validation-required");
    const selectionPath = join(root, "selection-input.json");
    await writeFile(
      selectionPath,
      `${JSON.stringify(route.selection_proposal_input, null, 2)}\n`,
      "utf8",
    );
    const validation = JSON.parse(await runCliInDir(root, [
      "indexer", "validate-indexer-selection-proposal",
      "--input", selectionPath,
      "--format", "json",
    ]));
    expect(validation.outcome).toBe("provider-resolution-required");
    expect(validation.next_provider_requests).toHaveLength(1);
  });

  test("publishes a reachable Agent/Host fallback graph and registered handlers", async () => {
    const provider = await loadContextWorkflowProvider();
    const graph = provider.graphs.get("indexer")?.definition;
    expect(graph?.entrypoints["provider-selection"]).toBe("configure-indexer-providers");
    expect(graph?.nodes.some((node) => node.id === "configure-community-indexer-fallback"))
      .toBe(true);
    expect(graph?.nodes.some((node) => node.id === "indexer-provider-conflict"))
      .toBe(true);
    expect(graph?.nodes.some((node) => node.id === "indexer-customization-required"))
      .toBe(true);
    expect(() => planForHostHandler(
      "context.route-indexer-provider-selection/v1",
      emptyObservation(),
    )).not.toThrow();
    expect(() => planForHostHandler(
      "context.validate-indexer-selection-proposal/v1",
      emptyObservation(),
    )).not.toThrow();
  });
});
