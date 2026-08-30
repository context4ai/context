import { EdgeSource, EdgeType, Grounding, PackageKind, SymbolKind, Visibility } from "@c4a/core";
import { describe, expect, test } from "bun:test";
import { generateDigest, generateSymbolDiff } from "../digest.js";
import type { DigestData, ExtractionResult } from "../types.js";

const baseExtractionResult = (): ExtractionResult => ({
  version: "2",
  meta: {
    extractedAt: "2026-04-08T00:00:00.000Z",
    pluginId: "c4a-extract-ts",
    commitHash: "abc123",
    language: "typescript",
  },
  package: {
    name: "@fixture/demo",
    kind: PackageKind.Lib,
    language: "typescript",
  },
  files: [
    {
      path: "src/index.ts",
      language: "typescript",
      lines: 20,
    },
  ],
  symbols: [
    {
      name: "Button",
      kind: SymbolKind.Component,
      visibility: Visibility.Exported,
      file: "src/index.ts",
      line: 1,
      endLine: 10,
    },
    {
      name: "ButtonProps",
      kind: SymbolKind.Type,
      visibility: Visibility.Internal,
      file: "src/index.ts",
      line: 12,
      endLine: 18,
    },
  ],
  relations: [
    {
      type: EdgeType.Imports,
      from: "src/index.ts",
      to: "react",
      isExternal: true,
      grounding: Grounding.Code,
      confidence: 1,
      source: EdgeSource.Ast,
      line: 1,
    },
  ],
  stats: {
    files: 1,
    lines: 20,
    exportedSymbols: 1,
    internalSymbols: 1,
    relations: 1,
  },
});

const createDigest = (exportedNames: string[]): DigestData => ({
  version: "2",
  meta: {
    extractedAt: "2026-04-08T00:00:00.000Z",
    pluginId: "c4a-extract-ts",
    commitHash: null,
    language: "typescript",
  },
  package: {
    name: "@fixture/demo",
    kind: PackageKind.Lib,
    language: "typescript",
  },
  files: [],
  symbols: exportedNames.map((name, index) => ({
    name,
    kind: SymbolKind.Function,
    visibility: Visibility.Exported,
    file: "src/index.ts",
    line: index + 1,
    endLine: index + 1,
  })),
  relations: [],
  stats: {
    files: 0,
    lines: 0,
    exported_count: exportedNames.length,
    internal_count: 0,
    relations: 0,
  },
});

describe("generateDigest", () => {
  test("partitions exported and internal symbols into separate digest sections", () => {
    const digest = generateDigest(baseExtractionResult());

    const exported = digest.symbols.filter((s) => s.visibility === "exported");
    const internal = digest.symbols.filter((s) => s.visibility !== "exported");
    expect(exported.map((s) => s.name)).toEqual(["Button"]);
    expect(internal.map((s) => s.name)).toEqual(["ButtonProps"]);
    expect(digest.stats).toEqual({
      files: 1,
      lines: 20,
      exported_count: 1,
      internal_count: 1,
      relations: 1,
    });
  });

  test("keeps parser coverage and degradation dispositions in the durable digest", () => {
    const extraction = baseExtractionResult();
    extraction.coverage = {
      tier: "ast-catalog",
      capabilities: ["typescript-ast"],
      files: [{ path: "src/index.ts", disposition: "analyzed", diagnosticCodes: [] }],
      diagnostics: [],
    };

    expect(generateDigest(extraction).coverage).toEqual(extraction.coverage);
  });
});

describe("generateSymbolDiff", () => {
  test("computes added and removed exported symbols", () => {
    const previous = createDigest(["Button", "Modal"]);
    const current = createDigest(["Button", "Drawer"]);

    expect(generateSymbolDiff(current, previous)).toEqual({
      added: ["Drawer"],
      removed: ["Modal"],
    });
  });

  test("treats all exported symbols as added when previous digest is null", () => {
    const current = createDigest(["Button", "Drawer"]);

    expect(generateSymbolDiff(current, null)).toEqual({
      added: ["Button", "Drawer"],
      removed: [],
    });
  });
});
