import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  indexRushWorkspace,
  rushWorkspaceIndexToEvidenceAdapterMaterialization,
  rushWorkspaceIndexToEvidenceAdapterResult,
} from "../index.js";
import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import { validateIndexerEvidenceAdapterResult } from "../../../context/src/indexerEvidenceAdapterResult.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

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

    const materialized = rushWorkspaceIndexToEvidenceAdapterMaterialization(result, {
      adapter: {
        id: "extract-rush",
        package: "@c4a/extract-rush",
        export: "rushWorkspaceIndexToEvidenceAdapterResult",
        version: "0.7.0",
        digest: DIGEST_A,
      },
      authorized_scope: {
        source_ref: "repo:rush-workspace",
        module_refs: ["module:app", "module:lib"],
        scope_digest: DIGEST_B,
      },
      input_digest: DIGEST_B,
      precedence: 100,
      workspace_module_ref: null,
      project_module_refs: {
        "packages/app": "module:app",
        "packages/lib": "module:lib",
      },
    });
    const evidence = materialized.result;
    expect(validateIndexerEvidenceAdapterResult(evidence)).toEqual(evidence);
    expect(evidence.files.map((file) => file.normalized_path).sort()).toEqual([
      "OWNERS",
      "packages/app/package.json",
      "packages/lib/package.json",
      "rush.json",
    ]);
    expect(evidence.files.flatMap((file) => file.facts).filter((fact) =>
      fact.denominator === "eligible-file"
    )).toHaveLength(4);
    expect(materialized.fact_payloads.length).toBeGreaterThan(0);
    expect(materialized.fact_payloads.every((item) => {
      const descriptor = evidence.files.flatMap((file) => file.facts)
        .find((fact) => fact.fact_ref === item.fact_ref);
      return descriptor?.payload_digest === indexerEvidenceAdapterProtocolDigest(item.payload);
    })).toBe(true);
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
      releaseUnitRef: "project:@sample/console",
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
    expect(result.releaseUnits).toEqual([expect.objectContaining({
      unitRef: "project:@sample/console",
      mode: "standalone",
      projectNames: ["@sample/console"],
    })]);
    expect(result.ownerBoundaries.map((boundary) => boundary.file)).toEqual(["apps/console/OWNERS", "OWNERS"]);
  });

  test("supports include-all and keeps missing or mismatched package manifests observable", async () => {
    root = await mkdtemp(join(tmpdir(), "extract-rush-missing-"));
    await mkdir(join(root, "packages", "mismatch"), { recursive: true });
    await mkdir(join(root, "packages", "missing"), { recursive: true });
    await writeFile(join(root, "rush.json"), JSON.stringify({ rushVersion: "5.120.0", projects: [
      { packageName: "@sample/mismatch", projectFolder: "packages/mismatch", tags: ["one"], versionPolicyName: "missing-policy" },
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
      releaseUnitRef: null,
    });
    expect(all.diagnostics).toEqual([{
      code: "rush-version-policy-unresolved",
      projectName: "@sample/mismatch",
      value: "missing-policy",
    }]);

    const evidence = rushWorkspaceIndexToEvidenceAdapterResult(all, {
      adapter: {
        id: "extract-rush",
        package: "@c4a/extract-rush",
        export: "rushWorkspaceIndexToEvidenceAdapterResult",
        version: "0.7.0",
        digest: DIGEST_A,
      },
      authorized_scope: {
        source_ref: "repo:rush-missing",
        module_refs: [],
        scope_digest: DIGEST_B,
      },
      input_digest: DIGEST_B,
      precedence: 100,
      workspace_module_ref: null,
      project_module_refs: {},
    });
    expect(evidence.diagnostics.map((diagnostic) => diagnostic.code).sort()).toEqual([
      "rush-package-manifest-missing",
      "rush-package-name-mismatch",
      "rush-version-policy-unresolved",
    ]);
  });

  test("indexes registered subspaces, reverse dependencies, build phases, and release units", async () => {
    root = await mkdtemp(join(tmpdir(), "extract-rush-topology-"));
    for (const folder of ["apps/portal", "packages/runtime", "tools/release"]) {
      await mkdir(join(root, folder), { recursive: true });
    }
    await mkdir(join(root, "common/config/rush"), { recursive: true });
    await writeFile(join(root, "rush.json"), JSON.stringify({
      rushVersion: "5.122.0",
      pnpmVersion: "9.15.0",
      projects: [{
        packageName: "@sample/portal",
        projectFolder: "apps/portal",
        subspaceName: "web",
        versionPolicyName: "suite",
        publishFolder: "dist/publish",
      }, {
        packageName: "@sample/runtime",
        projectFolder: "packages/runtime",
        subspaceName: "web",
        versionPolicyName: "suite",
      }, {
        packageName: "@sample/release-tool",
        projectFolder: "tools/release",
        subspaceName: "unregistered-tools",
        versionPolicyName: "tools",
      }],
    }));
    await writeFile(
      join(root, "common/config/rush/subspaces.json"),
      JSON.stringify({
        subspacesEnabled: true,
        preventSelectingAllSubspaces: true,
        subspaceNames: ["default", "web"],
      }),
    );
    await writeFile(
      join(root, "common/config/rush/command-line.json"),
      JSON.stringify({
        phases: [{
          name: "_phase:build",
          dependencies: { upstream: ["_phase:build"] },
          ignoreMissingScript: false,
        }, {
          name: "_phase:test",
          dependencies: { self: ["_phase:build"] },
          ignoreMissingScript: true,
        }],
        commands: [{
          commandKind: "phased",
          name: "build",
          phases: ["_phase:build"],
          enableParallelism: true,
          incremental: true,
        }, {
          commandKind: "global",
          name: "release",
          shellCommand: "node common/scripts/publish-with-private-token.js",
        }],
      }),
    );
    await writeFile(
      join(root, "common/config/rush/version-policies.json"),
      JSON.stringify([{
        definitionName: "lockStepVersion",
        policyName: "suite",
        mainProject: "@sample/portal",
      }, {
        definitionName: "individualVersion",
        policyName: "tools",
      }]),
    );
    await writeFile(join(root, "apps/portal/package.json"), JSON.stringify({
      name: "@sample/portal",
      dependencies: { "@sample/runtime": "workspace:*" },
      scripts: {
        "_phase:build": "portal-build --credential private-build-token",
        "_phase:test": "portal-test",
      },
    }));
    await writeFile(join(root, "packages/runtime/package.json"), JSON.stringify({
      name: "@sample/runtime",
      scripts: { "_phase:build": "runtime-build" },
    }));
    await writeFile(join(root, "tools/release/package.json"), JSON.stringify({
      name: "@sample/release-tool",
      scripts: { "_phase:build": "tool-build" },
    }));

    const result = await indexRushWorkspace(root);
    expect(result).toMatchObject({
      subspacesFile: "common/config/rush/subspaces.json",
      subspacesEnabled: true,
      preventSelectingAllSubspaces: true,
      commandLineFile: "common/config/rush/command-line.json",
      versionPoliciesFile: "common/config/rush/version-policies.json",
    });
    expect(result.subspaces).toEqual([{
      name: "default",
      registered: true,
      projectNames: [],
    }, {
      name: "unregistered-tools",
      registered: false,
      projectNames: ["@sample/release-tool"],
    }, {
      name: "web",
      registered: true,
      projectNames: ["@sample/portal", "@sample/runtime"],
    }]);
    expect(result.projects.find((project) => project.packageName === "@sample/runtime"))
      .toMatchObject({
        workspaceDependents: ["@sample/portal"],
        releaseUnitRef: "policy:suite",
      });
    expect(result.projects.find((project) => project.packageName === "@sample/portal"))
      .toMatchObject({
        publishFolder: "dist/publish",
        releaseUnitRef: "policy:suite",
      });
    const buildPhase = result.buildPhases.find((phase) => phase.name === "_phase:build");
    expect(buildPhase?.upstreamDependencies).toEqual(["_phase:build"]);
    expect(buildPhase?.projectImplementations.some((implementation) =>
      implementation.packageName === "@sample/portal" &&
      implementation.scriptDefined &&
      implementation.scriptDigest?.startsWith("sha256:") === true
    )).toBe(true);
    const releaseCommand = result.buildCommands.find((command) => command.name === "release");
    expect(releaseCommand?.commandKind).toBe("global");
    expect(releaseCommand?.usesShellCommand).toBe(true);
    expect(releaseCommand?.shellCommandDigest?.startsWith("sha256:")).toBe(true);
    expect(result.releaseUnits).toEqual([{
      unitRef: "policy:suite",
      mode: "lock-step",
      policyName: "suite",
      definitionName: "lockStepVersion",
      mainProject: "@sample/portal",
      projectNames: ["@sample/portal", "@sample/runtime"],
    }, {
      unitRef: "project:@sample/release-tool",
      mode: "individual",
      policyName: "tools",
      definitionName: "individualVersion",
      mainProject: null,
      projectNames: ["@sample/release-tool"],
    }]);
    expect(result.diagnostics).toEqual([{
      code: "rush-subspace-unregistered",
      projectName: "@sample/release-tool",
      value: "unregistered-tools",
    }]);

    const evidence = rushWorkspaceIndexToEvidenceAdapterResult(result, {
      adapter: {
        id: "extract-rush",
        package: "@c4a/extract-rush",
        export: "rushWorkspaceIndexToEvidenceAdapterResult",
        version: "0.7.0",
        digest: DIGEST_A,
      },
      authorized_scope: {
        source_ref: "repo:rush-topology",
        module_refs: ["module:portal", "module:runtime", "module:release-tool"],
        scope_digest: DIGEST_B,
      },
      input_digest: DIGEST_B,
      precedence: 100,
      workspace_module_ref: null,
      project_module_refs: {
        "apps/portal": "module:portal",
        "packages/runtime": "module:runtime",
        "tools/release": "module:release-tool",
      },
    });
    expect(validateIndexerEvidenceAdapterResult(evidence)).toEqual(evidence);
    const factKinds = new Set(evidence.files.flatMap((file) =>
      file.facts.map((fact) => fact.kind)
    ));
    expect([...factKinds]).toEqual(expect.arrayContaining([
      "rush-build-command",
      "rush-build-phase",
      "rush-release-unit",
      "rush-subspace",
      "rush-workspace-dependency",
      "rush-workspace-dependent",
    ]));
    expect(JSON.stringify(evidence)).not.toContain("private-build-token");
    expect(JSON.stringify(evidence)).not.toContain("publish-with-private-token");
  });
});
