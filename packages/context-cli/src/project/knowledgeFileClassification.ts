export const DOCUMENT_REVISION_SUFFIX = "__revision.md";

export type KnowledgeMarkdownKind = "approved" | "revision" | "other";

function normalized(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}

export function classifyKnowledgeMarkdownPath(path: string): KnowledgeMarkdownKind {
  const value = normalized(path);
  if (!value.endsWith(".md")) return "other";
  return value.endsWith(DOCUMENT_REVISION_SUFFIX) ? "revision" : "approved";
}

export function isApprovedKnowledgeMarkdownPath(path: string): boolean {
  return classifyKnowledgeMarkdownPath(path) === "approved";
}

export function isDocumentRevisionPath(path: string): boolean {
  return classifyKnowledgeMarkdownPath(path) === "revision";
}

export function documentRevisionPathForApprovedPath(approvedPath: string): string {
  const value = normalized(approvedPath);
  if (!value.endsWith(".md") || isDocumentRevisionPath(value)) {
    throw new Error(`document revision requires an approved Markdown path: ${approvedPath}`);
  }
  return `${value.slice(0, -3)}${DOCUMENT_REVISION_SUFFIX}`;
}

export function approvedPathForDocumentRevisionPath(revisionPath: string): string | null {
  const value = normalized(revisionPath);
  if (!isDocumentRevisionPath(value)) return null;
  return `${value.slice(0, -DOCUMENT_REVISION_SUFFIX.length)}.md`;
}
