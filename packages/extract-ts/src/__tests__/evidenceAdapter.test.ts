import { describe, expect, test } from "bun:test";
import { indexerEvidenceAdapterProtocolDigest, PackageKind } from "@c4a/core";
import {
  TypeScriptPlugin,
  typeScriptExtractionToEvidenceAdapterMaterialization,
  typeScriptExtractionToEvidenceAdapterResult,
} from "../index.js";
import { getFixtureFs } from "./testUtils.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

describe("TypeScript Evidence ABI", () => {
  test("publishes JS/JSX/ESM/CJS files through the common primary-owner ABI", async () => {
    const fs = getFixtureFs("ecmascript-project");
    const plugin = new TypeScriptPlugin();
    const manifest = {
      type: "package.json" as const,
      path: "package.json",
      content: await fs.readJson<Record<string, unknown>>("package.json"),
    };
    const entries = await plugin.detectEntries(manifest, fs);
    const extraction = await plugin.extractSymbols(entries.entries, fs);
    const materialized = typeScriptExtractionToEvidenceAdapterMaterialization(extraction, {
      adapter: {
        id: "extract-ts",
        package: "@c4a/extract-ts",
        export: "typeScriptExtractionToEvidenceAdapterResult",
        version: "0.7.0",
        digest: DIGEST_A,
      },
      authorized_scope: {
        source_ref: "repo:ecmascript-project",
        module_refs: ["module:web"],
        scope_digest: DIGEST_B,
      },
      module_ref: "module:web",
      input_digest: DIGEST_B,
      precedence: 100,
    });
    const result = materialized.result;

    expect(result.protocol).toBe("context.indexer.evidence-adapter-result/v1");
    expect(result.files).toHaveLength(extraction.coverage?.files.length ?? 0);
    expect(result.files.find((file) => file.normalized_path === "src/unsupported.cjs")).toMatchObject({
      role: "primary-owner",
      coverage_tier: "ast-catalog",
      disposition: "unsupported",
      facts: [],
    });
    expect(result.files
      .filter((file) => file.disposition === "analyzed")
      .flatMap((file) => file.facts)
      .some((fact) => fact.denominator === "symbol")).toBe(true);
    expect(materialized.fact_payloads.length).toBeGreaterThan(0);
    expect(materialized.fact_payloads.every((item) => {
      const descriptor = result.files.flatMap((file) => file.facts)
        .find((fact) => fact.fact_ref === item.fact_ref);
      return descriptor?.payload_digest === indexerEvidenceAdapterProtocolDigest(item.payload);
    })).toBe(true);
  });

  test("rejects extraction output owned by another parser", () => {
    expect(() => typeScriptExtractionToEvidenceAdapterResult({
      version: "2",
      meta: {
        extractedAt: "2026-08-28T00:00:00.000Z",
        pluginId: "other-parser",
        commitHash: null,
        language: "typescript",
      },
      package: { name: "sample", kind: PackageKind.Lib, language: "typescript" },
      files: [],
      symbols: [],
      relations: [],
      coverage: {
        tier: "ast-catalog",
        capabilities: ["parser.typescript"],
        files: [],
        diagnostics: [],
      },
      stats: { files: 0, lines: 0, exportedSymbols: 0, internalSymbols: 0, relations: 0 },
    }, {
      adapter: {
        id: "extract-ts",
        package: "@c4a/extract-ts",
        export: "typeScriptExtractionToEvidenceAdapterResult",
        version: "0.7.0",
        digest: DIGEST_A,
      },
      authorized_scope: {
        source_ref: "repo:sample",
        module_refs: [],
        scope_digest: DIGEST_B,
      },
      module_ref: null,
      input_digest: DIGEST_B,
      precedence: 100,
    })).toThrow(/requires c4a-extract-ts output/);
  });
});
