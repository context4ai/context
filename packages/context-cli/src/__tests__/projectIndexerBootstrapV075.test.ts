import { afterEach, describe, expect, test } from "bun:test";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import type { IndexerRegistry } from "@c4a/context";
import { runCurrentIndexerLifecycle } from "../project/indexerLifecycleRun.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { collectProjectStatus } from "../project/status.js";
import { ensureRepoSources } from "../project/repoSources.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function workspace() {
  const root = await realpath(await createDocumentRevisionWorkspace());
  roots.push(root);
  // Match the CLI's canonical project root, including macOS /var aliases,
  // and let the real source command normalize the materialized link.
  await ensureRepoSources({ projectRoot: root });
  // This fixture is a fresh project with one tiny registered source, not an
  // approved-knowledge replay. Never delete runtime data to advance a test.
  await rm(join(root, "knowledge", "structure.yaml"));
  const registryPath = join(root, "src", "indexers.yaml");
  const registry = YAML.parse(await readFile(registryPath, "utf8")) as IndexerRegistry;
  return { root, registry, registryPath };
}

describe("Indexer bootstrap follows the current workspace Graph", () => {
  for (const managed of [false, true]) {
    test(`missing registry exposes configuration without Partition setup (managed=${managed})`, async () => {
      const { root, registryPath } = await workspace();
      await rm(registryPath);
      const before = await collectProjectStatus(root, { managed });
      const output = JSON.parse(await runCliInDir(root, [
        "run", ...(managed ? ["--managed"] : []), "--format", "json",
      ]));
      expect(output).toMatchObject({ advanced: false, state: "agent-required" });
      expect(output.workflow).toEqual(before.workflow);
      expect(output.workflow.current).toMatchObject({
        node: "run-indexer-lifecycle",
        commands: [],
        configuration: { file: "src/indexers.yaml", action: expect.stringContaining("indexers: []") },
      });
      expect(await currentLedger(root)).toBeUndefined();
    });

    test(`requirements without owners stop at Provider selection (managed=${managed})`, async () => {
      const { root, registry, registryPath } = await workspace();
      await writeFile(registryPath, YAML.stringify({ ...registry, indexers: [] }));
      const before = await collectProjectStatus(root, { managed });
      const output = await runCurrentIndexerLifecycle({ projectRoot: root, managed, authorities: [] });
      expect(output).toMatchObject({ advanced: false, state: "agent-required" });
      expect(output.workflow).toEqual(before.workflow);
      expect(output.workflow.current).toMatchObject({
        node: "configure-indexer-providers",
        action: { input: { stage: "provider-selection", requirements: registry.requirements } },
      });
      expect(await currentLedger(root)).toBeUndefined();
    });
  }

  test("managed loop stops at explicit configuration, then at semantic selection", async () => {
    const { root, registry, registryPath } = await workspace();
    await rm(registryPath);
    const args = ["run", "--managed", "--until", "blocked-or-complete", "--format", "json"];
    const configuration = JSON.parse(await runCliInDir(root, args));
    expect(configuration).toMatchObject({
      state: "blocked",
      steps: [],
      stop: { reasonCode: "workflow.until.configuration-required" },
      workflow: { current: { configuration: { file: "src/indexers.yaml" } } },
    });
    await writeFile(registryPath, YAML.stringify({ ...registry, indexers: [] }));
    const selection = JSON.parse(await runCliInDir(root, args));
    expect(selection).toMatchObject({
      state: "blocked", steps: [], workflow: { current: { node: "configure-indexer-providers" } },
    });
    expect(await currentLedger(root)).toBeUndefined();
  });

  test("a real Provider completion continues to Partition and a repeated run does not restart it", async () => {
    const { root, registry, registryPath } = await workspace();
    await writeFile(registryPath, YAML.stringify({ ...registry, indexers: [] }));
    const output = await runCurrentIndexerLifecycle({ projectRoot: root, managed: true, authorities: [] });
    const route = output.workflow.current!;
    const payload = join(root, "selection.json");
    await writeFile(payload, JSON.stringify({
      stage: "provider-selection", host_visible_skills: [], indexers: registry.indexers,
    }));
    const completion = JSON.parse(await runCliInDir(root, [
      "action", "complete-current", "--revision", route.revision,
      "--managed", "--input", payload, "--format", "json",
    ]));
    expect(completion.outcome).toBe("selection-applied");
    const ledger = await currentLedger(root);
    expect(ledger?.entries.some((entry) => entry.stage === "partition" && entry.state === "running")).toBe(true);
    const resumed = await runCurrentIndexerLifecycle({ projectRoot: root, managed: true, authorities: [] });
    expect(resumed.advanced).toBe(false);
    expect(resumed.workflow.current?.node).toBe("run-indexer-agent-step");
    expect(await currentLedger(root)).toEqual(ledger);
  }, 30_000);

  test("dry-run observes the ready deterministic route without preparing a ledger", async () => {
    const { root } = await workspace();
    const output = JSON.parse(await runCliInDir(root, ["run", "--managed", "--dry-run", "--format", "json"]));
    expect(output.advanced).toBe(false);
    expect(output.workflow.current.node).toBe("advance-current-indexer-lifecycle");
    expect(await currentLedger(root)).toBeUndefined();
  });

  test("a selected registry advances only the current deterministic action", async () => {
    const { root } = await workspace();
    const output = await runCurrentIndexerLifecycle({ projectRoot: root, managed: true, authorities: [] });
    expect(output.advanced).toBe(true);
    expect(output.workflow.current?.node).toBe("run-indexer-agent-step");
    expect(await currentLedger(root)).toBeDefined();
  }, 20_000);

  test("invalid configuration is rejected instead of being treated as missing", async () => {
    const { root, registryPath } = await workspace();
    await writeFile(registryPath, "protocol: [invalid\n");
    await expect(runCurrentIndexerLifecycle({
      projectRoot: root, managed: true, authorities: [],
    })).rejects.toThrow("is not valid YAML");
    expect(await currentLedger(root)).toBeUndefined();
  });
});
