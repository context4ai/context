import { parseFile } from "@c4a/extract";
import type { FileSystem } from "@c4a/extract";
import type Parser from "web-tree-sitter";
import { resolveImportSourcePath } from "./pathUtils.js";
import type { TsConfigPathResolver } from "./tsconfigPaths.js";

type SyntaxNode = Parser.SyntaxNode;

export type TracedExport = {
  exportedName: string;
  localName: string;
  declarationFile: string;
};

export type TraceExportsResult = {
  exports: TracedExport[];
  files: string[];
};

type ImportBinding = {
  source: string;
  importedName: string;
};

type TraceState = {
  files: Set<string>;
  cache: Map<string, Promise<TracedExport[]>>;
  inFlight: Set<string>;
  resolver: TsConfigPathResolver;
};

const DECLARATION_TYPES = new Set([
  "function_declaration",
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "lexical_declaration",
]);

const stripQuotes = (value: string) => value.replace(/^['"]/, "").replace(/['"]$/, "");

const getDeclarationName = (node: SyntaxNode) => {
  if (node.type === "lexical_declaration") {
    return node.namedChildren
      .filter((child) => child.type === "variable_declarator")
      .map((child) => child.childForFieldName("name")?.text ?? child.namedChildren[0]?.text ?? "")
      .filter(Boolean);
  }

  const nameNode =
    node.childForFieldName("name") ??
    node.namedChildren.find((child) => child.type === "identifier" || child.type === "type_identifier");
  return nameNode?.text ? [nameNode.text] : [];
};

const collectLocalDeclarations = (root: SyntaxNode) => {
  const declarations = new Map<string, string>();

  const register = (node: SyntaxNode) => {
    for (const name of getDeclarationName(node)) {
      if (!declarations.has(name)) {
        declarations.set(name, name);
      }
    }
  };

  for (const child of root.namedChildren) {
    if (DECLARATION_TYPES.has(child.type)) {
      register(child);
      continue;
    }

    if (child.type !== "export_statement") continue;
    const declaration = child.namedChildren.find((node) => DECLARATION_TYPES.has(node.type));
    if (declaration) {
      register(declaration);
    }
  }

  return declarations;
};

const parseExportSpecifier = (node: SyntaxNode) => {
  const identifiers = node.namedChildren
    .filter((child) => child.type === "identifier" || child.type === "type_identifier")
    .map((child) => child.text);
  if (identifiers.length === 0) return null;
  const localName = identifiers[0]!;
  const exportedName = identifiers[1] ?? localName;
  return { localName, exportedName };
};

const parseImportSpecifier = (node: SyntaxNode) => {
  const identifiers = node.namedChildren
    .filter((child) => child.type === "identifier" || child.type === "type_identifier")
    .map((child) => child.text);
  if (identifiers.length === 0) return null;
  const importedName = identifiers[0]!;
  const localName = identifiers[1] ?? importedName;
  return { importedName, localName };
};

const collectImportBindings = (root: SyntaxNode) => {
  const bindings = new Map<string, ImportBinding>();

  for (const node of root.namedChildren) {
    if (node.type !== "import_statement") continue;
    const stringNode = node.namedChildren.find((child) => child.type === "string");
    if (!stringNode) continue;
    const source = stripQuotes(stringNode.text);
    const clause = node.namedChildren.find((child) => child.type === "import_clause");
    for (const part of clause?.namedChildren ?? []) {
      if (part.type === "identifier") {
        bindings.set(part.text, { source, importedName: "default" });
        continue;
      }

      if (part.type !== "named_imports") continue;
      for (const specifier of part.namedChildren.filter((child) => child.type === "import_specifier")) {
        const parsed = parseImportSpecifier(specifier);
        if (parsed) {
          bindings.set(parsed.localName, { source, importedName: parsed.importedName });
        }
      }
    }
  }

  return bindings;
};

const uniqueExports = (exportsList: TracedExport[]) => {
  const seen = new Set<string>();
  return exportsList.filter((item) => {
    const key = `${item.declarationFile}::${item.localName}::${item.exportedName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const traceImportedBinding = async (
  filePath: string,
  binding: ImportBinding,
  exportedName: string,
  fs: FileSystem,
  state: TraceState,
) => {
  const targetPath = await resolveImportSourcePath(filePath, binding.source, fs, state.resolver);
  if (!targetPath) return [];

  const traced = await traceFile(targetPath, fs, state);
  const match = traced.find((item) =>
    item.exportedName === binding.importedName ||
    (binding.importedName === "default" && item.exportedName === item.localName)
  );
  if (!match) return [];

  return [{
    exportedName,
    localName: match.localName,
    declarationFile: match.declarationFile,
  }];
};

const traceFile = async (
  filePath: string,
  fs: FileSystem,
  state: TraceState,
): Promise<TracedExport[]> => {
  const cached = state.cache.get(filePath);
  if (cached) return cached;

  if (state.inFlight.has(filePath)) return [];

  const promise = (async () => {
    state.inFlight.add(filePath);
    state.files.add(filePath);

    const source = await fs.readFile(filePath);
    const tree = await parseFile(source, filePath.endsWith(".tsx"));
    if (!tree) return [];

    const root = tree.rootNode;
    const localDeclarations = collectLocalDeclarations(root);
    const importBindings = collectImportBindings(root);
    const exportsList: TracedExport[] = [];

    for (const node of root.namedChildren) {
      if (node.type !== "export_statement") continue;

      const stringNode = node.namedChildren.find((child) => child.type === "string");
      const exportClause = node.namedChildren.find((child) => child.type === "export_clause");
      const declaration = node.namedChildren.find((child) => DECLARATION_TYPES.has(child.type));

      if (declaration) {
        for (const name of getDeclarationName(declaration)) {
          exportsList.push({ exportedName: name, localName: name, declarationFile: filePath });
        }
        continue;
      }

      if (node.text.startsWith("export default ")) {
        const identifier = node.namedChildren.find(
          (child) => child.type === "identifier" || child.type === "type_identifier",
        );
        if (identifier && localDeclarations.has(identifier.text)) {
          exportsList.push({
            exportedName: identifier.text,
            localName: identifier.text,
            declarationFile: filePath,
          });
        }
        continue;
      }

      if (!exportClause) {
        if (stringNode && node.text.startsWith("export *")) {
          const targetPath = await resolveImportSourcePath(filePath, stripQuotes(stringNode.text), fs, state.resolver);
          if (targetPath) {
            exportsList.push(...(await traceFile(targetPath, fs, state)));
          }
        }
        continue;
      }

      if (!stringNode) {
        for (const specifier of exportClause.namedChildren.filter((child) => child.type === "export_specifier")) {
          const parsed = parseExportSpecifier(specifier);
          if (!parsed) continue;
          if (localDeclarations.has(parsed.localName)) {
            exportsList.push({
              exportedName: parsed.exportedName,
              localName: parsed.localName,
              declarationFile: filePath,
            });
            continue;
          }

          const importBinding = importBindings.get(parsed.localName);
          if (importBinding) {
            exportsList.push(...(await traceImportedBinding(filePath, importBinding, parsed.exportedName, fs, state)));
          }
        }
        continue;
      }

      const targetPath = await resolveImportSourcePath(filePath, stripQuotes(stringNode.text), fs, state.resolver);
      if (!targetPath) continue;

      const traced = await traceFile(targetPath, fs, state);
      for (const specifier of exportClause.namedChildren.filter((child) => child.type === "export_specifier")) {
        const parsed = parseExportSpecifier(specifier);
        if (!parsed) continue;
        const match = traced.find((item) => item.exportedName === parsed.localName);
        if (!match) continue;
        exportsList.push({
          exportedName: parsed.exportedName,
          localName: match.localName,
          declarationFile: match.declarationFile,
        });
      }
    }

    state.inFlight.delete(filePath);
    return uniqueExports(exportsList);
  })();

  state.cache.set(filePath, promise);
  return promise;
};

export const traceExports = async (
  entryPath: string,
  fs: FileSystem,
  resolver: TsConfigPathResolver = { mappings: [] },
): Promise<TraceExportsResult> => {
  const state: TraceState = {
    files: new Set<string>(),
    cache: new Map(),
    inFlight: new Set<string>(),
    resolver,
  };

  const exportsList = await traceFile(entryPath, fs, state);
  return {
    exports: uniqueExports(exportsList),
    files: [...state.files].sort(),
  };
};
