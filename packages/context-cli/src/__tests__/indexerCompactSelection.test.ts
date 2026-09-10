import { afterEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { indexerProviderSelectionSemanticInputSchema, loadIndexerRegistry } from "@c4a/context";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";
import { expandIndexerSelectionCatalog } from "../project/indexerProviderSelectionCatalog.js";
import { buildCurrentIndexerProviderSelectionRoute, completeCurrentIndexerProviderSelection } from "../project/indexerCurrentProviderSetup.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  const { registry } = await loadIndexerRegistry(root);
  const catalog = await listCliBundledIndexers();
  const semantic = indexerProviderSelectionSemanticInputSchema.parse({
    stage: "provider-selection", indexers: registry.indexers.map(entry => ({ ...entry,
      providers: entry.providers.map(({ id, role, skill, config }) => ({ id, role, catalog_skill: skill, config })),
    })),
  });
  return { root, registry, catalog, semantic };
}

test("compact selection expands to the same complete registry and persists full identity", async () => {
  const { root, registry, catalog, semantic } = await fixture();
  expect(expandIndexerSelectionCatalog(semantic, registry, catalog)).toEqual(registry);
  const empty = { ...registry, indexers: [] };
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify(empty));
  expect(await completeCurrentIndexerProviderSelection({ projectRoot: root,
    currentRegistry: empty, catalog, semantic })).toBe("selection-applied");
  expect((await loadIndexerRegistry(root)).registry).toEqual(registry);
  expect(await readFile(join(root, "src/indexers.yaml"), "utf8")).not.toContain("catalog_skill");
});

test("unknown and ambiguous catalog choices fail; overrides cannot accompany a reference", async () => {
  const { registry, catalog, semantic } = await fixture();
  expect(() => expandIndexerSelectionCatalog(semantic, registry, { ...catalog, bundles: [] })).toThrow("exactly one");
  expect(() => expandIndexerSelectionCatalog(semantic, registry,
    { ...catalog, bundles: [...catalog.bundles, ...catalog.bundles] })).toThrow("exactly one");
  const conflicting = structuredClone(semantic);
  Object.assign(conflicting.indexers[0]!.providers[0]!, { version: "999.0.0" });
  expect(indexerProviderSelectionSemanticInputSchema.safeParse(conflicting).success).toBe(false);
  const invalid = structuredClone(semantic);
  invalid.indexers[0]!.profile.primary.provider = "missing-layer";
  expect(() => expandIndexerSelectionCatalog(invalid, registry, catalog)).toThrow();
});

test("catalog identity changes invalidate the selection revision", async () => {
  const { root, registry, catalog } = await fixture();
  const input = { projectRoot: root, registry, catalog, authorities: [], managed: true };
  const before = await buildCurrentIndexerProviderSelectionRoute(input);
  const after = await buildCurrentIndexerProviderSelectionRoute({ ...input,
    catalog: { ...catalog, version: `${catalog.version}-changed` } });
  expect(after.revision).not.toBe(before.revision);
});

test("stale selection is rejected before any registry write", async () => {
  const { root, registry, semantic } = await fixture();
  const empty = { ...registry, indexers: [] };
  const original = YAML.stringify(empty);
  await writeFile(join(root, "src/indexers.yaml"), original);
  await expect(completeCurrentIndexerAction({ cwd: root,
    revision: `sha256:${"0".repeat(64)}`, value: semantic, managed: true,
  })).rejects.toThrow();
  expect(await readFile(join(root, "src/indexers.yaml"), "utf8")).toBe(original);
});
