import ts from "typescript";
import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import type { MdxExampleKind, MdxImportBinding, MdxLocator } from "./mdxTypes.js";

const SCRIPT_LANGUAGES = new Set(["js", "javascript", "jsx", "ts", "typescript", "tsx"]);

export interface ParsedMdxCodeBlock {
  language: string | null;
  metaTokens: string[];
  contentDigest: string;
  componentNames: string[];
  imports: MdxImportBinding[];
  parseSupported: boolean;
  syntaxError: string | null;
}

export function exampleKind(value: string): MdxExampleKind {
  const tokens = new Set(
    value
      .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
      .toLowerCase()
      .split(/[^a-z0-9]+/gu)
      .filter(Boolean),
  );
  if (tokens.has("sandbox") || tokens.has("sandboxes")) return "sandbox-host";
  if (tokens.has("story") || tokens.has("stories") || tokens.has("storybook")) return "story-host";
  if (tokens.has("demo") || tokens.has("demos") || tokens.has("playground") || tokens.has("live")) return "demo-host";
  return "code-block";
}

function scriptKind(language: string): ts.ScriptKind {
  if (language === "tsx") return ts.ScriptKind.TSX;
  if (language === "jsx") return ts.ScriptKind.JSX;
  if (language === "ts" || language === "typescript") return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function tagName(node: ts.JsxTagNameExpression): string {
  return node.getText();
}

function importBindings(sourceFile: ts.SourceFile, locator: MdxLocator): MdxImportBinding[] {
  const imports: MdxImportBinding[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const sourceModule = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause?.name) imports.push({ source_module: sourceModule, imported_name: "default", local_name: clause.name.text, locator });
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      imports.push({ source_module: sourceModule, imported_name: "*", local_name: bindings.name.text, locator });
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) imports.push({ source_module: sourceModule, imported_name: element.propertyName?.text ?? element.name.text, local_name: element.name.text, locator });
    }
  }
  return imports;
}

export function parseMdxCodeBlock(input: {
  path: string;
  ordinal: number;
  language: string | null;
  meta: string | null;
  value: string;
  locator: MdxLocator;
}): ParsedMdxCodeBlock {
  const language = input.language?.toLowerCase() ?? null;
  const metaTokens = [...new Set((input.meta ?? "").toLowerCase().match(/[a-z][a-z0-9_-]*/gu) ?? [])].sort();
  const contentDigest = indexerEvidenceAdapterProtocolDigest({ language, value: input.value });
  if (language === null || !SCRIPT_LANGUAGES.has(language)) {
    return { language, metaTokens, contentDigest, componentNames: [], imports: [], parseSupported: false, syntaxError: null };
  }
  const sourceFile = ts.createSourceFile(`${input.path}#code-${input.ordinal}.${language}`, input.value, ts.ScriptTarget.Latest, true, scriptKind(language));
  const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    return { language, metaTokens, contentDigest, componentNames: [], imports: [], parseSupported: false, syntaxError: ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, " ") };
  }
  const components = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = tagName(node.tagName);
      if (/^[A-Z]/u.test(name)) components.add(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return {
    language,
    metaTokens,
    contentDigest,
    componentNames: [...components].sort(),
    imports: importBindings(sourceFile, input.locator),
    parseSupported: true,
    syntaxError: null,
  };
}
