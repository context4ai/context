import type { ContractDocumentCatalog } from "@c4a/extract-contract";

export async function loadRevisionContractDependencies(
  loadedModule: Record<string, unknown>, initial: Record<string, string>, trackedPaths: readonly string[],
  readSource: (path: string) => Promise<string>,
) {
  const discover = loadedModule.openApiSourceDependencies;
  if (typeof discover !== "function") throw new TypeError("Contract package has no openApiSourceDependencies");
  const dependencies = discover as (path: string, text: string) => string[];
  const tracked = new Set(trackedPaths);
  const texts = { ...initial };
  const queue = Object.keys(texts);
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index]!;
    for (const dependency of dependencies(path, texts[path]!)) {
      if (!tracked.has(dependency)) throw new TypeError(`Contract reference ${dependency} in ${path} is outside the captured source`);
      if (Object.hasOwn(texts, dependency)) continue;
      texts[dependency] = await readSource(dependency);
      queue.push(dependency);
    }
  }
  return texts;
}

/** Use the contract parser's declarations and diagnostics, without restoring
 * the retired evidence-adapter registration and receipt protocol. */
export function revisionContractDeclarations(loadedModule: Record<string, unknown>, texts: Record<string, string>, selectedPaths: readonly string[] = Object.keys(texts)) {
  const parse = loadedModule.parseContractSources;
  if (typeof parse !== "function") throw new TypeError("Contract package has no parseContractSources");
  const documents = (parse as (files: Record<string, string>) => ContractDocumentCatalog[])(texts);
  return documents.flatMap(document => {
    const errors = document.diagnostics.filter(diagnostic => diagnostic.severity === "error");
    if (document.disposition !== "analyzed" || errors.length) {
      throw new TypeError(`Cannot regenerate ${document.path}: ${errors.map(error => error.detail).join("; ") || document.disposition}. Existing article unchanged.`);
    }
    if (!selectedPaths.includes(document.path)) return [];
    return [...document.types, ...document.operations].map(item => ({
      file: document.path, line: item.locator.line,
      name: item.locator.qualified_item_path,
      value: "parent" in item ? { ...item, name: `${item.parent}.${item.name}` } : item,
    }));
  });
}
