import { expect, test } from "bun:test";
import type { FileSystem, SymbolInfo } from "@c4a/extract";
import type { IndexerArtifactFact } from "@c4a/context";
import { TypeScriptPlugin, typeScriptExtractionToEvidenceAdapterMaterialization } from "@c4a/extract-ts";
import { renderPublicContractFacts } from "../project/indexerPublicContractDefaults.js";

test("component extraction and evidence materialization preserve partial Props in the reader contract table", async () => {
  const manifest = { name: "fixture-components", exports: { ".": "./src/view.tsx" } };
  const files: Record<string, string> = {
    "package.json": JSON.stringify(manifest),
    "src/view.tsx": `import type { FC, PropsWithChildren } from 'react';
type Trigger = 'click' | 'hover';
export interface Props { triggerMode?: Trigger | Trigger[]; testId?: string }
export const View: FC<PropsWithChildren<Props>> = ({ testId = 'view' }) => null;`,
  };
  const fs: FileSystem = {
    readFile: async path => { if (!(path in files)) throw new Error(`Unexpected source read: ${path}`); return files[path]!; },
    readJson: async <T>(path: string) => JSON.parse(files[path]!) as T,
    exists: async path => path in files || Object.keys(files).some(file => file.startsWith(`${path}/`)),
    readdir: async path => [...new Set(Object.keys(files)
      .filter(file => file.startsWith(`${path}/`)).map(file => file.slice(path.length + 1).split("/")[0]!))],
  };
  const plugin = new TypeScriptPlugin();
  const entries = await plugin.detectEntries({ type: "package.json", path: "package.json", content: manifest }, fs);
  const extraction = await plugin.extractSymbols(entries.entries, fs);
  const materialized = typeScriptExtractionToEvidenceAdapterMaterialization(extraction, {
    adapter: { id: "extract-ts", package: "@c4a/extract-ts", export: "typeScriptExtractionToEvidenceAdapterResult",
      version: "0.7.7", digest: `sha256:${"a".repeat(64)}` },
    authorized_scope: { source_ref: "repo:fixture", module_refs: ["module:components"], scope_digest: `sha256:${"b".repeat(64)}` },
    module_ref: "module:components", input_digest: `sha256:${"c".repeat(64)}`, precedence: 100,
  });
  const view = materialized.fact_payloads.find(item => {
    const value = item.payload as { name?: string; kind?: string };
    return value.name === "View" && value.kind === "component";
  });
  expect(view).toBeDefined();
  const value = view!.payload as unknown as SymbolInfo;
  expect(value.contractResolution).toBe("declaration-only");
  expect(value.propsType).toBe("PropsWithChildren<Props>");
  expect(value.members?.map(member => [member.name, member.typeAnnotation, member.defaultValue])).toEqual([
    ["triggerMode", "Trigger | Trigger[]", undefined], ["testId", "string", "'view'"],
  ]);
  const fact: IndexerArtifactFact = {
    fact_ref: view!.fact_ref, fact_kind: "code-symbol", evidence_refs: ["source:view"], value: view!.payload,
    subject_key: { protocol: "context.subject-key/v1", namespace: "fixture", kind: "component", local_key: "view" },
  };
  const before = JSON.stringify(fact);
  const rendered = renderPublicContractFacts([fact]);
  expect(rendered).toContain("Trigger &#124; Trigger[]");
  expect(rendered).not.toContain("{} &#124;");
  expect(rendered).toContain("'view'");
  expect(rendered).not.toContain("| children |");
  expect(rendered).toContain("PropsWithChildren");
  expect(JSON.stringify(fact)).toBe(before);
});
