import { afterEach, describe, expect, test } from "bun:test";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  indexerProviderSelectionSemanticInputSchema,
  parseIndexerRegistry,
  type IndexerRegistry,
} from "@c4a/context";
import { validateSchemaDocument } from "@c4a/agent-graph";
import { runCurrentIndexerLifecycle } from "../project/indexerLifecycleRun.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { collectProjectStatus } from "../project/status.js";
import { ensureRepoSources } from "../project/repoSources.js";
import { inspectProjectIndexerRequirements } from "../project/indexerRequirementProject.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import type { projectIndexerSelectionCatalog } from "../project/indexerProviderSelectionCatalog.js";
import { indexerCurrentActionJsonSchema } from "../../scripts/indexerActionSchema.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { ContextError } from "../lib/errors.js";

const roots: string[] = [];
async function expectWorkStartResources(route: {
  resources: { recommended: Array<{ id: string; path?: string }> };
}) {
  for (const id of ["procedure.work-start-report", "template.work-start-report"]) {
    const resource = route.resources.recommended.find((entry) => entry.id === id);
    expect(resource?.path).toBeDefined();
    const text = await readFile(resource!.path!, "utf8");
    const metadata = YAML.parse(text.split("---")[1]!);
    expect(metadata.id).toBe(id);
  }
}

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
      const summary = JSON.parse(await runCliInDir(root, [
        "status", ...(managed ? ["--managed"] : []), "--format", "json", "--view", "summary",
      ]));
      expect(JSON.parse(await readFile(summary.next_route.file, "utf8"))).toEqual(before.workflow.current);
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
      await expectWorkStartResources(output.workflow.current);
    });

    test(`requirements without owners stop at Provider selection (managed=${managed})`, async () => {
      const { root, registry, registryPath } = await workspace();
      await writeFile(registryPath, YAML.stringify({ ...registry, indexers: [] }));
      const before = await collectProjectStatus(root, { managed });
      const summary = JSON.parse(await runCliInDir(root, [
        "status", ...(managed ? ["--managed"] : []), "--format", "json", "--view", "summary",
      ]));
      expect(JSON.parse(await readFile(summary.next_route.file, "utf8"))).toEqual(before.workflow.current);
      const output = await runCurrentIndexerLifecycle({ projectRoot: root, managed, authorities: [] });
      expect(output).toMatchObject({ advanced: false, state: "agent-required" });
      expect(output.workflow).toEqual(before.workflow);
      expect(output.workflow.current).toMatchObject({
        node: "configure-indexer-providers",
        action: { input: { stage: "provider-selection", requirements: registry.requirements } },
      });
      expect(await currentLedger(root)).toBeUndefined();
      await expectWorkStartResources(output.workflow.current!);
    });

    test(`Route contracts and examples continue from bootstrap through Provider selection (managed=${managed})`, async () => {
      const { root, registry, registryPath } = await workspace();
      await rm(registryPath);
      const before = await collectProjectStatus(root, { managed });
      const route = before.workflow.current!;
      expect(route.resources.required.map((resource) => resource.id))
        .toContain("context.source-boundary");
      const guideResource = route.resources.required.find((resource) =>
        resource.id === "context.indexer.provider-guide"
      )!;
      expect(guideResource).toMatchObject({ kind: "procedure", read_state: "read-required" });
      const guide = await readFile(guideResource.path!, "utf8");
      const schemaResource = route.resources.required.find((resource) =>
        resource.id === "context.indexer.registry-bootstrap"
      )!;
      expect(schemaResource).toMatchObject({ kind: "schema", read_state: "read-required" });
      const schema = JSON.parse(await readFile(schemaResource.path!, "utf8"));
      const example = /```yaml\n([\s\S]*?)\n```/u.exec(guide.split("## Initial registry:")[1]!)![1]!;
      const sourceRef = registry.requirements[0]!.target_scope.targets[0]!.source_ref;
      // Follow the shipped recipe, not the pre-filled fixture's requirements.
      const exampleRegistry = YAML.parse(example) as IndexerRegistry;
      const exampleSource = exampleRegistry.requirements[0]!.target_scope.targets[0]!.source_ref;
      const yaml = example.replaceAll(exampleSource, sourceRef);
      const value = YAML.parse(yaml) as IndexerRegistry;
      expect(() => validateSchemaDocument(schema, value, "initial registry")).not.toThrow();
      expect(parseIndexerRegistry(yaml).requirements[0]!.target_scope.targets[0]!.module_refs).toEqual([]);
      const inspected = await inspectProjectIndexerRequirements({
        projectRoot: root,
        value: {
          protocol: "context.indexer.requirement-inspection-input/v1",
          project_ref: root,
          requirements: value.requirements,
        },
      });
      expect(inspected.requirement_set.requirements[0]!.target_scope.targets[0]!.source_ref).toBe(sourceRef);
      for (const invalid of [
        { ...value, protocol: "context.indexer.requirement-set/v1" },
        { ...value, requirements: [] },
        { ...value, requirement_set: value.requirements },
        { ...value, requirements: [{ ...value.requirements[0], reader_goals: [] }] },
        { ...value, requirements: [{ ...value.requirements[0], coverage_domains: { usage: "yes" } }] },
        { ...value, requirements: [{ ...value.requirements[0], target_scope: { targets: [] } }] },
        { ...value, requirements: [{ ...value.requirements[0], questions: ["How do I use this?"] }] },
      ]) {
        expect(() => validateSchemaDocument(schema, invalid, "initial registry")).toThrow();
        expect(() => parseIndexerRegistry(YAML.stringify(invalid))).toThrow();
      }
      await writeFile(registryPath, yaml);
      const next = await runCurrentIndexerLifecycle({ projectRoot: root, managed, authorities: [] });
      expect(next.workflow.current).toMatchObject({
        node: "configure-indexer-providers",
        action: { input: { stage: "provider-selection", requirements: parseIndexerRegistry(yaml).requirements } },
      });
      expect(await currentLedger(root)).toBeUndefined();
      const selectionRoute = next.workflow.current!;
      const input = selectionRoute.action!.input as unknown as {
        cli_bundled_providers: Awaited<ReturnType<typeof projectIndexerSelectionCatalog>>;
      };
      const provider = input.cli_bundled_providers.find((entry) =>
        entry.capabilities.profiles.includes("component-library")
      )!;
      expect(provider.capabilities.operations).toContain("main-index");
      const manifest = YAML.parse(await readFile(provider.guidance.manifest_path, "utf8"));
      expect(manifest).toMatchObject({ id: provider.skill, version: provider.version });
      expect(await readFile(provider.guidance.skill_path, "utf8")).toContain(provider.skill);
      const selectionTemplate = /```yaml\n([\s\S]*?)\n```/u.exec(
        guide.split("## Provider selection result")[1]!,
      )![1]!;
      const requirement = value.requirements[0]!;
      const requiredDomains = Object.entries(requirement.coverage_domains)
        .filter(([, coverage]) => coverage === "required").map(([domain]) => domain);
      const selection = YAML.parse(selectionTemplate
        .replaceAll("<requirement.id>", requirement.id)
        .replaceAll("<required-domain>", requiredDomains[0]!)
        .replaceAll("<catalog.skill>", provider.skill)
        .replaceAll("<catalog.version>", provider.version)
        .replaceAll("<catalog.integrity>", provider.integrity)
        .replaceAll("<catalog.distribution.locator>", provider.distribution.locator));
      selection.indexers[0].requirement_bindings[0].coverage_domains = requiredDomains;
      const selectionSchema = JSON.parse(await readFile(selectionRoute.action!.output_schema!.path!, "utf8"));
      expect(selectionSchema).toEqual(indexerCurrentActionJsonSchema());
      expect(() => validateSchemaDocument(selectionSchema, selection, "Provider selection")).not.toThrow();
      expect(() => indexerProviderSelectionSemanticInputSchema.parse(selection)).not.toThrow();
      const entry = selection.indexers[0];
      for (const invalidEntry of [
        { ...entry, providers: undefined },
        { ...entry, profile: undefined },
        { ...entry, requirement_bindings: [] },
        { ...entry, profiles: entry.profile },
        { ...entry, profile: { primary: { id: "component-library" } } },
        { ...entry, providers: [{ ...entry.providers[0], role: "owner" }] },
        { ...entry, providers: [{ ...entry.providers[0], distribution: { kind: "local", locator: "./provider" } }] },
        { ...entry, requirement_bindings: [{ ...entry.requirement_bindings[0], owned_scope: { path: "./src" } }] },
      ]) {
        const invalid = JSON.parse(JSON.stringify({ ...selection, indexers: [invalidEntry] }));
        expect(() => validateSchemaDocument(selectionSchema, invalid, "Provider selection")).toThrow();
        expect(() => indexerProviderSelectionSemanticInputSchema.parse(invalid)).toThrow();
      }
      const payload = join(root, "selection.json");
      const beforeSelection = await readFile(registryPath, "utf8");
      const rejected = await completeCurrentIndexerAction({
        cwd: root, revision: selectionRoute.revision, managed,
        value: { ...selection, indexers: [entry, { ...entry, id: "competing-owner" }] },
      }).catch((error: unknown) => error);
      expect(rejected).toBeInstanceOf(ContextError);
      expect((rejected as ContextError).detail).toMatchObject({
        reason: "indexer-provider-conflict",
        conflicting_owner_cells: expect.arrayContaining([
          expect.objectContaining({ indexer_ids: expect.arrayContaining([entry.id, "competing-owner"]) }),
        ]),
        revision_advanced: false,
        current_revision: selectionRoute.revision,
        next_action: { command: selectionRoute.commands[0], output_schema: selectionRoute.action!.output_schema },
      });
      expect(await readFile(registryPath, "utf8")).toBe(beforeSelection);
      expect(await currentLedger(root)).toBeUndefined();
      await writeFile(payload, JSON.stringify(selection));
      const completion = JSON.parse(await runCliInDir(root, [
        "action", "complete-current", "--revision", selectionRoute.revision,
        ...(managed ? ["--managed"] : []), "--input", payload, "--format", "json",
      ]));
      expect(completion.outcome).toBe("selection-applied");
      const ledger = await currentLedger(root);
      expect(ledger?.entries.some((entry) => entry.stage === "partition" && entry.state === "running")).toBe(true);
      expect((await collectProjectStatus(root, { managed })).workflow.current?.node).toBe("run-indexer-agent-step");
    }, 60_000);
  }

  test("managed loop stops at explicit configuration, then at semantic selection", async () => {
    const { root, registry, registryPath } = await workspace();
    await rm(registryPath);
    const args = ["run", "--managed", "--until", "blocked-or-complete", "--format", "json", "--verbose"];
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
  }, 60_000);

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
    const result = await runCurrentIndexerLifecycle({
      projectRoot: root, managed: true, authorities: [],
    });
    expect(result.state).toBe("failed");
    expect(result.advanced).toBe(false);
    expect(JSON.stringify(result.workflow.diagnostics)).toContain("is not valid YAML");
    expect(await currentLedger(root)).toBeUndefined();
  });
});
