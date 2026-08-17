import { EdgeSource, EdgeType, PackageKind, SymbolKind, Visibility } from "@c4a/core";
import { describe, expect, test } from "bun:test";
import { extractionResultSchema } from "../types.js";

const baseResult = {
  version: "2" as const,
  meta: {
    extractedAt: new Date().toISOString(),
    pluginId: "c4a-extract-ts",
    commitHash: null,
    language: "typescript",
  },
  package: {
    name: "@c4a/extract",
    kind: PackageKind.Lib,
    language: "typescript",
  },
  files: [
    {
      path: "src/index.ts",
      language: "typescript",
      lines: 24,
    },
  ],
  symbols: [
    {
      name: "run",
      kind: SymbolKind.Function,
      visibility: Visibility.Exported,
      file: "src/index.ts",
      line: 1,
      endLine: 3,
      params: [{ name: "value", type: "string" }],
      returnType: "void",
    },
    {
      name: "Options",
      kind: SymbolKind.Type,
      visibility: Visibility.Internal,
      file: "src/internal.ts",
      line: 1,
      endLine: 4,
      typeAnnotation: "{ dryRun: boolean }",
    },
  ],
  relations: [
    {
      type: EdgeType.Imports,
      from: "src/index.ts",
      to: "./internal",
      isExternal: false,
      grounding: "code" as const,
      confidence: 1,
      source: EdgeSource.Ast,
      line: 1,
    },
  ],
  stats: {
    files: 1,
    lines: 24,
    exportedSymbols: 1,
    internalSymbols: 1,
    relations: 1,
  },
};

describe("extractionResultSchema", () => {
  test("accepts a valid v2 extraction result", () => {
    const result = extractionResultSchema.safeParse(baseResult);
    expect(result.success).toBe(true);
  });

  test("rejects legacy v1 extraction result fields", () => {
    const legacy = {
      version: "1",
      extractedAt: new Date().toISOString(),
      repoPath: "/repo",
      classes: [],
      functions: [],
      relations: { imports: [], inheritance: [], calls: [] },
    };

    const result = extractionResultSchema.safeParse(legacy);
    expect(result.success).toBe(false);
  });

  test("requires symbol required fields", () => {
    const invalid = structuredClone(baseResult);
    delete (invalid.symbols[0] as { endLine?: number }).endLine;

    const result = extractionResultSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
