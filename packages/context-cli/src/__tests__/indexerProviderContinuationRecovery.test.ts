import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { buildIndexerProviderSelectionProposal, parseIndexerRegistry } from "@c4a/context";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";
import { stageCurrentIndexerProviderResolution } from "../project/indexerCurrentProviderSetup.js";
import {
  advanceCurrentIndexerProviderFinalizationIfReady,
  buildCurrentIndexerProviderContinuationRoute,
} from "../project/indexerCurrentProviderContinuation.js";
import { loadCurrentIndexerProviderSelection } from "../project/indexerCurrentProviderSelection.js";
import { persistCurrentIndexerProviderSetup, readCurrentIndexerProviderSetup } from "../project/indexerCurrentProviderState.js";
import { dispatchProjectIndexerProviderResolution } from "../project/indexerProviderProjectFlow.js";
import { validateProjectIndexerSelectionProposal } from "../project/indexerSelectionProposal.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function interruptedSelection(withHostRequest = false) {
  const root = await mkdtemp(join(tmpdir(), "context-provider-resume-"));
  roots.push(root);
  const bundle = (await listCliBundledIndexers()).bundles.find((item) => item.skill === "context-code-indexer")!;
  const ids = withHostRequest ? ["first", "second", "third"] : ["first", "second"];
  const registry = parseIndexerRegistry(YAML.stringify({
    protocol: "context.indexer.registry/v1",
    requirements: ids.map((id) => ({
      id,
      reader_goals: ["understand-system"],
      coverage_domains: { architecture: "required" },
      target_scope: { targets: [{ source_ref: `repo:${id}`, module_refs: [] }] },
      evidence_source_scope: { targets: [{ source_ref: `repo:${id}`, module_refs: [] }] },
    })),
    indexers: ids.map((id) => ({
      id,
      operations: ["main-index"],
      requirement_bindings: [{ requirement_ref: id, coverage_domains: ["architecture"],
        owned_scope: { ref: `requirement:${id}#target_scope` }, role: "primary" }],
      read_scope: { refs: [`requirement:${id}#target_scope`] },
      profile: { primary: { id: "component-library", provider: "primary" } },
      providers: [{ id: "primary", role: "primary", skill: bundle.skill,
        version: bundle.version, integrity: bundle.integrity,
        distribution: id === "third"
          ? { kind: "workspace", locator: "workspace://skills/context-code-indexer" }
          : bundle.distribution }],
    })),
  }));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify({ ...registry, indexers: [] }));
  const proposal = buildIndexerProviderSelectionProposal({
    protocol: "context.indexer.selection-proposal-input/v1", project_ref: "project:resume", registry,
  });
  const validation = await validateProjectIndexerSelectionProposal({ projectRoot: root, value: proposal });
  const request = validation.resolution_requests[0]!;
  const resolution = await dispatchProjectIndexerProviderResolution({ projectRoot: root, selection: proposal, request });
  if (resolution.state !== "resolved") throw new Error("expected a bundled Provider");
  const staged = await stageCurrentIndexerProviderResolution({
    projectRoot: root, projectRef: proposal.project_ref, proposal, request, resolution,
  });
  // This is the durable boundary used after a Host response or authorization:
  // the accepted resolution is saved, but the remaining providers are pending.
  const saved = await persistCurrentIndexerProviderSetup({ projectRoot: root, proposal, resolved: [staged.resolved] });
  return { root, registry, saved };
}

test.each([false, true])("resumes pending bundled Providers after a durable setup interruption (managed=%s)", async (managed) => {
  const { root, registry, saved } = await interruptedSelection();
  const route = await buildCurrentIndexerProviderContinuationRoute({ projectRoot: root, authorities: [], managed });
  expect(route).toMatchObject({
    node: "finalize-current-indexer-provider-selection", availability: "immediate",
    commands: [{ effect: "write", managed_execution: "automatic" }],
  });
  expect(route?.gate).toBeUndefined();
  expect(await readCurrentIndexerProviderSetup(root)).toEqual(saved);
  expect(await advanceCurrentIndexerProviderFinalizationIfReady(root)).toBe(true);
  expect(await readCurrentIndexerProviderSetup(root)).toBeUndefined();
  const applied = parseIndexerRegistry(await readFile(join(root, "src/indexers.yaml"), "utf8"));
  expect(applied.indexers).toEqual(registry.indexers);
  const selected = await loadCurrentIndexerProviderSelection({ projectRoot: root, registry: applied });
  expect(selected.resolved).toHaveLength(2);
  expect(selected.resolved[0]).toEqual(saved.resolved[0]);
  expect(await advanceCurrentIndexerProviderFinalizationIfReady(root)).toBe(false);
});

test("resuming bundled work stops at a later Host Provider without replaying accepted resolutions", async () => {
  const { root, saved } = await interruptedSelection(true);
  expect(await advanceCurrentIndexerProviderFinalizationIfReady(root)).toBe(true);
  const resumed = await readCurrentIndexerProviderSetup(root);
  expect(resumed?.resolved).toHaveLength(2);
  expect(resumed?.resolved[0]).toEqual(saved.resolved[0]);
  const route = await buildCurrentIndexerProviderContinuationRoute({ projectRoot: root, authorities: [], managed: true });
  expect(route).toMatchObject({ node: "resolve-current-indexer-provider",
    action: { input: { stage: "provider-resolution", request: { provider: { indexer_id: "third" } } } } });
  expect(await advanceCurrentIndexerProviderFinalizationIfReady(root)).toBe(false);
  expect(await readCurrentIndexerProviderSetup(root)).toEqual(resumed);
});
