import type { MdxAstNode, MdxExportBinding, MdxImportBinding, MdxLocator } from "./mdxTypes.js";

type EstreeNode = Record<string, unknown> & { type?: string };

function record(value: unknown): EstreeNode | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as EstreeNode
    : null;
}

function identifierName(value: unknown): string | null {
  const node = record(value);
  return node?.type === "Identifier" && typeof node.name === "string" ? node.name : null;
}

function literalString(value: unknown): string | null {
  const node = record(value);
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

function programBody(node: MdxAstNode): EstreeNode[] {
  const data = record(node.data);
  const estree = record(data?.estree);
  if (estree?.type !== "Program" || !Array.isArray(estree.body)) return [];
  const body: EstreeNode[] = [];
  for (const item of estree.body) {
    const parsed = record(item);
    if (parsed !== null) body.push(parsed);
  }
  return body;
}

function declarationNames(node: EstreeNode | null): string[] {
  if (node === null) return [];
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    const name = identifierName(node.id);
    return name === null ? [] : [name];
  }
  if (node.type !== "VariableDeclaration" || !Array.isArray(node.declarations)) return [];
  return node.declarations.flatMap((declaration) => {
    const item = record(declaration);
    const name = identifierName(item?.id);
    return name === null ? [] : [name];
  });
}

function importedName(specifier: EstreeNode): string | null {
  if (specifier.type === "ImportDefaultSpecifier") return "default";
  if (specifier.type === "ImportNamespaceSpecifier") return "*";
  return identifierName(specifier.imported);
}

export function parseMdxEsmNode(node: MdxAstNode, locator: MdxLocator): {
  imports: MdxImportBinding[];
  exports: MdxExportBinding[];
} {
  const imports: MdxImportBinding[] = [];
  const exports: MdxExportBinding[] = [];
  for (const statement of programBody(node)) {
    if (statement.type === "ImportDeclaration") {
      const sourceModule = literalString(statement.source);
      if (sourceModule === null || !Array.isArray(statement.specifiers)) continue;
      for (const rawSpecifier of statement.specifiers) {
        const specifier = record(rawSpecifier);
        const localName = identifierName(specifier?.local);
        const imported = specifier === null ? null : importedName(specifier);
        if (localName !== null && imported !== null) imports.push({ source_module: sourceModule, imported_name: imported, local_name: localName, locator });
      }
      continue;
    }
    if (statement.type === "ExportDefaultDeclaration") {
      exports.push({ exported_name: "default", source_module: null, local_name: identifierName(record(statement.declaration)?.id), locator });
      continue;
    }
    if (statement.type === "ExportAllDeclaration") {
      const sourceModule = literalString(statement.source);
      exports.push({ exported_name: "*", source_module: sourceModule, local_name: null, locator });
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    const sourceModule = literalString(statement.source);
    for (const name of declarationNames(record(statement.declaration))) {
      exports.push({ exported_name: name, source_module: null, local_name: name, locator });
    }
    if (!Array.isArray(statement.specifiers)) continue;
    for (const rawSpecifier of statement.specifiers) {
      const specifier = record(rawSpecifier);
      if (specifier === null) continue;
      const exportedName = identifierName(specifier.exported);
      if (exportedName === null) continue;
      exports.push({ exported_name: exportedName, source_module: sourceModule, local_name: identifierName(specifier.local), locator });
    }
  }
  return { imports, exports };
}
