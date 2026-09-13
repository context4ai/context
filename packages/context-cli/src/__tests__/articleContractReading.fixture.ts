import { projectIndexerPublicContractTable, renderIndexerDeterministicFacts,
  type IndexerArtifactFact } from "@c4a/context";
import { createModuleFileSystem } from "@c4a/extract";
import { TypeScriptPlugin } from "@c4a/extract-ts";
import { join } from "node:path";

/** Explicit writing-time analysis of the selected fixture source. No Provider
 * registry, workset, version receipt or whole-repository preparation is needed. */
export async function readArticleContracts(projectRoot: string, path: string) {
  const fs = createModuleFileSystem(join(projectRoot, "fixture-source"));
  const plugin = new TypeScriptPlugin();
  const detected = await plugin.detectEntries({ type: "package.json", path: "package.json",
    content: await fs.readJson("package.json") }, fs);
  const selectedEntries = detected.entries.filter(entry => entry.path === path);
  const extraction = await plugin.extractSymbolsInScope(selectedEntries, [path], fs);
  const facts: IndexerArtifactFact[] = extraction.symbols.map((symbol, index) => ({
    fact_ref: `fixture-symbol:${index}`, fact_kind: "symbol", value: JSON.parse(JSON.stringify(symbol)), evidence_refs: [],
    subject_key: { protocol: "context.subject-key/v1", namespace: "fixture", kind: "file", local_key: path },
  }));
  return (symbols: string[]): string => {
    const selected = facts.filter(fact => {
      const value = fact.value as { name?: string; qualifiedName?: string };
      return symbols.includes(value.name ?? value.qualifiedName ?? "") && projectIndexerPublicContractTable(fact) !== undefined;
    });
    if (!selected.length) throw new Error(`No declarations found for ${symbols.join(", ")}`);
    return renderIndexerDeterministicFacts({ renderer: "public-contract-table", facts: selected, supporting_facts: facts });
  };
}
