import { expect, test } from "bun:test";
import { resolve } from "node:path";
import * as typeScript from "@c4a/extract-ts";
import type { ExtractionResult, FileSystem } from "@c4a/extract";
import { prepareCodeAnalysisInput } from "../project/codeAnalysisInput.js";

const root = resolve(".tmp/code-analysis-input-test");

test("selected TypeScript analysis preserves component defaults without an Indexer registry", async () => {
  const texts = {
    "package.json": JSON.stringify({ name: "component-example", exports: { ".": "./panel.tsx" } }),
    "panel.tsx": "export interface Props { enabled?: boolean; label?: string }\nexport const Panel = ({ enabled = true, label = 'ready' }: Props) => null;",
    "unrelated.ts": "export const unrelated = 42;",
  };
  const result = await prepareCodeAnalysisInput({ capability: "parser.typescript", root,
    sourceModule: "component-example", scopedPaths: ["panel.tsx"], trackedPaths: Object.keys(texts), texts,
    loadedModule: typeScript }) as ExtractionResult;
  const component = result.symbols.find(symbol => symbol.name === "Panel")!;
  expect(component).toBeDefined();
  expect(component.members?.find(member => member.name === "enabled")?.defaultValue).toBe("true");
  expect(component.members?.find(member => member.name === "label")?.defaultValue).toBe("'ready'");
  expect(result.symbols.some(symbol => symbol.name === "unrelated")).toBe(false);
});

test("code analysis cannot read a file outside its supplied tracked boundary", async () => {
  class Reader {
    async extractSymbolsInScope(_entries: unknown[], _paths: string[], fs: FileSystem) {
      return fs.readFile("../outside.ts");
    }
  }
  await expect(prepareCodeAnalysisInput({ capability: "parser.typescript", root,
    sourceModule: "example", scopedPaths: ["selected.ts"], trackedPaths: ["selected.ts"],
    texts: { "selected.ts": "export const answer = 42;" }, loadedModule: { TypeScriptPlugin: Reader } }))
    .rejects.toThrow("untracked source file");
});

test("Go analysis passes only selected entries and does not require a parent manifest", async () => {
  let manifest: unknown;
  class Reader {
    async detectEntries(value: unknown, fs: FileSystem) {
      manifest = value;
      expect(await fs.readFile("selected.go")).toBe("package example");
      return { entries: [{ path: "selected.go" }, { path: "unrelated.go" }] };
    }
    async extractSymbols(entries: unknown[]) { return entries; }
  }
  expect(await prepareCodeAnalysisInput({ capability: "parser.go", root, sourceModule: "example",
    scopedPaths: ["selected.go"], trackedPaths: ["selected.go", "unrelated.go"],
    texts: { "selected.go": "package example", "unrelated.go": "package example" },
    loadedModule: { GoPlugin: Reader } })).toEqual([{ path: "selected.go" }]);
  expect(manifest).toMatchObject({ type: "go.mod", content: { raw: "module example\n" } });
});
