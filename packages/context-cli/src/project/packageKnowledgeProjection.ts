import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ensureMarkdownPageTitle } from "./markdownPageTitle.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;
const CONTEXT_METADATA_BLOCK_RE = /<!--\s*context:(summary|source_refs|audit)\b[\s\S]*?\/context:\1\s*-->[ \t]*(?:\r?\n){0,2}/giu;
const CONTEXT_SECTION_OPEN_RE = /^[ \t]*<!--\s*context:section\b[^>]*-->[ \t]*(?:\r?\n){0,2}/gimu;
const CONTEXT_SECTION_CLOSE_RE = /(?:\r?\n)?^[ \t]*<!--\s*\/context:section\s*-->[ \t]*(?:\r?\n){0,2}/gimu;
const LARK_RESOURCE_LOCATOR_COMMENT_RE = /[ \t]*<!--\s*lark:[^>\r\n]+-->[ \t]*/giu;
const PACKAGE_OMITTED_FIELDS = [
  "node_ref",
  "view_ref",
  "structure_digest",
  "node_type",
  "node_tags",
  "generated",
  "children",
  "visibility",
  "code_symbols",
  "code_evidence",
  "relationship_mode",
  "code_edges",
  "candidate_fingerprint",
  "indexer_compile_digest",
  "indexer_file_digest",
  "indexer_artifact_ref",
  "indexer_section_refs",
  "indexer_source_ref",
  "resource",
  "sources",
  "context_revision",
  "context_optimization",
  "context_overlay",
] as const;
const PACKAGE_INVENTORY_FIELDS = [
  "node_type",
  "node_tags",
  "generated",
  "visibility",
  "code_symbols",
  "candidate_fingerprint",
] as const;
const COMPILER_ONLY_TAGS = new Set(["docs", "prose", "parent-index"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string =>
    typeof item === "string" && item.trim().length > 0
  );
}

export function parseKnowledgeFrontmatter(content: string): Record<string, unknown> {
  const match = FRONTMATTER_RE.exec(content);
  if (match?.[1] === undefined) return {};
  try {
    const parsed = parseYaml(match[1]) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isSourceRoutingTag(tag: string, sources: readonly string[]): boolean {
  return sources.some((source) => {
    const separator = source.indexOf(":");
    if (separator < 0) return false;
    const locator = source.slice(separator + 1);
    return locator.startsWith(`${tag}/`);
  });
}

function projectedTags(frontmatter: Record<string, unknown>): string[] {
  const sources = stringList(frontmatter.sources);
  const declaredTags = stringList(frontmatter.tags);
  const readerTags = declaredTags.includes("indexer") ? [] : declaredTags;
  return [...new Set([
    ...readerTags.filter((tag) =>
      !COMPILER_ONLY_TAGS.has(tag) && !isSourceRoutingTag(tag, sources)
    ),
    ...stringList(frontmatter.node_tags),
  ])];
}

export function packageKnowledgeDescription(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (/^(?:content|contract|catalog) Artifact from .+indexer\.$/iu.test(normalized)) return undefined;
  const withoutGeneratedInventory = normalized.replace(
    /^This unit describes \d+ exported declarations? backed by \d+ source files?\.\s*/iu,
    "",
  ).trim();
  if (withoutGeneratedInventory !== normalized) {
    return withoutGeneratedInventory.length > 0 ? withoutGeneratedInventory : undefined;
  }
  if (/^Reachable edges:\s[\s\S]*\.\s*$/u.test(normalized)) return undefined;
  const withoutGeneratedEdges = normalized.replace(/\s+Reachable edges:\s[\s\S]*\.\s*$/u, "").trim();
  if (withoutGeneratedEdges.length > 0) return withoutGeneratedEdges;
  return normalized;
}

function markdownDescription(markdown: string): string | undefined {
  const lines = markdown
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/```[\s\S]*?```/gu, "")
    .split(/\r?\n/u);
  let paragraph: string[] = [];
  const finishParagraph = (): string | undefined => {
    const plain = paragraph.join(" ")
      .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
      .replace(/[`*_~]/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
    paragraph = [];
    if (
      plain.length === 0 ||
      /^This unit describes \d+ exported declarations? backed by \d+ source files?\.?$/iu.test(plain)
    ) return undefined;
    if (plain.length <= 280) return plain;
    const shortened = plain.slice(0, 277).replace(/\s+\S*$/u, "").trimEnd();
    return `${shortened.length > 0 ? shortened : plain.slice(0, 277)}...`;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      const result = finishParagraph();
      if (result !== undefined) return result;
      continue;
    }
    if (
      /^#{1,6}\s/u.test(line) ||
      /^(?:[-*_]){3,}$/u.test(line) ||
      /^\|/u.test(line) ||
      /^[-*+]\s/u.test(line) ||
      /^\d+[.)]\s/u.test(line) ||
      /^!/u.test(line)
    ) {
      const result = finishParagraph();
      if (result !== undefined) return result;
      continue;
    }
    paragraph.push(line);
  }
  return finishParagraph();
}

export function readerKnowledgeDescription(input: {
  description: unknown;
  markdown: string;
  title?: string;
}): string {
  const current = packageKnowledgeDescription(input.description);
  if (typeof current === "string" && current.length > 0) return current;
  return markdownDescription(input.markdown) ?? input.title?.trim() ?? "Knowledge page";
}

export function packageKnowledgeFrontmatter(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const projected = { ...frontmatter };
  for (const field of PACKAGE_OMITTED_FIELDS) delete projected[field];
  const description = packageKnowledgeDescription(projected.description);
  if (description === undefined) delete projected.description;
  else projected.description = description;
  const tags = projectedTags(frontmatter);
  if (tags.length > 0) projected.tags = tags;
  else delete projected.tags;
  return projected;
}

export function packageKnowledgeMetadata(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  for (const field of PACKAGE_INVENTORY_FIELDS) {
    if (frontmatter[field] !== undefined) metadata[field] = frontmatter[field];
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function projectPackageKnowledgeMarkdown(content: string): string {
  const match = FRONTMATTER_RE.exec(content);
  if (match === null) return content;
  const frontmatter = parseKnowledgeFrontmatter(content);
  if (Object.keys(frontmatter).length === 0) return content;
  const body = content
    .slice(match[0].length)
    .replace(CONTEXT_METADATA_BLOCK_RE, "")
    .replace(CONTEXT_SECTION_OPEN_RE, "")
    .replace(CONTEXT_SECTION_CLOSE_RE, "\n")
    .replace(LARK_RESOURCE_LOCATOR_COMMENT_RE, "");
  const title = typeof frontmatter.title === "string" ? frontmatter.title : undefined;
  const projected = packageKnowledgeFrontmatter(frontmatter);
  projected.description = readerKnowledgeDescription({
    description: projected.description,
    markdown: body,
    ...(title === undefined ? {} : { title }),
  });
  const yaml = stringifyYaml(projected).trimEnd();
  const readerBody = title === undefined ? body : `\n${ensureMarkdownPageTitle(body, title)}\n`;
  return `---\n${yaml}\n---\n${readerBody}`;
}
