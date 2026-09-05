import { afterEach, describe, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import type { IndexerRegistry } from "@c4a/context";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { hasChangedIndexerWorksetAuthority } from "../project/indexerCurrentRegistryFreshness.js";
import { projectCurrentIndexerWorkflowRoute } from "../project/indexerCurrentWorkflowRoute.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import { project } from "./projectIndexerMainLifecycleV070.fixture.js";
import { documentRevisionOuterIndexerRoute } from "./projectDocumentRevisionV074.fixture.js";
import { completeCurrentIndexerProviderSelection } from "../project/indexerCurrentProviderSetup.js";
import { loadCurrentIndexerProviderSelection } from "../project/indexerCurrentProviderSelection.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const { root } = await project();
  roots.push(root);
  await advanceCurrentIndexerLifecycle(root);
  const path = join(root, "src", "indexers.yaml");
  const registry = YAML.parse(await readFile(path, "utf8")) as IndexerRegistry;
  const route = () => projectCurrentIndexerWorkflowRoute({
    projectRoot: root, route: documentRevisionOuterIndexerRoute(), managed: true,
    authorities: contextWorkflowAuthorities({ managed: true }),
  });
  return { root, registry, route, save: () => writeFile(path, YAML.stringify(registry)) };
}

describe("current registry changes invalidate workset authority", () => {
  test("refreshes a stale applied selection through its existing route without discarding valid work", async () => {
    const { root, registry, route, save } = await setup();
    const select = () => completeCurrentIndexerProviderSelection({
      projectRoot: root, currentRegistry: registry,
      semantic: { stage: "provider-selection", host_visible_skills: [], indexers: registry.indexers },
    });
    await select();
    const original = await route();
    registry.indexers[0]!.profile.primary.id = "web-application";
    await save();
    const refresh = await route();
    expect(refresh?.action?.input).toMatchObject({ stage: "provider-selection" });
    expect(refresh?.revision).not.toBe(original?.revision);
    await advanceCurrentIndexerLifecycle(root);
    const prepared = await currentLedger(root);
    await select();
    await advanceCurrentIndexerLifecycle(root);
    expect((await currentLedger(root))?.ledger_digest).toBe(prepared?.ledger_digest);
    expect((await route())?.node).toBe("run-indexer-agent-step");
    await expect(loadCurrentIndexerProviderSelection({ projectRoot: root, registry })).resolves.toBeDefined();

    // A second edit changes selection CAS even if the reader requirements stay identical.
    registry.indexers[0]!.profile.primary.id = "component-library";
    await save();
    expect((await route())?.revision).not.toBe(refresh?.revision);
  }, 20_000);

  test("replans a running batch after a profile change and rejects its old completion", async () => {
    const { root, registry, route, save } = await setup();
    const oldRoute = await route();
    expect(oldRoute?.node).toBe("run-indexer-agent-step");
    registry.indexers[0]!.profile.primary.id = "web-application";
    await save();

    expect((await route())?.node).toBe("advance-current-indexer-lifecycle");
    await expect(completeCurrentIndexerAction({
      cwd: root, revision: oldRoute!.revision, managed: true,
      value: { stage: "partition", results: [{ task_key: "task-001", result: {
        stage: "partition", outcome: "complete", groups: [], excluded: [], unsupported: [],
      } }] },
    })).rejects.toThrow("current Indexer batch changed");

    await advanceCurrentIndexerLifecycle(root);
    const next = await route();
    expect(next?.node).toBe("run-indexer-agent-step");
    expect(next?.revision).not.toBe(oldRoute?.revision);
    const instructions = next!.resources.required.find((item) => item.id === "resolved-indexer-instructions");
    if (instructions === undefined || !("path" in instructions)) throw new Error("missing instructions");
    const materialized = await readFile(instructions.path!, "utf8");
    expect(materialized).toContain("Web and interactive application template");
    expect(materialized).not.toContain("# Component library template");
    expect(await hasChangedIndexerWorksetAuthority(root, await currentLedger(root))).toBe(false);
  }, 20_000);

  test("keeps an unchanged running batch and primary instructions for composer-only edits", async () => {
    const { root, registry, route, save } = await setup();
    const oldRoute = await route();
    const before = await currentLedger(root);
    await advanceCurrentIndexerLifecycle(root);
    expect((await currentLedger(root))?.ledger_digest).toBe(before?.ledger_digest);
    registry.indexers[0]!.profile.composers = [{ id: "public-contract", provider: "community" }];
    await save();
    expect(await hasChangedIndexerWorksetAuthority(root, before)).toBe(false);
    expect((await route())?.revision).toBe(oldRoute?.revision);
  }, 20_000);

  test("detects a reader requirement change before returning the old task", async () => {
    const { root, registry, route, save } = await setup();
    registry.requirements[0]!.reader_goals.push("understand-input-contract");
    await save();
    expect((await route())?.node).toBe("advance-current-indexer-lifecycle");
    await advanceCurrentIndexerLifecycle(root);
    expect(await hasChangedIndexerWorksetAuthority(root, await currentLedger(root))).toBe(false);
  }, 20_000);
});
