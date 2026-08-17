import { EdgeSource, EdgeType, Grounding, PackageKind, SymbolKind, Visibility } from "@c4a/core";
import { describe, expect, test } from "bun:test";
import {
  buildCodeSnapshot,
  buildDigestData,
  buildHashId,
  buildPackageHashId,
  buildSourceFileHashId,
  flattenSymbols,
  stableStringify,
} from "../codeSnapshot.js";
import type { RepositoryExtractionModuleResult } from "../repository.js";
import type { ExtractionResult } from "../types.js";

const TEST_TOOLCHAIN = {
  manager_package: "@c4a/context-cli",
  manager_version: "0.5.29-beta.11",
  runner_package: "@c4a/extract",
  runner_package_version: "0.5.29-beta.11",
  runner_bin: "c4a-extract-code",
  plugin_package: "@c4a/extract-ts",
  plugin_package_version: "0.5.29-beta.11",
  plugin_export: "TypeScriptPlugin",
};

const extraction = (commitHash: string | null = "abc123"): ExtractionResult => ({
  version: "2",
  meta: {
    extractedAt: "2026-05-07T00:00:00.000Z",
    pluginId: "fixture",
    commitHash,
    language: "typescript",
  },
  package: {
    name: "@fixture/ui",
    kind: PackageKind.Lib,
    language: "typescript",
    version: "1.2.3",
  },
  files: [{ path: "packages/ui/src/Button.ts", language: "typescript", lines: 12 }],
  symbols: [{
    name: "Button",
    kind: SymbolKind.Component,
    visibility: Visibility.Exported,
    file: "packages/ui/src/Button.ts",
    line: 1,
    endLine: 10,
    members: [{
      name: "ButtonProps",
      kind: SymbolKind.Type,
      visibility: Visibility.Exported,
      file: "packages/ui/src/Button.ts",
      line: 11,
      endLine: 12,
    }],
  }],
  relations: [{
    type: EdgeType.Imports,
    from: "packages/ui/src/Button.ts",
    to: "react",
    isExternal: true,
    grounding: Grounding.Code,
    confidence: 1,
    source: EdgeSource.Ast,
    line: 1,
  }],
  stats: { files: 1, lines: 12, exportedSymbols: 2, internalSymbols: 0, relations: 1 },
});

const moduleResult = (): RepositoryExtractionModuleResult => ({
  module: {
    name: "@fixture/ui",
    path: "packages/ui",
    files: ["packages/ui/src/Button.ts"],
    fileCount: 1,
    totalLines: 12,
  },
  sourceInfo: {
    path: "packages/ui",
    manifests: [{
      type: "package.json",
      path: "package.json",
      content: { name: "@fixture/ui", description: "Fixture UI package" },
    }],
    language: "typescript",
  },
  entryDetection: {
    package: { name: "@fixture/ui", kind: PackageKind.Lib, language: "typescript", version: "1.2.3" },
    entries: [{ path: "packages/ui/src/Button.ts", subpath: "src/Button.ts", type: "library" }],
  },
  moduleDoc: "UI package module docs.",
  extraction: extraction(),
});

const moduleResultForSort = (
  modulePath: string,
  packageName: string,
  symbolName: string,
): RepositoryExtractionModuleResult => {
  const file = `${modulePath}/src/${symbolName}.ts`;
  const baseExtraction = extraction();
  return {
    module: {
      name: packageName,
      path: modulePath,
      files: [file],
      fileCount: 1,
      totalLines: 12,
    },
    sourceInfo: {
      path: modulePath,
      manifests: [{
        type: "package.json",
        path: "package.json",
        content: { name: packageName, description: `${symbolName} package` },
      }],
      language: "typescript",
    },
    entryDetection: {
      package: { name: packageName, kind: PackageKind.Lib, language: "typescript", version: "1.2.3" },
      entries: [{ path: file, subpath: `src/${symbolName}.ts`, type: "library" }],
    },
    moduleDoc: `${symbolName} docs.`,
    extraction: {
      ...baseExtraction,
      package: { ...baseExtraction.package, name: packageName },
      files: [{ path: file, language: "typescript", lines: 12 }],
      symbols: [{
        name: symbolName,
        kind: SymbolKind.Component,
        visibility: Visibility.Exported,
        file,
        line: 1,
        endLine: 10,
      }],
      relations: [{
        ...baseExtraction.relations[0]!,
        from: file,
        to: `${packageName}/dependency`,
      }],
      stats: { files: 1, lines: 12, exportedSymbols: 1, internalSymbols: 0, relations: 1 },
    },
  };
};

describe("code snapshot helpers", () => {
  test("flattens nested members into symbol rows with package metadata", () => {
    const rows = flattenSymbols(extraction().symbols, "@fixture/ui", "packages/ui");
    expect(rows.map((row) => row.name)).toEqual(["Button", "ButtonProps"]);
    expect(rows.every((row) => row.package === "@fixture/ui")).toBe(true);
    expect(rows.every((row) => row.package_name === "@fixture/ui")).toBe(true);
    expect(rows.map((row) => row.symbol_id)).toEqual(["Button", "ButtonProps"]);
    expect(rows.every((row) => row.modulePath === "packages/ui")).toBe(true);
    expect(rows.every((row) => row.module_path === "packages/ui")).toBe(true);
  });

  test("dirty digest hash includes module content hash while keeping dir_commit", () => {
    const clean = buildDigestData({
      moduleName: "@fixture/ui",
      modulePath: "packages/ui",
      extraction: extraction(),
      dirCommit: "abc123",
    });
    const dirty = buildDigestData({
      moduleName: "@fixture/ui",
      modulePath: "packages/ui",
      extraction: extraction(),
      dirCommit: "abc123",
      dirty: true,
    });

    expect(clean.dir_commit).toBe("abc123");
    expect(dirty.dir_commit).toBe("abc123");
    expect(clean.version_label).toBe("1.2.3");
    expect(clean.version_source).toBe("package-json");
    expect(clean.module_content_hash).toBe(dirty.module_content_hash);
    expect(clean.hash_id).not.toBe(dirty.hash_id);
    expect(buildHashId("@fixture/ui", "abc123")).toBe(clean.hash_id);
  });

  test("builds a complete raw code snapshot payload", () => {
    const snapshot = buildCodeSnapshot({
      sourceId: "aspect:code:demo-ui",
      sourceSlug: "code-demo-ui",
      snapshotId: "code-demo-ui@2026-05-07",
      repoPath: "/repo",
      sourceCommit: "repo123",
      codeSnapshotContractVersion: "0.5.29-beta.9",
      scriptHash: "sha256:script",
      toolchain: TEST_TOOLCHAIN,
      results: [moduleResult()],
    });

    expect(Object.keys(snapshot.files).sort()).toEqual([
      "_meta.yaml",
      "digests.jsonl",
      "edges.jsonl",
      "manifest.json",
      "packages.jsonl",
      "source-files.jsonl",
      "source.yaml",
      "symbols.jsonl",
    ]);
    expect(snapshot.manifest.module_count).toBe(1);
    expect(snapshot.manifest.symbol_count).toBe(2);
    expect(snapshot.manifest.edge_count).toBe(1);
    expect(snapshot.manifest.head_commit).toBe("repo123");
    expect(snapshot.manifest.dirty).toBe(false);
    expect(snapshot.manifest.code_snapshot_contract_version).toBe("0.5.29-beta.9");
    expect(snapshot.manifest).not.toHaveProperty("capture_code_version");
    expect(snapshot.manifest.toolchain).toEqual(TEST_TOOLCHAIN);
    expect(snapshot.source.toolchain).toEqual(TEST_TOOLCHAIN);
    expect(snapshot.manifest.snapshot_content_hash).toMatch(/^sha256:/);
    expect(snapshot.source.snapshot_content_hash).toBe(snapshot.manifest.snapshot_content_hash);
    expect(snapshot.rows.sourceFiles[0]!.hash_id).toBe(buildSourceFileHashId("@fixture/ui", "repo123"));
    expect(snapshot.rows.sourceFiles[0]!.digest_hash_id).toBe(snapshot.rows.digests[0]!.hash_id);
    expect(snapshot.rows.sourceFiles[0]!.hash_id).not.toBe(snapshot.rows.digests[0]!.hash_id);
    expect(snapshot.rows.digests[0]!.version_label).toBe("1.2.3");
    expect(snapshot.rows.digests[0]!.version_source).toBe("package-json");
    expect(snapshot.rows.digests[0]!.doc).toBe("UI package module docs.");
    expect(snapshot.rows.packages[0]).toMatchObject({
      name: "@fixture/ui",
      hash_id: buildPackageHashId("@fixture/ui", "packages/ui", "1.2.3", "Fixture UI package"),
      description: "Fixture UI package",
    });
    expect(snapshot.rows.symbols[0]).toMatchObject({
      package_name: "@fixture/ui",
      symbol_id: "Button",
      module_path: "packages/ui",
    });
    expect(snapshot.rows.edges[0]).toMatchObject({
      package_name: "@fixture/ui",
      module_path: "packages/ui",
      version_label: "1.2.3",
      hash_id: expect.stringMatching(/^sha256:/),
    });

    const meta = JSON.parse(snapshot.files["_meta.yaml"]!) as {
      schema_version?: string;
      aspect?: string;
      content_hash?: string;
      head_commit?: string | null;
      dirty?: boolean;
      code_snapshot_contract_version?: string;
      toolchain?: typeof TEST_TOOLCHAIN;
      inputs?: Array<{
        dir_commit?: string;
        module_content_hash?: string;
        dirty?: boolean;
        version_label?: string;
        version_source?: string;
      }>;
    };
    expect(meta.schema_version).toBe("code.snapshot.meta.v2");
    expect(meta.aspect).toBe("code");
    expect(meta.content_hash).toBe(snapshot.manifest.snapshot_content_hash);
    expect(meta.code_snapshot_contract_version).toBe("0.5.29-beta.9");
    expect(meta.toolchain).toEqual(TEST_TOOLCHAIN);
    expect(meta.head_commit).toBe("repo123");
    expect(meta.dirty).toBe(false);
    expect(meta.inputs?.length).toBe(1);
    expect(meta.inputs?.[0]?.dir_commit).toBe("abc123");
    expect(meta.inputs?.[0]?.module_content_hash).toMatch(/^sha256:/);
    expect(meta.inputs?.[0]?.dirty).toBe(false);
    expect(meta.inputs?.[0]?.version_label).toBe("1.2.3");
    expect(meta.inputs?.[0]?.version_source).toBe("package-json");
    expect(snapshot.files["manifest.json"]).toContain(`"total_bytes": ${snapshot.manifest.total_bytes}`);
  });

  test("stableStringify preserves non-plain objects deterministically", () => {
    const value = {
      at: new Date("2026-05-07T00:00:00.000Z"),
      set: new Set(["b", "a"]),
      map: new Map([["z", 1], ["a", 2]]),
      pattern: /abc/u,
    };

    expect(stableStringify(value)).toContain("2026-05-07T00:00:00.000Z");
    expect(stableStringify(value)).toContain('"$set"');
    expect(stableStringify(value)).toContain('"$map"');
    expect(stableStringify(value)).toContain("/abc/u");
  });

  test("sorts raw row output deterministically across capture result order", () => {
    const button = moduleResultForSort("packages/button", "@fixture/button", "Button");
    const cards = moduleResultForSort("packages/cards", "@fixture/cards", "Card");
    const build = (results: RepositoryExtractionModuleResult[]) =>
      buildCodeSnapshot({
        sourceId: "aspect:code:demo-ui",
        sourceSlug: "code-demo-ui",
        snapshotId: "code-demo-ui@2026-05-07",
        repoPath: "/repo",
        sourceCommit: "repo123",
        capturedAt: "2026-05-07T00:00:00.000Z",
        codeSnapshotContractVersion: "0.5.29-beta.9",
        scriptHash: "sha256:script",
        toolchain: TEST_TOOLCHAIN,
        results,
      });

    const first = build([cards, button]);
    const second = build([button, cards]);
    for (const fileName of ["packages.jsonl", "symbols.jsonl", "edges.jsonl", "digests.jsonl"]) {
      expect(first.files[fileName]).toBe(second.files[fileName]);
    }
    expect(first.manifest.snapshot_content_hash).toBe(second.manifest.snapshot_content_hash);
  });

  test("sorts duplicate edge tuples by stable tie-breakers", () => {
    const result = moduleResult();
    const edge = result.extraction.relations[0]!;
    result.extraction.relations = [
      { ...edge, line: 20 },
      { ...edge, line: 1 },
    ];

    const snapshot = buildCodeSnapshot({
      sourceId: "aspect:code:demo-ui",
      sourceSlug: "code-demo-ui",
      snapshotId: "code-demo-ui@2026-05-07",
      repoPath: "/repo",
      sourceCommit: "repo123",
      capturedAt: "2026-05-07T00:00:00.000Z",
      codeSnapshotContractVersion: "0.5.29-beta.9",
      scriptHash: "sha256:script",
      toolchain: TEST_TOOLCHAIN,
      results: [result],
    });

    expect(snapshot.rows.edges.map((row) => row.line)).toEqual([1, 20]);
  });

  test("missing version labels fall back to beta.9 SemVer placeholder", () => {
    const snapshot = buildCodeSnapshot({
      sourceId: "aspect:code:demo-ui",
      sourceSlug: "code-demo-ui",
      snapshotId: "code-demo-ui@2026-05-07",
      repoPath: "/repo",
      sourceCommit: "repo123",
      codeSnapshotContractVersion: "0.5.29-beta.9",
      scriptHash: "sha256:script",
      toolchain: TEST_TOOLCHAIN,
      versionPolicy: "none",
      versionLabels: { "packages/ui": null },
      results: [moduleResult()],
    });

    expect(snapshot.source.version_policy).toBe("none");
    expect(snapshot.source.version_label).toBe("0.0.1");
    expect(snapshot.source.version_source).toBe("fallback-0.0.1");
    expect(snapshot.rows.digests[0]!.version_label).toBe("0.0.1");
    expect(snapshot.rows.digests[0]!.version_source).toBe("fallback-0.0.1");
    expect(snapshot.rows.sourceFiles[0]!.version_label).toBe("0.0.1");
    expect(snapshot.rows.sourceFiles[0]!.version_source).toBe("fallback-0.0.1");
  });
});
