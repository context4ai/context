import { EdgeType } from "@c4a/core";
import type { FileSystem, RelationInfo } from "@c4a/extract";
import type { CommonJsModuleAnalysis } from "./commonJsModule.js";
import { isRelativeModuleSpecifier, resolveImportSourcePath } from "./pathUtils.js";
import { createRelation, getLine, type ImportBinding, type SyntaxNode } from "./symbolExtractorAst.js";
import type { TsConfigPathResolver } from "./tsconfigPaths.js";

const esmImportParts = (
  node: SyntaxNode,
  bindings: Map<string, ImportBinding>,
  isExternal: boolean,
  statementTypeOnly: boolean,
) => {
  let hasValueImport = !statementTypeOnly;
  let hasTypeImport = statementTypeOnly;
  const clause = node.namedChildren.find((child) => child.type === "import_clause");
  for (const part of clause?.namedChildren ?? []) {
    if (part.type === "identifier") {
      bindings.set(part.text, { isExternal, typeOnly: statementTypeOnly });
      continue;
    }
    if (part.type === "namespace_import") {
      const identifier = part.namedChildren.find((child) => child.type === "identifier");
      if (identifier) bindings.set(identifier.text, { isExternal, typeOnly: statementTypeOnly });
      continue;
    }
    if (part.type !== "named_imports") continue;
    for (const specifierNode of part.namedChildren.filter((child) => child.type === "import_specifier")) {
      const identifiers = specifierNode.namedChildren
        .filter((child) => child.type === "identifier" || child.type === "type_identifier")
        .map((child) => child.text);
      const localName = identifiers[1] ?? identifiers[0];
      if (!localName) continue;
      const typeOnly = statementTypeOnly || specifierNode.text.trim().startsWith("type ");
      bindings.set(localName, { isExternal, typeOnly });
      hasValueImport ||= !typeOnly;
      hasTypeImport ||= typeOnly;
    }
  }
  return { hasValueImport, hasTypeImport };
};

const appendEsmImport = async (input: {
  node: SyntaxNode;
  filePath: string;
  fs: FileSystem;
  resolver: TsConfigPathResolver;
  bindings: Map<string, ImportBinding>;
  relations: RelationInfo[];
}) => {
  const specifierNode = input.node.namedChildren.find((child) => child.type === "string");
  if (!specifierNode) return;
  const specifier = specifierNode.text.replace(/^['"]/, "").replace(/['"]$/, "");
  const resolvedAlias = isRelativeModuleSpecifier(specifier)
    ? null
    : await resolveImportSourcePath(input.filePath, specifier, input.fs, input.resolver);
  const isExternal = !isRelativeModuleSpecifier(specifier) && resolvedAlias === null;
  const statementTypeOnly = input.node.text.startsWith("import type ");
  const parts = esmImportParts(input.node, input.bindings, isExternal, statementTypeOnly);
  if (parts.hasValueImport) {
    input.relations.push(createRelation(
      EdgeType.Imports,
      "",
      resolvedAlias ?? specifier,
      isExternal,
      getLine(input.node),
    ));
  }
  if (parts.hasTypeImport) {
    input.relations.push(createRelation(
      EdgeType.ImportsType,
      "",
      resolvedAlias ?? specifier,
      isExternal,
      getLine(input.node),
    ));
  }
};

const appendCommonJsImports = async (input: {
  commonJs: CommonJsModuleAnalysis;
  filePath: string;
  fs: FileSystem;
  resolver: TsConfigPathResolver;
  bindings: Map<string, ImportBinding>;
  relations: RelationInfo[];
}) => {
  const recordedSources = new Set<string>();
  for (const binding of input.commonJs.bindings) {
    const resolved = await resolveImportSourcePath(input.filePath, binding.source, input.fs, input.resolver);
    const isExternal = !isRelativeModuleSpecifier(binding.source) && resolved === null;
    input.bindings.set(binding.localName, { isExternal, typeOnly: false });
    if (recordedSources.has(binding.source)) continue;
    recordedSources.add(binding.source);
    input.relations.push(createRelation(
      EdgeType.Imports,
      "",
      resolved ?? binding.source,
      isExternal,
      binding.line,
    ));
  }
  const remainingSources = [...new Set([
    ...input.commonJs.wildcardSources,
    ...input.commonJs.exports.flatMap((item) => item.source ? [item.source] : []),
  ])].sort();
  for (const source of remainingSources) {
    if (recordedSources.has(source)) continue;
    const resolved = await resolveImportSourcePath(input.filePath, source, input.fs, input.resolver);
    const isExternal = !isRelativeModuleSpecifier(source) && resolved === null;
    input.relations.push(createRelation(
      EdgeType.Imports,
      "",
      resolved ?? source,
      isExternal,
      input.commonJs.exports.find((item) => item.source === source)?.line ?? 1,
    ));
  }
};

export const collectImportBindings = async (
  root: SyntaxNode,
  filePath: string,
  fs: FileSystem,
  resolver: TsConfigPathResolver,
  relations: RelationInfo[],
  commonJs: CommonJsModuleAnalysis,
): Promise<Map<string, ImportBinding>> => {
  const bindings = new Map<string, ImportBinding>();
  for (const node of root.namedChildren.filter((child) => child.type === "import_statement")) {
    await appendEsmImport({ node, filePath, fs, resolver, bindings, relations });
  }
  await appendCommonJsImports({ commonJs, filePath, fs, resolver, bindings, relations });
  return bindings;
};
