import { approvedKnowledgeDependencyWarnings } from "./approvedKnowledgeDependencyWarnings.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";

/** Reader-visible provenance state belongs to the output projection. Never
 * change approved prose or its review identity to publish a diagnostic. The
 * projected content also participates in the ordinary package fingerprint. */
export async function withPackageKnowledgeAdvisories(projectRoot: string, files: readonly ApprovedKnowledgeFile[]): Promise<ApprovedKnowledgeFile[]> {
  const stale = new Set((await approvedKnowledgeDependencyWarnings(projectRoot)).map(issue => issue.path));
  return files.map(file => {
    if (!stale.has(file.relPath)) return file;
    const notice = "> **Supporting knowledge needs review.** An approved source article changed or is unavailable. Recheck the linked sources before relying on this article's combined conclusions.\n\n";
    const frontmatter = /^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$))/u.exec(file.content)?.[0] ?? "";
    const body = file.content.slice(frontmatter.length);
    const title = /^(\s*# [^\r\n]+(?:\r?\n|$)\s*)/u.exec(body)?.[0] ?? "";
    return { ...file, content: `${frontmatter}${title}${notice}${body.slice(title.length)}` };
  });
}
