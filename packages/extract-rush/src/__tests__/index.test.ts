import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { indexRushWorkspace } from "../index.js";

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("indexRushWorkspace", () => {
  test("indexes tags, subspaces, local dependencies, and owner boundaries", async () => {
    root = await mkdtemp(join(tmpdir(), "extract-rush-"));
    await mkdir(join(root, "packages", "app"), { recursive: true });
    await mkdir(join(root, "packages", "lib"), { recursive: true });
    await writeFile(join(root, "rush.json"), JSON.stringify({ rushVersion: "5.120.0", projects: [
      { packageName: "@sample/app", projectFolder: "packages/app", subspaceName: "web", tags: ["public"], decoupledLocalDependencies: ["@sample/lib"] },
      { packageName: "@sample/lib", projectFolder: "packages/lib", tags: ["public"] },
    ] }));
    await writeFile(join(root, "packages", "app", "package.json"), JSON.stringify({ name: "@sample/app", main: "dist/index.js", dependencies: { "@sample/lib": "workspace:*" } }));
    await writeFile(join(root, "packages", "lib", "package.json"), JSON.stringify({ name: "@sample/lib" }));
    await writeFile(join(root, "OWNERS"), "reviewers:\n  - maintainer\n");
    const result = await indexRushWorkspace(root, { tags: ["public"] });
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0]?.workspaceDependencies[0]).toEqual(expect.objectContaining({ packageName: "@sample/lib", decoupled: true }));
    expect(result.ownerBoundaries[0]?.reviewers).toEqual(["maintainer"]);
  });

  test("reports workspace identity, entry signals, dependency kinds, and the nearest owner boundary", async () => {
    root = await mkdtemp(join(tmpdir(), "extract-rush-contract-"));
    await mkdir(join(root, "apps", "console"), { recursive: true });
    await mkdir(join(root, "packages", "shared"), { recursive: true });
    await mkdir(join(root, "packages", "tools"), { recursive: true });
    await writeFile(join(root, "rush.json"), `{
      // JSONC is accepted by Rush.
      "rushVersion": "5.120.0",
      "pnpmVersion": "9.15.0",
      "nodeSupportedVersionRange": ">=20",
      "projects": [
        { "packageName": "@sample/console", "projectFolder": "apps/console", "subspaceName": "web", "tags": ["app", "public"], "shouldPublish": true, "decoupledLocalDependencies": ["@sample/shared"] },
        { "packageName": "@sample/shared", "projectFolder": "packages/shared", "tags": ["public"] },
        { "packageName": "@sample/tools", "projectFolder": "packages/tools", "tags": ["tooling"] }
      ]
    }`);
    await writeFile(join(root, "apps", "console", "package.json"), JSON.stringify({
      name: "@sample/console",
      main: "dist/index.cjs",
      module: "dist/index.mjs",
      types: "dist/index.d.ts",
      exports: { "./feature": "./dist/feature.js", ".": "./dist/index.js" },
      bin: { tools: "bin/tools.js", sample: "bin/sample.js" },
      dependencies: { "@sample/shared": "workspace:*" },
      peerDependencies: { "@sample/shared": ">=1" },
      devDependencies: { "@sample/tools": "workspace:*" },
    }));
    await writeFile(join(root, "packages", "shared", "package.json"), JSON.stringify({ name: "@sample/shared" }));
    await writeFile(join(root, "packages", "tools", "package.json"), JSON.stringify({ name: "@sample/tools" }));
    await writeFile(join(root, "OWNERS"), "reviewers:\n  - workspace-owner\n");
    await writeFile(join(root, "apps", "console", "OWNERS"), "reviewers:\n  - app-owner\n  - app-owner\n");

    const result = await indexRushWorkspace(root, { tags: ["public", "public"] });
    expect(result).toMatchObject({
      rushFile: "rush.json",
      rushVersion: "5.120.0",
      pnpmVersion: "9.15.0",
      nodeSupportedVersionRange: ">=20",
      selectedTags: ["public"],
    });
    expect(result.projects.map((project) => project.packageName)).toEqual(["@sample/console", "@sample/shared"]);
    const app = result.projects[0]!;
    expect(app).toMatchObject({
      packageNameMatches: true,
      projectFolder: "apps/console",
      subspaceName: "web",
      tags: ["app", "public"],
      shouldPublish: true,
      packageJsonFile: "apps/console/package.json",
      owner: { file: "apps/console/OWNERS", reviewers: ["app-owner"] },
    });
    expect(app.entrySignals).toEqual([
      "main=dist/index.cjs",
      "module=dist/index.mjs",
      "types=dist/index.d.ts",
      "exports=.,./feature",
      "bin=sample:bin/sample.js,tools:bin/tools.js",
    ]);
    expect(app.workspaceDependencies).toEqual([
      { packageName: "@sample/shared", kinds: ["dependency", "peer"], specifiers: ["workspace:*", ">=1"], decoupled: true },
      { packageName: "@sample/tools", kinds: ["dev"], specifiers: ["workspace:*"] , decoupled: false },
    ]);
    expect(result.ownerBoundaries.map((boundary) => boundary.file)).toEqual(["apps/console/OWNERS", "OWNERS"]);
  });

  test("supports include-all and keeps missing or mismatched package manifests observable", async () => {
    root = await mkdtemp(join(tmpdir(), "extract-rush-missing-"));
    await mkdir(join(root, "packages", "mismatch"), { recursive: true });
    await mkdir(join(root, "packages", "missing"), { recursive: true });
    await writeFile(join(root, "rush.json"), JSON.stringify({ rushVersion: "5.120.0", projects: [
      { packageName: "@sample/mismatch", projectFolder: "packages/mismatch", tags: ["one"] },
      { packageName: "@sample/missing", projectFolder: "packages/missing", tags: ["two"] },
    ] }));
    await writeFile(join(root, "packages", "mismatch", "package.json"), JSON.stringify({ name: "@sample/other", exports: "./index.js" }));

    const filtered = await indexRushWorkspace(root, { tags: ["two"] });
    expect(filtered.projects).toEqual([
      expect.objectContaining({ packageName: "@sample/missing", packageNameMatches: false, packageJsonFile: null, entrySignals: [] }),
    ]);

    const all = await indexRushWorkspace(root, { tags: ["does-not-match"], includeAll: true });
    expect(all.projects).toHaveLength(2);
    expect(all.projects.find((project) => project.packageName === "@sample/mismatch")).toMatchObject({
      packageNameMatches: false,
      entrySignals: ["exports=."],
    });
  });
});
