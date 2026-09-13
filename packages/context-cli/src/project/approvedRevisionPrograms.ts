import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { indexerProtocolDigest, projectIndexerPublicContractTable, renderIndexerDeterministicFacts,
  loadSourcesRegistry, type IndexerArtifactFact, type ProcessedScope } from "@c4a/context";
import type { ExtractionResult } from "@c4a/extract";
import { registeredArticleSourceReader } from "./articleSourceReader.js";
import { captureProcessedScopes } from "./processedScopeStorage.js";
import { prepareCodeAnalysisInput } from "./codeAnalysisInput.js";
import { loadRevisionProtocolDependencies, revisionProtocolDeclarations } from "./revisionProtocolDeclarations.js";
import { loadRevisionContractDependencies, revisionContractDeclarations } from "./revisionContractDeclarations.js";

const execute = promisify(execFile);
const requireFromCli = createRequire(import.meta.url);
export interface RevisionProgramBlock { token: string; source_ref: string; fact_ref: string; markdown: string; declaration_status?: string | undefined }
type SourceFile = { source_ref: string; locator: { path: string } };

/** Explicit regeneration reads the article's cited files and lazy dependencies.
 * No Provider ownership, version or instruction registry participates. */
export async function prepareRevisionProgramBlocks(root: string, sourceRefs: string[], scopes: ProcessedScope[], references: readonly SourceFile[]) {
  const selected = scopes.filter(scope => scope.source_ref.startsWith("repo:") && sourceRefs.includes(scope.source_ref))
    .map(({ module_refs, ...scope }) => ({ ...scope, ...(module_refs?.length ? { module_refs } : {}) }));
  if (!selected.length) return [];
  await captureProcessedScopes(root, selected);
  const registry = await loadSourcesRegistry({ rootDir: root });
  const read = await registeredArticleSourceReader(root);
  const blocks = new Map<string, RevisionProgramBlock>();
  for (const source of new Set(selected.map(scope => scope.source_ref))) {
    const entries = registry.repos.filter(entry => source === `repo:${entry.id}` || source === `repo:${entry.name}`);
    if (entries.length !== 1) throw new TypeError(`Regeneration requires one registered source: ${source}`);
    const entry = entries[0]!;
    const directory = join(root, entry.materializedAt);
    const paths = [...new Set(references.filter(reference => reference.source_ref === source).map(reference => reference.locator.path))];
    if (!paths.length) continue;
    const listing = await execute("git", ["-C", directory, "ls-tree", "-r", "--name-only", "-z", entry.ref], {
      encoding: "utf8", timeout: 5000, maxBuffer: 8 * 1024 * 1024,
    });
    const tracked = listing.stdout.split("\0").filter(Boolean);
    const groups = new Map<string, string[]>();
    for (const path of paths) {
      const extension = extname(path).toLowerCase();
      const capability = [".ts", ".tsx", ".cts", ".mts", ".js", ".jsx", ".cjs", ".mjs"].includes(extension)
        ? "parser.typescript" : extension === ".go" ? "parser.go"
          : extension === ".proto" ? "parser.proto" : extension === ".thrift" ? "parser.thrift"
            : [".graphql", ".gql", ".json", ".yaml", ".yml"].includes(extension) ? "parser.contract" : undefined;
      if (!capability) throw new TypeError(`No current regeneration capability for ${source}:${path}. Use a suitable scoped analysis capability; the existing article has not changed.`);
      if (!tracked.includes(path)) throw new TypeError(`Regeneration file is outside the captured source: ${path}`);
      groups.set(capability, [...groups.get(capability) ?? [], path]);
    }
    for (const [capability, paths] of groups) {
      const texts = Object.fromEntries(await Promise.all(paths.map(async path => [path, await read(source, path, true)])));
      const packageName = capability === "parser.typescript" ? "@c4a/extract-ts" : `@c4a/extract-${capability.slice(7)}`;
      const loadedModule = await import(pathToFileURL(requireFromCli.resolve(packageName)).href);
      const declarations = capability === "parser.proto" || capability === "parser.thrift"
        ? revisionProtocolDeclarations(capability, loadedModule,
          await loadRevisionProtocolDependencies(capability, loadedModule, texts, tracked, path => read(source, path, true)), paths)
        : capability === "parser.contract" ? revisionContractDeclarations(loadedModule,
          await loadRevisionContractDependencies(loadedModule, texts, tracked, path => read(source, path, true)), paths)
        : ((await prepareCodeAnalysisInput({ capability, root: directory, sourceModule: entry.module,
          scopedPaths: paths, trackedPaths: tracked, texts, loadedModule,
          readSource: path => read(source, path, true) })) as ExtractionResult).symbols.map(symbol => ({ ...symbol, value: symbol }));
      const facts: IndexerArtifactFact[] = declarations.map(symbol => ({
        fact_ref: indexerProtocolDigest({ source, file: symbol.file, line: symbol.line, name: symbol.name }),
        fact_kind: "symbol", value: JSON.parse(JSON.stringify(symbol.value)), evidence_refs: [source],
        subject_key: { protocol: "context.subject-key/v1", namespace: source, kind: "file", local_key: symbol.file },
      }));
      for (const fact of facts) {
        const table = projectIndexerPublicContractTable(fact);
        if (!table) continue;
        const token = `{{context:program:${indexerProtocolDigest({ source, fact: fact.fact_ref }).slice(7)}}}`;
        blocks.set(token, { token, source_ref: source, fact_ref: fact.fact_ref,
          markdown: renderIndexerDeterministicFacts({ renderer: "public-contract-table", facts: [fact], supporting_facts: facts }),
          declaration_status: table.declaration_status });
      }
    }
  }
  await captureProcessedScopes(root, selected);
  return [...blocks.values()];
}

export function expandRevisionProgramBlocks(markdown: string, blocks: RevisionProgramBlock[]): string {
  const byToken = new Map(blocks.map((block) => [block.token, block.markdown]));
  return markdown.replace(/\{\{context:program:[^}\n]+\}\}/gu, (token) => {
    const content = byToken.get(token);
    if (content === undefined) throw new TypeError("Revision references a program block outside its current source scope");
    return content;
  });
}
