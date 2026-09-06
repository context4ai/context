import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseIndexerProviderManifest } from "@c4a/context";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";
import { projectIndexerSelectionCatalog } from "../project/indexerProviderSelectionCatalog.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test("selection capabilities and exact guidance come from each bundled manifest", async () => {
  const catalog = await listCliBundledIndexers();
  const selection = await projectIndexerSelectionCatalog(catalog);
  expect(selection.length).toBe(catalog.bundles.length);
  expect(selection.length).toBeGreaterThan(0);
  for (const [index, entry] of selection.entries()) {
    const { capabilities, guidance, ...identity } = entry;
    expect(identity).toEqual(catalog.bundles[index]!);
    const manifest = parseIndexerProviderManifest(await readFile(guidance.manifest_path, "utf8"));
    expect(capabilities.profiles).toEqual(manifest.provides.profiles);
    expect(capabilities.domains).toEqual(manifest.domains);
    expect(capabilities.target_kinds).toEqual(manifest.activation.target_kinds);
    expect(capabilities.operations).toEqual(manifest.provides.operations.map((operation) => operation.id));
    expect(capabilities.composers).toEqual((manifest.provides.composers ?? []).map((composer) => ({
      id: composer.id, supported_profiles: composer.supported_profiles,
    })));
    expect(capabilities.extensions.map((extension) => extension.profile))
      .toEqual((manifest.composition?.extensions ?? []).map((extension) => extension.profile));
    expect(await readFile(guidance.skill_path, "utf8")).toContain(manifest.id);
  }
});

test("selection cannot silently mix a catalog with another bundled manifest", async () => {
  const catalog = await listCliBundledIndexers();
  const [selected] = await projectIndexerSelectionCatalog(catalog);
  const bundle = catalog.bundles[0]!;
  const content = await readFile(selected!.guidance.manifest_path, "utf8");
  const root = await mkdtemp(join(tmpdir(), "context-provider-selection-"));
  roots.push(root);
  const bundleRoot = join(root, "bundles", bundle.skill);
  await mkdir(bundleRoot, { recursive: true });
  await writeFile(join(bundleRoot, "context-indexer.yaml"), `${content}\n# changed\n`);
  await expect(projectIndexerSelectionCatalog({ ...catalog, bundles: [bundle] }, root))
    .rejects.toThrow("selection manifest changed");
  const manifestDigest = `sha256:${createHash("sha256").update(`${content}\n# changed\n`).digest("hex")}`;
  await expect(projectIndexerSelectionCatalog({
    ...catalog, bundles: [{ ...bundle, manifest_digest: manifestDigest, version: "999.0.0" }],
  }, root)).rejects.toThrow("selection identity mismatch");
});
