export function isApprovedKnowledgeMarkdownPath(path: string): boolean {
  return path.split(/[\\/]+/u).join("/").endsWith(".md");
}
