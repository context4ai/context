import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { join } from "node:path";
import YAML from "yaml";

const STRUCTURE_PATH = join("knowledge", "structure.yaml");
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;
const COMPACT_FIELDS = new Set([
  "title",
  "type",
  "description",
  "tags",
  "timestamp",
  "node_ref",
  "view_ref",
  "sources",
  "resource",
  "deprecated",
  // Keep a small recovery capsule in each page. These fields are cheap, make
  // an invalid or deleted structure.yaml rebuildable, and avoid making the
  // generated projection the only copy of page identity and containment.
  "node_type",
  "node_tags",
  "generated",
  "children",
  "structure_digest",
  "relationship_mode",
  "evidence_status",
  "indexer_compile_digest",
  "indexer_file_digest",
  "indexer_artifact_ref",
  "indexer_section_refs",
  "indexer_source_ref",
  "indexer_evidence",
]);
const STRUCTURED_FIELDS = new Set([
  "node_type",
  "node_tags",
  "generated",
  "children",
  "relationship_mode",
  "code_edges",
  "evidence_status",
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
    !COMPACT_FIELDS.has(field) && !STRUCTURED_FIELDS.has(field)
  ));
  if (metadata.context_optimization !== undefined) {
    metadata.context_optimization = compactOptimizationState(metadata.context_optimization);
  }
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

function compactOptimizationState(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.sections)) return value;
  const policies = Object.values(value.sections).flatMap((section) =>
    isRecord(section) && typeof section.policy_digest === "string" ? [section.policy_digest] : []
  );
  if (policies.length < 2) return value;
  const counts = new Map<string, number>();
  for (const policy of policies) counts.set(policy, (counts.get(policy) ?? 0) + 1);
  const defaultPolicy = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
  if (defaultPolicy === undefined) return value;
  return {
    ...value,
    policy_digest: defaultPolicy,
    sections: Object.fromEntries(Object.entries(value.sections).map(([id, section]) => {
      if (!isRecord(section) || section.policy_digest !== defaultPolicy) return [id, section];
      const { policy_digest: omitted, ...rest } = section;
      void omitted;
      return [id, rest];
    })),
  };
}

function expandOptimizationState(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.sections) || typeof value.policy_digest !== "string") return value;
  const { policy_digest: defaultPolicy, ...rest } = value;
  return {
    ...rest,
    sections: Object.fromEntries(Object.entries(value.sections).map(([id, section]) => [
      id,
      isRecord(section) && section.policy_digest === undefined
        ? { ...section, policy_digest: defaultPolicy }
        : section,
    ])),
  };
}

function expandedMachineMetadata(machine: Record<string, unknown>): Record<string, unknown> {
  const expanded: Record<string, unknown> = {
    ...machine,
    ...(machine.context_optimization === undefined
      ? {}
      : { context_optimization: expandOptimizationState(machine.context_optimization) }),
  };
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
  return {
    ...hydratedMachine,
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
  const digest = /^sha256:[a-f0-9]{64}$/u;
  return typeof parsed.record.indexer_compile_digest === "string" &&
    digest.test(parsed.record.indexer_compile_digest) &&
    typeof parsed.record.indexer_file_digest === "string" &&
    digest.test(parsed.record.indexer_file_digest) &&
    parsed.record.candidate_fingerprint === parsed.record.indexer_file_digest;
}

export function compactApprovedKnowledgeMarkdown(content: string): string {
  const parsed = parseFrontmatter(content);
  if (parsed === undefined) return content;
  const indexerPage = typeof parsed.record.indexer_file_digest === "string";
  const compact = Object.fromEntries(Object.entries(parsed.record).filter(([field]) =>
    COMPACT_FIELDS.has(field) || (indexerPage && field === "candidate_fingerprint")
  ));
  return `---\n${YAML.stringify(compact).trimEnd()}\n---\n${parsed.body}`;
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
