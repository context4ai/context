import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeMap } from "@c4a/context";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { readApprovedKnowledgeMetadataIndex, hydrateApprovedKnowledgeMarkdown } from "./approvedKnowledgeMetadata.js";
import { walkPackageFiles } from "./packageBuildReceipt.js";
import { parseKnowledgeFrontmatter } from "./packageKnowledgeProjection.js";
import { isApprovedKnowledgeMarkdownPath } from "./knowledgeFileClassification.js";

export type KnowledgeMapArticleTarget = { artifact_ref: string; section_keys: string[]; title?: string };
export function knowledgeMapArticleTargets(files: readonly { content: string }[]): KnowledgeMapArticleTarget[] {
  return files.flatMap(file => {
    const meta = parseKnowledgeFrontmatter(file.content);
    if (typeof meta.artifact_ref !== "string" || meta.deprecated === true) return [];
    return [{ artifact_ref: meta.artifact_ref, title: typeof meta.title === "string" ? meta.title : meta.artifact_ref,
      section_keys: [...file.content.matchAll(/<!--\s*context:section\b[^>]*\bid="([a-zA-Z0-9_-]+)"[^>]*-->/gu)].map(match => match[1]!) }];
  });
}
export async function approvedKnowledgeMapTargets(root: string): Promise<KnowledgeMapArticleTarget[]> {
  const metadata = await readApprovedKnowledgeMetadataIndex(root);
  const files = await walkPackageFiles(join(root, "knowledge"));
  const content = await Promise.all(files.filter(file => isApprovedKnowledgeMarkdownPath(file.relPath) && !file.relPath.startsWith("assets/")).map(async file => ({
    content: hydrateApprovedKnowledgeMarkdown({ content: await readFile(file.absPath, "utf8"), relPath: file.relPath, metadata }),
  })));
  return knowledgeMapArticleTargets(content);
}
export function knowledgeMapCoverage(structure: KnowledgeMap | undefined, required: readonly KnowledgeMapArticleTarget[]) {
  const bound = new Set(structure?.entries.flatMap(entry => entry.target ? [entry.target.artifact_ref] : []) ?? []);
  const articles = [...new Map(required.map(target => [target.artifact_ref, target])).values()];
  const missing = articles.filter(article => !bound.has(article.artifact_ref));
  return { total: articles.length, bound: articles.length - missing.length, missing };
}
/** Mechanical references only: labels and classification remain the author's decision. */
export function assertKnowledgeMapCoverage(structure: KnowledgeMap | undefined, required: readonly KnowledgeMapArticleTarget[],
  options: { known?: readonly KnowledgeMapArticleTarget[]; revision?: string; require_update?: boolean; has_update?: boolean; current_revision?: string | null } = {}) {
  const coverage = knowledgeMapCoverage(structure, required);
  const known = new Map((options.known ?? required).map(article => [article.artifact_ref, article]));
  const invalid = (structure?.entries ?? []).flatMap(entry => {
    if (!entry.target) return [];
    const article = known.get(entry.target.artifact_ref);
    if (!article) return options.known ? [{ entry: entry.key, target: entry.target, reason: "unknown-article" }] : [];
    return entry.target.section_key && !article.section_keys.includes(entry.target.section_key)
      ? [{ entry: entry.key, target: entry.target, reason: "unknown-section" }] : [];
  });
  if (!coverage.missing.length && !invalid.length && !(options.require_update && !options.has_update)) return coverage;
  throw new ContextError(ExitCode.UserError, "Knowledge map is incomplete. Bind every article with knowledge_map.upsert[].target.artifact_ref; section_key is optional. Keep category nodes and add article entries beneath them. No approval or package output was committed.", {
    reason_code: "knowledge-map-incomplete", coverage, invalid_targets: invalid,
    next_action: { command: "context task adjust --input - --format json", message: "Apply the missing bindings, then retry the original action with the current knowledge-map revision." },
    input_schema: { knowledge_map: { expected_revision: options.current_revision === undefined ? structure?.revision ?? null : options.current_revision,
      upsert: [{ key: "<unique-entry-key>", parent: "<existing-category-key-or-null>", title: "<reader-label>", target: { artifact_ref: "<artifact_ref from missing>" } }], remove: [] } },
    ...(options.revision ? { structure_review_revision: options.revision } : {}),
  });
}
