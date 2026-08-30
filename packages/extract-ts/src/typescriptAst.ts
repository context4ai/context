import type { ExtractionDiagnostic } from "@c4a/extract";
import ts from "typescript";

const scriptKind = (filePath: string): ts.ScriptKind => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
};

export const createEcmaScriptSourceFile = (source: string, filePath: string): ts.SourceFile =>
  ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind(filePath));

type SourceFileWithParseDiagnostics = ts.SourceFile & {
  parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
};

export const syntaxDiagnostics = (
  sourceFile: ts.SourceFile,
): ExtractionDiagnostic[] => {
  const diagnostics = (sourceFile as SourceFileWithParseDiagnostics).parseDiagnostics ?? [];
  return diagnostics.map((diagnostic) => {
    const start = diagnostic.start ?? 0;
    const position = sourceFile.getLineAndCharacterOfPosition(start);
    return {
      code: "ecmascript-syntax-error",
      severity: "error" as const,
      file: sourceFile.fileName,
      line: position.line + 1,
      column: position.character + 1,
    };
  });
};

export const nodeLocation = (sourceFile: ts.SourceFile, node: ts.Node) => {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
  };
};

export const staticStringValue = (node: ts.Expression | undefined): string | null => {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
};
