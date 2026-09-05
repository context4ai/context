import { describe, expect, test } from "bun:test";
import { PackageKind, Visibility } from "@c4a/core";
import type { FileSystem } from "@c4a/extract";
import { extractionResultSchema } from "@c4a/extract";
import { TypeScriptPlugin } from "../plugin.js";
import { typeScriptExtractionToEvidenceAdapterMaterialization } from "../evidenceAdapter.js";

function scopedFs(files: Record<string, string>) {
  const reads: string[] = [];
  const fs: FileSystem = {
    async exists(path) { return Object.hasOwn(files, path); },
    async readdir() { throw new Error("source extraction must not scan directories"); },
    async readFile(path) {
      reads.push(path);
      if (!Object.hasOwn(files, path)) throw new Error(`untracked source: ${path}`);
      return files[path]!;
    },
    async readJson<T>(path: string): Promise<T> {
      return JSON.parse(await fs.readFile(path)) as T;
    },
  };
  return { fs, reads };
}

describe("manifest-free TypeScript/JavaScript source scopes", () => {
  test.each(["\n", "\r\n"])("keeps physical source extent separate from non-empty LOC (%j)", async (newline) => {
    const source = ["export const start = 1;", "", "", "export const tail = 2;", ""].join(newline);
    const files = { "index.ts": source };
    const extraction = await new TypeScriptPlugin().extractSymbolsInScope([], ["index.ts"], scopedFs(files).fs);
    const digest = `sha256:${"a".repeat(64)}`;
    const materialized = typeScriptExtractionToEvidenceAdapterMaterialization(extraction, {
      adapter: { id: "parser.typescript", package: "@c4a/extract-ts", export: "typeScriptExtractionToEvidenceAdapterResult", version: "0.7.5", digest },
      authorized_scope: { source_ref: "repo:sample", module_refs: [], scope_digest: digest },
      module_ref: null, input_digest: digest, precedence: 100, source_files: files,
    });
    const facts = materialized.result.files[0]!.facts;
    const payload = (kind: string) => materialized.fact_payloads.find((item) =>
      item.fact_ref === facts.find((fact) => fact.kind === kind)?.fact_ref
    )?.payload;
    expect(payload("source-file")).toMatchObject({ lines: 2, line: 1, endLine: 5 });
    expect(payload("source-loc")).toEqual({ lines: 2 });
    expect(extraction.stats.lines).toBe(2);
    expect(JSON.stringify(materialized)).not.toContain(source);
  });

  test.each([
    ["widget.tsx", "export interface Props { label: string }\nexport const Widget = (props: Props) => <span>{props.label}</span>;", "typescript"],
    ["widget.jsx", "export const Widget = (props) => <span>{props.label}</span>;", "javascript"],
  ])("analyzes %s without a manifest or invented package exports", async (path, source, language) => {
    const { fs, reads } = scopedFs({ [path]: source });
    const result = await new TypeScriptPlugin().extractSymbolsInScope([], [path], fs);

    expect(extractionResultSchema.safeParse(result).success).toBe(true);
    expect(result.package).toEqual({ name: "unknown-package", kind: PackageKind.Lib, language });
    expect(result.files.map((file) => file.path)).toEqual([path]);
    expect(result.symbols.find((symbol) => symbol.name === "Widget"))
      .toMatchObject({ file: path, visibility: Visibility.Internal });
    expect(result.stats.exportedSymbols).toBe(0);
    expect(result.coverage?.files[0]?.disposition).toBe("analyzed");
    expect(new Set(reads)).toEqual(new Set([path]));
  });

  test("requires manifest detection for declared package entries", async () => {
    const { fs } = scopedFs({ "index.ts": "export const Widget = 1;" });
    await expect(new TypeScriptPlugin().extractSymbolsInScope(
      [{ path: "index.ts", subpath: ".", type: "library" }], ["index.ts"], fs,
    )).rejects.toThrow("requires detectEntries before using package entries");
  });
});
