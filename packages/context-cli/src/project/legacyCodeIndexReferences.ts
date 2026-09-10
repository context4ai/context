import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import ts from "typescript";

function legacyReference(key: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (key === "collection") return value === "codegraph";
  if (key === "view_ref") return value.startsWith("codegraph:");
  return key === "path" && /^(?:knowledge\/|wikis\/)?codegraph(?:\/|$)/u.test(value);
}

/** Inspect configuration identities, not prose, quoted source paths or stored
 * evidence. A page about a legacy workspace is valid current knowledge. */
function hasStructuredLegacyReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasStructuredLegacyReference);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    if (["body", "markdown", "content", "facts", "evidence_bindings", "approved_knowledge", "approved_knowledge_snapshot", "sections"].includes(key)) return false;
    return legacyReference(key, child) || hasStructuredLegacyReference(child);
  });
}

export function hasFormalLegacyCodeIndexReference(path: string, content: string): boolean {
  if (!content.includes("codegraph")) return false;
  const extension = extname(path).toLowerCase();
  if ([".md", ".mdx"].includes(extension)) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)?.[1];
    if (frontmatter === undefined) return false;
    try { return hasStructuredLegacyReference(parseYaml(frontmatter)); } catch { return false; }
  }
  if ([".json", ".yaml", ".yml"].includes(extension)) {
    try { return hasStructuredLegacyReference(parseYaml(content)); } catch { return false; }
  }
  if (![".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(extension)) return false;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        ts.isStringLiteralLike(node.initializer) && legacyReference(node.name.text, node.initializer.text)) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
