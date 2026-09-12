import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { validateArticleStructureEntries } from "@c4a/context";
import { approvedStructureInputHash, sha256Text } from "./approvedStructureInputHash.js";
import { isDeprecatedApprovedMarkdown, isRecord } from "./verifyFrontmatter.js";
import { isKnowledgeAssetPath, walkApprovedMarkdown } from "./verifyProjectFiles.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import { compactApprovedKnowledgeMarkdown } from "./approvedKnowledgeMetadata.js";

const STRUCTURE_PATH = "knowledge/structure.yaml";
const SCHEMA_VERSION = "context.approved-structure.v1";

export async function validateApprovedStructure(input: {
  projectRoot: string;
  issues: ProjectVerifyIssue[];
  structureOverride?: Record<string, unknown>;
}): Promise<void> {
  const issue = (code: string, path: string, message: string) =>
    input.issues.push({ severity: "error", code, path, message });
  const path = join(input.projectRoot, STRUCTURE_PATH);
  if (!input.structureOverride && !existsSync(path)) return;
  let parsed: Record<string, unknown>;
  let articles: ReturnType<typeof validateArticleStructureEntries>;
  try {
    const raw: unknown = input.structureOverride ?? YAML.parse(await readFile(path, "utf8"));
    if (!isRecord(raw)) throw new TypeError("Structure must be an object");
    parsed = raw;
    articles = validateArticleStructureEntries(raw.articles);
  } catch (error) {
    issue("approved-structure-invalid", STRUCTURE_PATH, String(error));
    return;
  }
  if (parsed.schema_version !== SCHEMA_VERSION) {
    issue("approved-structure-invalid", STRUCTURE_PATH, "Unexpected structure schema_version");
  }
  const byPath = new Map(articles.map(article => [article.path, article]));
  const seen = new Set<string>();
  const inputFiles = [];
  for (const file of await walkApprovedMarkdown(join(input.projectRoot, "knowledge"))) {
    if (isKnowledgeAssetPath(file.relPath)) continue;
    const content = await readFile(file.absPath, "utf8");
    if (isDeprecatedApprovedMarkdown(content)) continue;
    seen.add(file.relPath);
    inputFiles.push({ path: file.relPath, sha256: sha256Text(compactApprovedKnowledgeMarkdown(content)) });
    const article = byPath.get(file.relPath);
    if (!article) {
      issue("approved-structure-article-missing", file.relPath, "Approved Markdown has no article record");
      continue;
    }
    if (!file.relPath.startsWith(article.collection + "/")) {
      issue("approved-structure-collection-mismatch", file.relPath, "Article path differs from its collection");
    }
    let ids: string[];
    try { ids = approvedContextSectionsInMarkdown(content).map(section => section.id); }
    catch (error) { issue("approved-structure-section-invalid", file.relPath, String(error)); continue; }
    if (ids.some(id => !id) || new Set(ids).size !== ids.length ||
        ids.length !== article.sections.length || article.sections.some(section => !ids.includes(section.id))) {
      issue("approved-structure-section-mismatch", file.relPath, "Markdown and structure fragment IDs must match");
    }
  }
  for (const article of articles) {
    if (!seen.has(article.path)) issue("approved-structure-article-missing", article.path, "Article has no approved Markdown file");
  }
  const expected = approvedStructureInputHash({ schemaVersion: SCHEMA_VERSION, files: inputFiles, metadata: articles });
  if (parsed.input_hash !== expected) {
    issue("approved-structure-input-hash-mismatch", STRUCTURE_PATH, "Structure is stale; run Close");
  }
}
