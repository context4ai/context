import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { join } from "node:path";
import YAML from "yaml";
import { readerKnowledgeDescription } from "./packageKnowledgeProjection.js";
import { ensureMarkdownPageTitle } from "./markdownPageTitle.js";
import { isRuntimeOnlyKnowledgeMetadataField } from "./knowledgeMetadataPolicy.js";

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
const STRUCTURED_FIELDS = new Set([
  "node_ref",
  "view_ref",
  "sources",
  "node_type",
  "node_tags",
  "generated",
  "children",
  "relationship_mode",
  "evidence_status",
  "code_edges",
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

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function machineMetadata(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const metadata = Object.fromEntries(Object.entries(frontmatter).filter(([field]) =>
    !COMPACT_FIELDS.has(field) &&
    !STRUCTURED_FIELDS.has(field) &&
    !isRuntimeOnlyKnowledgeMetadataField(field)
  ));
  const symbols = stringList(metadata.code_symbols);
  if (symbols.length > 0) {
    const parts = symbols.map((symbol) => symbol.split("|"));
    const module = parts[0]?.[0];
    if (module !== undefined && parts.every((entry) => entry[0] === module && entry.length >= 3)) {
      metadata.code_symbol_table = {
        module,
        entries: parts.map((entry) => entry.slice(1).join("|")),
      };
      delete metadata.code_symbols;
    }
  }
  return metadata;
}

function expandedMachineMetadata(machine: Record<string, unknown>): Record<string, unknown> {
  const expanded: Record<string, unknown> = { ...machine };
  const symbolTable = machine.code_symbol_table;
  if (isRecord(symbolTable) && typeof symbolTable.module === "string") {
    const entries = stringList(symbolTable.entries);
    if (entries.length > 0) {
      expanded.code_symbols = entries.map((entry) => `${symbolTable.module}|${entry}`);
    }
    delete expanded.code_symbol_table;
  }
  return expanded;
}

function outgoingCodeEdges(
  structure: Record<string, unknown>,
  view: Record<string, unknown>,
): Record<string, unknown>[] {
  const endpoints = new Set<string>([
    ...(typeof view.node_ref === "string" ? [view.node_ref] : []),
    ...(typeof view.view_ref === "string" ? [view.view_ref] : []),
    ...(Array.isArray(view.sections)
      ? view.sections.flatMap((section) =>
          isRecord(section) && typeof section.section_ref === "string" ? [section.section_ref] : []
        )
      : []),
  ]);
  return Array.isArray(structure.edges)
    ? structure.edges.filter((edge): edge is Record<string, unknown> =>
        isRecord(edge) &&
        typeof edge.from === "string" &&
        endpoints.has(edge.from) &&
        (edge.relationship_mode === "source-backed-ast" || edge.relationship_mode === "source-backed-explicit")
      )
    : [];
}

function viewFrontmatter(
  structure: Record<string, unknown>,
  view: Record<string, unknown>,
): Record<string, unknown> {
  const machine = isRecord(view.machine) ? view.machine : {};
  const hydratedMachine = expandedMachineMetadata(machine);
  const codeEdges = outgoingCodeEdges(structure, view);
  const viewRef = typeof view.view_ref === "string" ? view.view_ref : undefined;
  const tags = Array.isArray(view.tags)
    ? view.tags
    : viewRef?.startsWith("view:artifact:") === true
      ? ["indexer"]
      : undefined;
  return {
    ...hydratedMachine,
    ...(typeof view.node_ref === "string" ? { node_ref: view.node_ref } : {}),
    ...(viewRef === undefined ? {} : { view_ref: viewRef }),
    ...(Array.isArray(view.sources) ? { sources: view.sources } : {}),
    ...(tags === undefined ? {} : { tags }),
    ...(typeof view.node_type === "string" ? { node_type: view.node_type } : {}),
    ...(Array.isArray(view.node_tags) ? { node_tags: view.node_tags } : {}),
    ...(view.generated !== undefined ? { generated: view.generated } : {}),
    ...(Array.isArray(view.children) ? { children: view.children } : {}),
    ...(typeof view.relationship_mode === "string" ? { relationship_mode: view.relationship_mode } : {}),
    ...(view.source_orphaned === true ? { evidence_status: "source-orphaned" } : {}),
    ...(codeEdges.length > 0 ? { code_edges: codeEdges } : {}),
  };
}

export interface ApprovedKnowledgeMetadataIndex {
  structure?: Record<string, unknown>;
  byPath: ReadonlyMap<string, Record<string, unknown>>;
  byViewRef: ReadonlyMap<string, Record<string, unknown>>;
}

export function approvedKnowledgeMetadataIndex(
  structure: Record<string, unknown> | undefined,
): ApprovedKnowledgeMetadataIndex {
  const byPath = new Map<string, Record<string, unknown>>();
  const byViewRef = new Map<string, Record<string, unknown>>();
  if (structure !== undefined && Array.isArray(structure.views)) {
    for (const view of structure.views) {
      if (!isRecord(view)) continue;
      const metadata = viewFrontmatter(structure, view);
      if (typeof view.path === "string") byPath.set(view.path, metadata);
      if (typeof view.view_ref === "string") byViewRef.set(view.view_ref, metadata);
    }
  }
  return { ...(structure === undefined ? {} : { structure }), byPath, byViewRef };
}

export async function readApprovedKnowledgeMetadataIndex(
  projectRoot: string,
  structureOverride?: Record<string, unknown>,
): Promise<ApprovedKnowledgeMetadataIndex> {
  if (structureOverride !== undefined) return approvedKnowledgeMetadataIndex(structureOverride);
  const path = join(projectRoot, STRUCTURE_PATH);
  if (!existsSync(path)) return approvedKnowledgeMetadataIndex(undefined);
  try {
    const parsed = YAML.parse(await readFile(path, "utf8")) as unknown;
    return approvedKnowledgeMetadataIndex(isRecord(parsed) ? parsed : undefined);
  } catch {
    return approvedKnowledgeMetadataIndex(undefined);
  }
}

export function hydrateApprovedFrontmatter(input: {
  frontmatter: Record<string, unknown>;
  relPath: string;
  metadata: ApprovedKnowledgeMetadataIndex;
}): Record<string, unknown> {
  const viewRef = typeof input.frontmatter.view_ref === "string" ? input.frontmatter.view_ref : undefined;
  const machine = input.metadata.byPath.get(input.relPath) ??
    (viewRef === undefined ? undefined : input.metadata.byViewRef.get(viewRef));
  return machine === undefined ? input.frontmatter : { ...machine, ...input.frontmatter };
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
  return typeof parsed.record.view_ref === "string" &&
    parsed.record.view_ref.startsWith("view:artifact:");
}

export function compactApprovedKnowledgeMarkdown(content: string): string {
  const parsed = parseFrontmatter(content);
  if (parsed === undefined) return content;
  const indexerPage = typeof parsed.record.indexer_file_digest === "string" ||
    (typeof parsed.record.view_ref === "string" && parsed.record.view_ref.startsWith("view:artifact:"));
  const compact = Object.fromEntries(Object.entries(parsed.record).filter(([field]) =>
    COMPACT_FIELDS.has(field) && !(indexerPage && field === "tags")
  ));
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

export function approvedViewMachineMetadata(frontmatter: Record<string, unknown>): Record<string, unknown> | undefined {
  const metadata = machineMetadata(frontmatter);
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export async function persistApprovedMachineMetadata(input: {
  projectRoot: string;
  relPath: string;
  content: string;
}): Promise<boolean> {
  const structurePath = join(input.projectRoot, STRUCTURE_PATH);
  if (!existsSync(structurePath)) return false;
  const parsedContent = parseFrontmatter(input.content);
  if (parsedContent === undefined) return false;
  let structure: unknown;
  try {
    structure = YAML.parse(await readFile(structurePath, "utf8")) as unknown;
  } catch {
    return false;
  }
  if (!isRecord(structure) || !Array.isArray(structure.views)) return false;
  const viewRef = typeof parsedContent.record.view_ref === "string" ? parsedContent.record.view_ref : undefined;
  const view = structure.views.find((candidate) =>
    isRecord(candidate) &&
    (candidate.path === input.relPath || (viewRef !== undefined && candidate.view_ref === viewRef))
  );
  if (!isRecord(view)) return false;
  const machine = approvedViewMachineMetadata(parsedContent.record);
  if (machine === undefined) delete view.machine;
  else view.machine = machine;
  await atomicWriteFile(structurePath, YAML.stringify(structure));
  return true;
}
