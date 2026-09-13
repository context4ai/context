import { existsSync } from "node:fs";
import { readApprovedStructureValue } from "./approvedFileRead.js";
import { reuseCommandFileRead } from "./commandReadCache.js";
import { join } from "node:path";
import YAML from "yaml";
import { validateArticleStructureEntries } from "@c4a/context";
import { readerKnowledgeDescription } from "./packageKnowledgeProjection.js";
import { ensureMarkdownPageTitle } from "./markdownPageTitle.js";

const STRUCTURE_PATH = join("knowledge", "structure.yaml");
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;
// Approved Markdown is the reader-facing source. Machine identity, source
// ownership, and incremental-recovery state live once in structure.yaml and
// are hydrated only while Context is running.
const COMPACT_FIELDS = new Set([
  "title",
  "type",
  "description",
  "tags",
  "timestamp",
  "resource",
  "deprecated",
]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseFrontmatter(content: string): { record: Record<string, unknown>; body: string } | undefined {
  const match = FRONTMATTER_RE.exec(content);
  if (match?.[1] === undefined) return undefined;
  try {
    const parsed = YAML.parse(match[1]) as unknown;
    if (!isRecord(parsed)) return undefined;
    return { record: parsed, body: content.slice(match[0].length) };
  } catch {
    return undefined;
  }
}

export interface ApprovedKnowledgeMetadataIndex {
  structure?: Record<string, unknown>;
  byPath: ReadonlyMap<string, Record<string, unknown>>;
  byArticleId: ReadonlyMap<string, Record<string, unknown>>;
}

export function approvedKnowledgeMetadataIndex(
  structure: Record<string, unknown> | undefined,
): ApprovedKnowledgeMetadataIndex {
  const byPath = new Map<string, Record<string, unknown>>();
  const byArticleId = new Map<string, Record<string, unknown>>();
  for (const article of validateArticleStructureEntries(structure?.articles ?? [])) {
    const metadata = { collection: article.collection, visibility: article.visibility };
    byPath.set(article.path, metadata);
    byArticleId.set(article.article_id, metadata);
  }
  return { ...(structure === undefined ? {} : { structure }), byPath, byArticleId };
}

export async function readApprovedKnowledgeMetadataIndex(
  projectRoot: string,
  structureOverride?: Record<string, unknown>,
): Promise<ApprovedKnowledgeMetadataIndex> {
  if (structureOverride !== undefined) return approvedKnowledgeMetadataIndex(structureOverride);
  const path = join(projectRoot, STRUCTURE_PATH);
  if (!existsSync(path)) return approvedKnowledgeMetadataIndex(undefined);
  try {
    return await reuseCommandFileRead({ key: "approved-knowledge-metadata", paths: [path], read: async () => {
      const parsed = await readApprovedStructureValue(projectRoot);
      if (!isRecord(parsed)) throw new TypeError("Knowledge structure must be an object");
      return approvedKnowledgeMetadataIndex(parsed);
    } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return approvedKnowledgeMetadataIndex(undefined);
    throw error;
  }
}

export function hydrateApprovedFrontmatter(input: {
  frontmatter: Record<string, unknown>;
  relPath: string;
  metadata: ApprovedKnowledgeMetadataIndex;
}): Record<string, unknown> {
  const machine = input.metadata.byPath.get(input.relPath);
  return machine === undefined ? input.frontmatter : { ...input.frontmatter, ...machine };
}

export function hydrateApprovedKnowledgeMarkdown(input: {
  content: string;
  relPath: string;
  metadata: ApprovedKnowledgeMetadataIndex;
}): string {
  const parsed = parseFrontmatter(input.content);
  if (parsed === undefined) return input.content;
  const frontmatter = hydrateApprovedFrontmatter({
    frontmatter: parsed.record,
    relPath: input.relPath,
    metadata: input.metadata,
  });
  if (Object.keys(frontmatter).length === Object.keys(parsed.record).length &&
    Object.keys(frontmatter).every((key) => frontmatter[key] === parsed.record[key])) {
    return input.content;
  }
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n${parsed.body}`;
}

export function isIndexerApprovedKnowledgeMarkdown(content: string): boolean {
  const parsed = parseFrontmatter(content);
  if (parsed === undefined) return false;
  return /<!-- context:section id="/u.test(parsed.body);
}

export function compactApprovedKnowledgeMarkdown(content: string): string {
  const parsed = parseFrontmatter(content);
  if (parsed === undefined) return content;
  const compact = Object.fromEntries(Object.entries(parsed.record).filter(([field]) => COMPACT_FIELDS.has(field)));
  compact.description = readerKnowledgeDescription({
    description: compact.description,
    markdown: parsed.body,
    ...(typeof compact.title === "string" ? { title: compact.title } : {}),
  });
  return `---\n${YAML.stringify(compact).trimEnd()}\n---\n${parsed.body}`;
}

export function ensureApprovedKnowledgePresentation(content: string): string {
  const parsed = parseFrontmatter(content);
  if (parsed === undefined) return content;
  const title = typeof parsed.record.title === "string" ? parsed.record.title : undefined;
  const body = title === undefined ? parsed.body : ensureMarkdownPageTitle(parsed.body, title);
  const description = readerKnowledgeDescription({
    description: parsed.record.description,
    markdown: body,
    ...(title === undefined ? {} : { title }),
  });
  if (parsed.record.description === description && parsed.body === body) return content;
  return `---\n${YAML.stringify({ ...parsed.record, description }).trimEnd()}\n---\n${body}`;
}
