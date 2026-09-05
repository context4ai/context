import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";
import {
  buildIndexerProviderResolutionActionInput,
  type IndexerCliReleaseManifest,
  type IndexerProviderManifest,
} from "@c4a/context";
import { materializeBundledIndexerDistribution } from "../project/indexerDistributionBuild.js";
import { listCliBundledIndexers, resolveCliBundledIndexerProvider } from "../project/indexerCliBundledProvider.js";
import { dispatchIndexerProviderResolution } from "../project/indexerProviderDispatcher.js";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const SKILLS_ROOT = resolve(PACKAGE_ROOT, "../../plugins/context/skills");
const EXTRA_SKILL = "additional-code-indexer";
const NOW = new Date("2026-09-05T00:00:00.000Z");

describe("all shipped Providers use one CLI release catalog", () => {
  let root: string;
  let sourceRoot: string;
  let assetsRoot: string;
  let release: IndexerCliReleaseManifest;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "context-bundled-extension-"));
    sourceRoot = join(root, "skills");
    assetsRoot = join(root, "assets");
    await cp(SKILLS_ROOT, sourceRoot, { recursive: true });
    const extraRoot = join(sourceRoot, EXTRA_SKILL);
    await cp(join(SKILLS_ROOT, "context-code-indexer"), extraRoot, { recursive: true });
    const path = join(extraRoot, "context-indexer.yaml");
    const manifest = YAML.parse(await readFile(path, "utf8")) as IndexerProviderManifest;
    manifest.id = EXTRA_SKILL;
    await writeFile(path, YAML.stringify(manifest));
    const skillPath = join(extraRoot, "SKILL.md");
    await writeFile(skillPath, (await readFile(skillPath, "utf8"))
      .replace("name: context-code-indexer\n", `name: ${EXTRA_SKILL}\n`));
    release = await materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT, sourceRoot, outputRoot: assetsRoot,
    });
  }, 120_000);

  afterAll(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  function bundle() {
    const found = release.bundles.find((entry) => entry.skill === EXTRA_SKILL);
    if (found === undefined) throw new Error("additional shipped Provider is missing");
    return found;
  }

  function expected() {
    const entry = bundle();
    return {
      indexerId: "sample-indexer", providerId: "sample-provider",
      skill: entry.skill, version: entry.version, integrity: entry.integrity,
      distribution: entry.distribution,
    };
  }

  test("catalogs the additional Provider without modifying community source Skills", async () => {
    const catalog = await listCliBundledIndexers({ assetsRoot });
    expect(catalog.bundles.map((entry) => entry.skill)).toContain(EXTRA_SKILL);
    expect(catalog.bundles.every((entry) => entry.source_type === "cli-bundled")).toBe(true);
    const original = await listCliBundledIndexers();
    expect(original.bundles.map((entry) => entry.skill)).not.toContain(EXTRA_SKILL);
    expect(await readFile(join(assetsRoot, "bundles", EXTRA_SKILL, "SKILL.md"), "utf8"))
      .toBe(await readFile(join(sourceRoot, EXTRA_SKILL, "SKILL.md"), "utf8"));
  });

  test("loads its exact shipped bytes without any Host adapter", async () => {
    const entry = bundle();
    const request = buildIndexerProviderResolutionActionInput({
      protocol: "context.indexer.resolve-provider-input/v1",
      project_ref: "project:sample",
      selection_proposal_digest: `sha256:${"a".repeat(64)}`,
      static_report_digest: `sha256:${"b".repeat(64)}`,
      provider: {
        indexer_id: "sample-indexer", provider_id: "sample-provider",
        skill: entry.skill, version: entry.version, integrity: entry.integrity,
        distribution: entry.distribution,
      },
    });
    const result = await dispatchIndexerProviderResolution({
      assetsRoot, runtimeRoot: root, request, now: NOW,
    });
    expect(result).toMatchObject({ state: "resolved", resolver: "cli-bundled" });
    if (result.state !== "resolved") throw new Error("shipped Provider requested Host resolution");
    const resolved = result.output.envelope;
    expect(resolved.files).toEqual(bundle().files);
    expect(resolved.request.distribution.kind).toBe("cli-bundled");
    expect(await readFile(join(resolved.transport.path, "context-indexer.yaml"), "utf8"))
      .toBe(await readFile(join(sourceRoot, EXTRA_SKILL, "context-indexer.yaml"), "utf8"));
  });

  test("rejects missing or different-version identities rather than substituting a bundle", async () => {
    for (const change of [{ skill: "missing-provider" }, { version: "9.9.9" }]) {
      await expect(resolveCliBundledIndexerProvider({
        assetsRoot, expectedPackageVersion: release.version,
        expected: { ...expected(), ...change }, transportRoot: join(root, "transports"), now: NOW,
      })).rejects.toThrow("not present in this exact CLI release");
    }
  });

  test("rejects an additional directory whose manifest claims another Provider", async () => {
    const path = join(sourceRoot, EXTRA_SKILL, "context-indexer.yaml");
    const original = await readFile(path, "utf8");
    try {
      const manifest = YAML.parse(original) as IndexerProviderManifest;
      manifest.id = "another-provider";
      await writeFile(path, YAML.stringify(manifest));
      await expect(materializeBundledIndexerDistribution({
        packageRoot: PACKAGE_ROOT, sourceRoot, outputRoot: join(root, "invalid-assets"),
      })).rejects.toThrow("manifest id does not match its directory");
    } finally {
      await writeFile(path, original);
    }
  }, 120_000);
});
