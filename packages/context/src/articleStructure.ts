import { createHash } from "node:crypto";
import { z } from "zod";
import { KNOWLEDGE_COLLECTIONS, type KnowledgeCollection } from "./contracts.js";
import { indexerDigestSchema, portableIndexerPathSchema } from "./indexerProtocolCommon.js";

// These are article references, not a second parser-fact or entity ledger.
export const articleSourceLocatorSchema = z.object({
  path: portableIndexerPathSchema,
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
}).strict().superRefine((value, context) => {
  if (value.end_line < value.start_line) context.addIssue({
    code: z.ZodIssueCode.custom, path: ["end_line"],
    message: "end_line must not precede start_line",
  });
});

export const articleSourceReferenceSchema = z.object({
  source_ref: z.string().min(1),
  locator: articleSourceLocatorSchema,
  content_digest: indexerDigestSchema,
}).strict();

export const articleSectionSchema = z.object({
  id: z.string().min(1),
  references: z.array(articleSourceReferenceSchema).max(3),
}).strict();

export const articleStructureEntrySchema = z.object({
  article_id: z.string().min(1),
  path: portableIndexerPathSchema,
  collection: z.custom<KnowledgeCollection>((value) =>
    typeof value === "string" && (KNOWLEDGE_COLLECTIONS as readonly string[]).includes(value)),
  visibility: z.string().min(1),
  sections: z.array(articleSectionSchema),
}).strict();

export type ArticleSourceLocator = z.infer<typeof articleSourceLocatorSchema>;
export type ArticleSourceReference = z.infer<typeof articleSourceReferenceSchema>;
export type ArticleStructureEntry = z.infer<typeof articleStructureEntrySchema>;

/** Merge repeated citations without dropping distinct source regions. A fragment
 * over the agreed limit must be split by its author, never silently truncated. */
export function articleFragmentReferences(values: readonly ArticleSourceReference[]): ArticleSourceReference[] {
  const unique = new Map<string, ArticleSourceReference>();
  for (const value of values) {
    const reference = articleSourceReferenceSchema.parse(value);
    unique.set(JSON.stringify(reference), reference);
  }
  return articleSectionSchema.shape.references.parse([...unique.values()]);
}

/** Captured text is read as UTF-8. Line endings are normalized consistently
 * for both initial capture and comparisons; no whitespace/content is trimmed. */
function sourceLines(text: string): string[] {
  return text.replace(/\r\n/gu, "\n").split("\n");
}

export function articleSourceRegion(text: string, locator: ArticleSourceLocator): string {
  const parsed = articleSourceLocatorSchema.parse(locator);
  const lines = sourceLines(text);
  if (parsed.end_line > lines.length) throw new RangeError("Source region exceeds captured text");
  return lines.slice(parsed.start_line - 1, parsed.end_line).join("\n");
}

export function articleSourceRegionDigest(text: string, locator: ArticleSourceLocator): string {
  return `sha256:${createHash("sha256").update(articleSourceRegion(text, locator), "utf8").digest("hex")}`;
}

/** The caller supplies the authorized captured source, not an arbitrary path
 * read from an Agent payload. Digests are always computed by the tool. */
export function createArticleSourceReference(
  source_ref: string, locator: ArticleSourceLocator, capturedText: string,
): ArticleSourceReference {
  return articleSourceReferenceSchema.parse({ source_ref, locator,
    content_digest: articleSourceRegionDigest(capturedText, locator) });
}

export function validateArticleStructureEntries(value: unknown): ArticleStructureEntry[] {
  const articles = z.array(articleStructureEntrySchema).parse(value);
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const article of articles) {
    if (ids.has(article.article_id) || paths.has(article.path)) {
      throw new TypeError("Article identity and path must each be unique");
    }
    ids.add(article.article_id);
    paths.add(article.path);
    if (new Set(article.sections.map(section => section.id)).size !== article.sections.length) {
      throw new TypeError(`Repeated fragment identity in ${article.path}`);
    }
  }
  return articles;
}

/** Only a unique unchanged region can be relocated without semantic input.
 * Changed, missing or ambiguous regions return null for the existing review
 * path; they are never silently treated as current. The caller still examines
 * source changes outside citations for new topics and indirect effects. */
export function relocateUnchangedArticleRegion(
  oldText: string, newText: string, locator: ArticleSourceLocator,
): ArticleSourceLocator | null {
  const region = articleSourceRegion(oldText, locator);
  if (oldText === newText) return { ...locator };
  return locateArticleRegion(region, newText, locator.path);
}

/** Locate a saved cited region without reconstructing or scanning parser facts. */
export function locateArticleRegion(regionText: string, newText: string, path: string): ArticleSourceLocator | null {
  const region = sourceLines(regionText);
  const next = sourceLines(newText);
  let found: number | undefined;
  for (let start = 0; start + region.length <= next.length; start += 1) {
    if (!region.every((line, offset) => next[start + offset] === line)) continue;
    if (found !== undefined) return null;
    found = start;
  }
  return found === undefined ? null : {
    path, start_line: found + 1, end_line: found + region.length,
  };
}
