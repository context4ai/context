import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import YAML from "yaml";
import { approvedKnowledgeInputHash } from "./close.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import { walkApprovedMarkdown } from "./verifyProjectFiles.js";
import type {
  AlignDiagnostic,
  AlignPayload,
  StructureEdgePlan,
} from "./proseAlignTypes.js";

const APPROVED_STRUCTURE_PATH = join("knowledge", "structure.yaml");
const KNOWLEDGE_ROOT = "knowledge";

interface ApprovedStructureNode {
  node_ref: string;
  title: string;
  node_type: string;
  tags: string[];
}

interface ApprovedStructureView {
  view_ref: string;
  node_ref: string;
  collection: string;
  title: string;
  node_type: string;
  containment: string;
  slug: string;
  path: string;
}

interface ApprovedStructureSection {
  id: string;
  section_ref: string;
  kind: string;
  source_refs: string[];
}

export interface ExistingApprovedStructureSummary {
  present: boolean;
  path: string;
  counts: {
    nodes: number;
    views: number;
    sections: number;
    edges: number;
  };
  reusable: {
    node_refs: string[];
    view_refs: string[];
    section_refs: string[];
  };
  duplicate_or_unresolved: Array<{
    kind: "node" | "view";
    planned_ref: string;
    approved_ref?: string;
    reason: string;
    title?: string;
    path?: string;
  }>;
  related_edges: Array<StructureEdgePlan & { source_ref_count: number }>;
  diagnostics: string[];
}

interface ExistingApprovedStructureIndex {
  nodes: Map<string, ApprovedStructureNode>;
  views: Map<string, ApprovedStructureView>;
  sections: Map<string, ApprovedStructureSection>;
  edges: StructureEdgePlan[];
  diagnostics: string[];
}

export interface ExistingKnowledgeNode {
  node_ref: string;
  title: string;
  node_type: string;
  tags: string[];
  collections: string[];
  view_refs: string[];
  section_count: number;
}

export interface ExistingKnowledgeCatalog {
  present: boolean;
  counts: {
    nodes: number;
    views: number;
    sections: number;
    edges: number;
  };
  available: {
    collections: string[];
    node_types: string[];
    tags: string[];
  };
  nodes: ExistingKnowledgeNode[];
  diagnostics: string[];
}

function uniqueRefs(refs: readonly string[]): string[] {
  return [...new Set(refs)].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function normalizedLabel(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function toPosixPath(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}

async function approvedMarkdownFiles(projectRoot: string): Promise<string[]> {
  const root = join(projectRoot, KNOWLEDGE_ROOT);
  return (await walkApprovedMarkdown(root)).map((file) => file.absPath);
}

function frontmatterRecord(markdown: string): Record<string, unknown> | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(markdown);
  if (match === null) return undefined;
  const parsed = YAML.parse(match[1] ?? "") as unknown;
  return isRecord(parsed) ? parsed : undefined;
}

function isDeprecatedApprovedPage(markdown: string): boolean {
  return /^deprecated:\s*true\s*$/mu.test(markdown);
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function canonicalizeApprovedSourceRef(ref: string, sources: readonly string[]): string {
  const match = /^src-(\d+)(#.+)$/u.exec(ref);
  if (match === null) return ref;
  const source = sources[Number(match[1]) - 1];
  return source === undefined ? ref : `${source}${match[2]}`;
}

function pathLocation(relPath: string): { collection: string; containment: string; slug: string } {
  const parts = relPath.split("/");
  const collection = parts[0] ?? "architecture";
  const fileName = parts.at(-1) ?? "index.md";
  const slug = basename(fileName, ".md") || "index";
  const containment = parts.slice(1, -1).join("/") || "root";
  return { collection, containment, slug };
}

async function parseExistingApprovedMarkdown(projectRoot: string): Promise<ExistingApprovedStructureIndex> {
  const nodes = new Map<string, ApprovedStructureNode>();
  const views = new Map<string, ApprovedStructureView>();
  const sections = new Map<string, ApprovedStructureSection>();
  for (const filePath of await approvedMarkdownFiles(projectRoot)) {
    const markdown = await readFile(filePath, "utf8");
    if (isDeprecatedApprovedPage(markdown)) continue;
    const frontmatter = frontmatterRecord(markdown) ?? {};
    const nodeRef = typeof frontmatter?.node_ref === "string" && frontmatter.node_ref.length > 0
      ? frontmatter.node_ref
      : undefined;
    const viewRef = typeof frontmatter?.view_ref === "string" && frontmatter.view_ref.length > 0
      ? frontmatter.view_ref
      : undefined;
    const title = typeof frontmatter?.title === "string" && frontmatter.title.length > 0
      ? frontmatter.title
      : nodeRef;
    const nodeType = typeof frontmatter?.node_type === "string" && frontmatter.node_type.length > 0
      ? frontmatter.node_type
      : undefined;
    if (nodeRef === undefined || viewRef === undefined || title === undefined || nodeType === undefined) continue;
    const nodeTags = uniqueRefs([
      ...stringArrayField(frontmatter.node_tags),
      ...stringArrayField(frontmatter.tags),
    ]);
    const existingNode = nodes.get(nodeRef);
    nodes.set(nodeRef, {
      node_ref: nodeRef,
      title: existingNode?.title ?? title,
      node_type: existingNode?.node_type ?? nodeType,
      tags: uniqueRefs([...(existingNode?.tags ?? []), ...nodeTags]),
    });
    const relPath = toPosixPath(relative(join(projectRoot, KNOWLEDGE_ROOT), filePath));
    const location = pathLocation(relPath);
    const collection = viewRef.split(":", 1)[0] ?? location.collection;
    views.set(viewRef, {
      view_ref: viewRef,
      node_ref: nodeRef,
      collection,
      title,
      node_type: nodeType,
      containment: location.containment,
      slug: location.slug,
      path: relPath,
    });
    const sources = stringArrayField(frontmatter.sources);
    for (const section of approvedContextSectionsInMarkdown(markdown)) {
      if (section.id === undefined || section.kind === undefined) continue;
      const sectionRef = `${viewRef}#${section.id}`;
      sections.set(sectionRef, {
        id: section.id,
        section_ref: sectionRef,
        kind: section.kind,
        source_refs: uniqueRefs(section.refs.map((ref) => canonicalizeApprovedSourceRef(ref, sources))),
      });
    }
  }
  return { nodes, views, sections, edges: [], diagnostics: [] };
}

async function readFreshApprovedStructureEdges(projectRoot: string): Promise<{
  edges: StructureEdgePlan[];
  diagnostics: string[];
}> {
  const absolutePath = join(projectRoot, APPROVED_STRUCTURE_PATH);
  if (!existsSync(absolutePath)) return { edges: [], diagnostics: [] };
  let raw: unknown;
  try {
    raw = YAML.parse(await readFile(absolutePath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { edges: [], diagnostics: [`knowledge/structure.yaml could not be parsed: ${message}`] };
  }
  if (!isRecord(raw) || raw.schema_version !== "context.approved-structure.v1") {
    return { edges: [], diagnostics: ["knowledge/structure.yaml schema is not current; approved summary uses Markdown projection only."] };
  }
  const expectedInputHash = await approvedKnowledgeInputHash(projectRoot).catch(() => undefined);
  if (expectedInputHash === undefined || raw.input_hash !== expectedInputHash) {
    return { edges: [], diagnostics: ["knowledge/structure.yaml is stale; approved summary uses Markdown projection only."] };
  }
  return { edges: parseApprovedEdges(raw), diagnostics: [] };
}

export function emptyExistingApprovedStructureSummary(diagnostics: string[] = []): ExistingApprovedStructureSummary {
  return {
    present: false,
    path: APPROVED_STRUCTURE_PATH,
    counts: {
      nodes: 0,
      views: 0,
      sections: 0,
      edges: 0,
    },
    reusable: {
      node_refs: [],
      view_refs: [],
      section_refs: [],
    },
    duplicate_or_unresolved: [],
    related_edges: [],
    diagnostics,
  };
}

function parseApprovedEdges(raw: Record<string, unknown>): StructureEdgePlan[] {
  const edges: StructureEdgePlan[] = [];
  for (const rawEdge of Array.isArray(raw.edges) ? raw.edges : []) {
    if (!isRecord(rawEdge)) continue;
    const type = stringField(rawEdge, "type");
    const from = stringField(rawEdge, "from");
    const to = stringField(rawEdge, "to");
    const sourceRefs = stringArray(rawEdge.source_refs);
    const confidence = stringField(rawEdge, "confidence");
    const note = stringField(rawEdge, "note");
    if (type === undefined || from === undefined || to === undefined || sourceRefs.length === 0) continue;
    edges.push({
      type: type as StructureEdgePlan["type"],
      from,
      to,
      source_refs: sourceRefs,
      ...(confidence === "possible" || confidence === "hypothesis" ? { confidence } : {}),
      ...(note !== undefined ? { note } : {}),
    });
  }
  return edges;
}

export async function readExistingKnowledgeCatalog(projectRoot: string): Promise<ExistingKnowledgeCatalog> {
  const approved = await parseExistingApprovedMarkdown(projectRoot);
  const freshStructure = await readFreshApprovedStructureEdges(projectRoot);
  const viewsByNode = new Map<string, ApprovedStructureView[]>();
  for (const view of approved.views.values()) {
    const current = viewsByNode.get(view.node_ref) ?? [];
    current.push(view);
    viewsByNode.set(view.node_ref, current);
  }
  const sectionCountsByView = new Map<string, number>();
  for (const section of approved.sections.values()) {
    const separator = section.section_ref.lastIndexOf("#");
    const viewRef = separator < 0 ? section.section_ref : section.section_ref.slice(0, separator);
    sectionCountsByView.set(viewRef, (sectionCountsByView.get(viewRef) ?? 0) + 1);
  }
  const nodes = [...approved.nodes.values()]
    .map((node): ExistingKnowledgeNode => {
      const views = (viewsByNode.get(node.node_ref) ?? [])
        .sort((left, right) => left.view_ref.localeCompare(right.view_ref));
      return {
        node_ref: node.node_ref,
        title: node.title,
        node_type: node.node_type,
        tags: node.tags,
        collections: uniqueRefs(views.map((view) => view.collection)),
        view_refs: views.map((view) => view.view_ref),
        section_count: views.reduce((total, view) => total + (sectionCountsByView.get(view.view_ref) ?? 0), 0),
      };
    })
    .sort((left, right) => left.node_ref.localeCompare(right.node_ref));
  return {
    present: nodes.length > 0 || approved.views.size > 0 || approved.sections.size > 0,
    counts: {
      nodes: nodes.length,
      views: approved.views.size,
      sections: approved.sections.size,
      edges: freshStructure.edges.length,
    },
    available: {
      collections: uniqueRefs(nodes.flatMap((node) => node.collections)),
      node_types: uniqueRefs(nodes.map((node) => node.node_type)),
      tags: uniqueRefs(nodes.flatMap((node) => node.tags)),
    },
    nodes,
    diagnostics: freshStructure.diagnostics,
  };
}

export async function readExistingApprovedStructureSummary(input: {
  projectRoot: string;
  payload: AlignPayload;
}): Promise<ExistingApprovedStructureSummary> {
  const approved = await parseExistingApprovedMarkdown(input.projectRoot);
  const freshStructure = await readFreshApprovedStructureEdges(input.projectRoot);
  approved.edges = freshStructure.edges;
  approved.diagnostics.push(...freshStructure.diagnostics);
  if (approved.nodes.size === 0 && approved.views.size === 0 && approved.sections.size === 0 && !existsSync(join(input.projectRoot, APPROVED_STRUCTURE_PATH))) {
    return emptyExistingApprovedStructureSummary();
  }
  const endpointRefs = new Set<string>([
    ...input.payload.nodes.map((node) => node.node_ref),
    ...input.payload.views.map((view) => view.view_ref),
    ...input.payload.views.flatMap((view) => view.sections.map((section) => section.section_ref)),
  ]);
  const reusable = {
    node_refs: input.payload.nodes
      .map((node) => node.node_ref)
      .filter((nodeRef) => approved.nodes.has(nodeRef))
      .sort(),
    view_refs: input.payload.views
      .map((view) => view.view_ref)
      .filter((viewRef) => approved.views.has(viewRef))
      .sort(),
    section_refs: input.payload.views
      .flatMap((view) => view.sections.map((section) => section.section_ref))
      .filter((sectionRef) => approved.sections.has(sectionRef))
      .sort(),
  };

  const duplicateOrUnresolved: ExistingApprovedStructureSummary["duplicate_or_unresolved"] = [];
  for (const node of input.payload.nodes) {
    const approvedNode = approved.nodes.get(node.node_ref);
    if (approvedNode !== undefined) {
      if (approvedNode.node_type !== node.node_type) {
        duplicateOrUnresolved.push({
          kind: "node",
          planned_ref: node.node_ref,
          approved_ref: approvedNode.node_ref,
          reason: "same_node_ref_identity_mismatch",
          title: node.title,
        });
      } else if (normalizedLabel(approvedNode.title) !== normalizedLabel(node.title)) {
        duplicateOrUnresolved.push({
          kind: "node",
          planned_ref: node.node_ref,
          approved_ref: approvedNode.node_ref,
          reason: "same_node_ref_title_mismatch",
          title: node.title,
        });
      }
      continue;
    }
    const title = normalizedLabel(node.title);
    const matching = [...approved.nodes.values()].find((approvedNode) => normalizedLabel(approvedNode.title) === title);
    if (matching !== undefined) {
      duplicateOrUnresolved.push({
        kind: "node",
        planned_ref: node.node_ref,
        approved_ref: matching.node_ref,
        reason: "same_title_different_node_ref",
        title: node.title,
      });
    }
  }
  for (const view of input.payload.views) {
    const approvedIdentity = approved.views.get(view.view_ref);
    if (approvedIdentity !== undefined) {
      if (approvedIdentity.path !== view.path) {
        duplicateOrUnresolved.push({
          kind: "view",
          planned_ref: view.view_ref,
          approved_ref: approvedIdentity.view_ref,
          reason: "same_view_ref_different_path",
          path: approvedIdentity.path,
        });
      }
      continue;
    }
    const samePath = [...approved.views.values()].find((approvedView) => approvedView.path === view.path);
    if (samePath !== undefined) {
      duplicateOrUnresolved.push({
        kind: "view",
        planned_ref: view.view_ref,
        approved_ref: samePath.view_ref,
        reason: "same_path_different_view_ref",
        path: view.path,
      });
      continue;
    }
    const sameTitleAndCollection = [...approved.views.values()].find((approvedView) =>
      approvedView.collection === view.collection &&
      normalizedLabel(approvedView.title) === normalizedLabel(view.title)
    );
    if (sameTitleAndCollection !== undefined) {
      duplicateOrUnresolved.push({
        kind: "view",
        planned_ref: view.view_ref,
        approved_ref: sameTitleAndCollection.view_ref,
        reason: "same_collection_title_different_view_ref",
        title: view.title,
      });
    }
  }

  return {
    present: true,
    path: APPROVED_STRUCTURE_PATH,
    counts: {
      nodes: approved.nodes.size,
      views: approved.views.size,
      sections: approved.sections.size,
      edges: approved.edges.length,
    },
    reusable,
    duplicate_or_unresolved: duplicateOrUnresolved,
    related_edges: approved.edges
      .filter((edge) => endpointRefs.has(edge.from) || endpointRefs.has(edge.to))
      .map((edge) => ({
        ...edge,
        source_refs: uniqueRefs(edge.source_refs),
        source_ref_count: edge.source_refs.length,
      })),
    diagnostics: approved.diagnostics,
  };
}

export async function readExistingApprovedEndpointRefs(projectRoot: string): Promise<Set<string>> {
  const endpoints = new Set<string>();
  for (const filePath of await approvedMarkdownFiles(projectRoot)) {
    const markdown = await readFile(filePath, "utf8");
    if (isDeprecatedApprovedPage(markdown)) continue;
    const frontmatter = frontmatterRecord(markdown);
    const nodeRef = typeof frontmatter?.node_ref === "string" ? frontmatter.node_ref : undefined;
    const viewRef = typeof frontmatter?.view_ref === "string" ? frontmatter.view_ref : undefined;
    if (nodeRef !== undefined && nodeRef.length > 0) endpoints.add(nodeRef);
    if (viewRef === undefined || viewRef.length === 0) continue;
    endpoints.add(viewRef);
    for (const section of approvedContextSectionsInMarkdown(markdown)) {
      if (section.id === undefined || section.id.length === 0) continue;
      endpoints.add(`${viewRef}#${section.id}`);
    }
  }
  return endpoints;
}

export function existingApprovedStructureDiagnostics(
  summary: ExistingApprovedStructureSummary | undefined,
): AlignDiagnostic[] {
  if (summary === undefined || !summary.present) return [];
  return summary.duplicate_or_unresolved.map((item): AlignDiagnostic => {
    const identityMismatch = item.reason === "same_node_ref_identity_mismatch";
    const titleMismatch = item.reason === "same_node_ref_title_mismatch";
    const pathIdentityConflict = item.reason === "same_path_different_view_ref";
    const viewPathConflict = item.reason === "same_view_ref_different_path";
    return {
      severity: identityMismatch ? "error" : "warning",
      code: identityMismatch
        ? "existing_approved.node_identity_mismatch"
        : titleMismatch
          ? "existing_approved.node_title_mismatch"
          : pathIdentityConflict
            ? "existing_approved.path_identity_conflict"
          : viewPathConflict
            ? "existing_approved.view_path_conflict"
          : "existing_approved.duplicate_or_unresolved",
      family: "duplicate",
      message: identityMismatch
        ? "Planned structure reuses an approved NodeRef with a different canonical node_type; use a different NodeRef or keep the approved node identity stable."
        : titleMismatch
          ? "Planned structure reuses an approved NodeRef with different display title metadata; reuse is allowed for another ViewRef, but prefer the approved canonical node title."
          : pathIdentityConflict
            ? "Planned structure assigns a new ViewRef to an approved knowledge path; preserve the approved ViewRef/NodeRef or choose a different path before confirmation."
          : viewPathConflict
            ? "Planned structure moves an approved ViewRef to a different knowledge path; preserve the approved path or request an explicit path migration before confirmation."
          : "Planned structure resembles existing approved knowledge; reuse the approved ref, add a source-backed edge, or keep an unresolved item before confirmation.",
      candidate_id: item.planned_ref,
      repair: {
        action: identityMismatch
          ? "keep_approved_node_type_or_use_new_node_ref"
          : titleMismatch
            ? "reuse_approved_node_ref_with_stable_title"
            : pathIdentityConflict
              ? "preserve_approved_path_identity"
            : viewPathConflict
              ? "preserve_approved_view_path"
            : "reuse_existing_or_record_unresolved",
        planned_ref: item.planned_ref,
        approved_ref: item.approved_ref,
        reason: item.reason,
      },
    };
  });
}
