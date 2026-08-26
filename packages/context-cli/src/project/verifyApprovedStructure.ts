import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { readConfirmedStructureEdgeProjection } from "./approvedStructureEdges.js";
import {
  approvedStructureInputHash,
  sha256Text,
  type ApprovedStructureInputFile,
} from "./approvedStructureInputHash.js";
import { PARENT_INDEX_GENERATED_KIND, type ParentIndexChild } from "./parentIndexView.js";
import { validateApprovedStructureEdgeRecords } from "./verifyApprovedStructureEdges.js";
import {
  isDeprecatedApprovedMarkdown,
  isRecord,
  nodeTypeFromFrontmatter,
  parentIndexChildren,
  parseFrontmatterLoose,
} from "./verifyFrontmatter.js";
import { isKnowledgeAssetPath, walkApprovedMarkdown } from "./verifyProjectFiles.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";
import type { ApprovedViewIssueContext, EvidenceIndexCache, SourceRegistryLookup } from "./verifySourceRefs.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import {
  codegraphEdgesFromFrontmatter,
  currentCodegraphEdges,
} from "./codegraphRelationshipProjection.js";
import { STRUCTURE_FILE as LIFECYCLE_STRUCTURE_PATH } from "./proseCompileConstants.js";
import { parseApprovedStructureSourceInputs } from "./approvedStructureInputs.js";
import {
  approvedKnowledgeMetadataIndex,
  compactApprovedKnowledgeMarkdown,
  hydrateApprovedKnowledgeMarkdown,
} from "./approvedKnowledgeMetadata.js";

const APPROVED_STRUCTURE_PATH = join("knowledge", "structure.yaml");
const APPROVED_STRUCTURE_SCHEMA_VERSION = "context.approved-structure.v1";
const LOCAL_REF = /^src-(\d+)(#(?:span|symbol):.+)$/u;

interface ApprovedStructureSectionProjection {
  id: string;
  kind: string;
  sectionRef: string;
  sourceRefs: string[];
  contentMode?: string;
  summary?: string;
}

interface ApprovedStructureViewProjection {
  viewRef: string;
  nodeRef: string;
  collection: string;
  containment: string;
  slug: string;
  title: string;
  path: string;
  nodeType: string;
  sourceOrphaned: boolean;
  generated?: string;
  summary?: string;
  tags?: string[];
  nodeTags?: string[];
  sources: string[];
  sections: ApprovedStructureSectionProjection[];
  sectionRefs: string[];
  relationshipMode?: string;
}

async function readApprovedStructureForVerify(input: {
  projectRoot: string;
  issues: ProjectVerifyIssue[];
  structureOverride?: Record<string, unknown>;
}): Promise<Record<string, unknown> | undefined> {
  if (input.structureOverride !== undefined) return input.structureOverride;
  const structurePath = join(input.projectRoot, APPROVED_STRUCTURE_PATH);
  if (!existsSync(structurePath)) return undefined;
  let rawParsed: unknown;
  try {
    rawParsed = YAML.parse(await readFile(structurePath, "utf8")) as unknown;
  } catch (error) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-invalid",
      path: APPROVED_STRUCTURE_PATH,
      message: `approved structure is invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
  if (isRecord(rawParsed)) return rawParsed;
  input.issues.push({
    severity: "error",
    code: "approved-structure-invalid",
    path: APPROVED_STRUCTURE_PATH,
    message: "approved structure must be a YAML object",
  });
  return undefined;
}

function approvedStructureEndpointRefs(input: Awaited<ReturnType<typeof approvedStructureProjection>>): Set<string> {
  return new Set<string>([
    ...input.nodes.map((node) => node.nodeRef),
    ...input.views.map((view) => view.viewRef),
    ...input.views.flatMap((view) => view.sectionRefs),
  ]);
}

function collectionFromViewRef(viewRef: string): string | undefined {
  const separator = viewRef.indexOf(":");
  return separator > 0 ? viewRef.slice(0, separator) : undefined;
}

function viewLocationFromRelPath(relPath: string): { collection: string; containment: string; slug: string } {
  const parts = relPath.split("/");
  const collection = parts[0] ?? "architecture";
  const bodyParts = parts.slice(1);
  const fileName = bodyParts.at(-1) ?? "index.md";
  const slug = fileName.replace(/\.md$/u, "") || "index";
  const containment = bodyParts.slice(0, -1).join("/") || "root";
  return { collection, containment, slug };
}

function canonicalizeSourceRef(ref: string, sources: readonly string[]): string {
  const match = LOCAL_REF.exec(ref);
  if (match === null) return ref;
  const index = Number(match[1]);
  const suffix = match[2];
  const source = sources[index - 1];
  return source === undefined || suffix === undefined ? ref : `${source}${suffix}`;
}

function approvedStructureEndpointContexts(input: Awaited<ReturnType<typeof approvedStructureProjection>>): Map<string, ApprovedViewIssueContext> {
  const contexts = new Map<string, ApprovedViewIssueContext>();
  for (const view of input.views) {
    const collection = collectionFromViewRef(view.viewRef);
    if (collection === undefined) continue;
    const context: ApprovedViewIssueContext = {
      collection,
      view_ref: view.viewRef,
      node_ref: view.nodeRef,
    };
    if (!contexts.has(view.nodeRef)) contexts.set(view.nodeRef, context);
    contexts.set(view.viewRef, context);
    for (const sectionRef of view.sectionRefs) {
      contexts.set(sectionRef, context);
    }
  }
  return contexts;
}

function sameStringArray(left: unknown, right: readonly string[] | undefined): boolean {
  if (right === undefined) return left === undefined;
  return Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function validateApprovedStructureNodeProjection(input: {
  parsed: Record<string, unknown>;
  expectedNodes: readonly { nodeRef: string; title: string; nodeType: string; summary?: string; tags?: readonly string[] }[];
  issues: ProjectVerifyIssue[];
}): void {
  if (!Array.isArray(input.parsed.nodes)) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-nodes-invalid",
      path: APPROVED_STRUCTURE_PATH,
      message: "ready approved structure must include nodes[]",
    });
    return;
  }
  const expectedByRef = new Map(input.expectedNodes.map((node) => [node.nodeRef, node]));
  const actualByRef = new Map<string, Record<string, unknown>>();
  for (const [index, node] of input.parsed.nodes.entries()) {
    if (!isRecord(node) || typeof node.node_ref !== "string" || node.node_ref.trim().length === 0) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-invalid",
        path: APPROVED_STRUCTURE_PATH,
        message: "ready approved structure nodes[] must contain objects with non-empty node_ref",
      });
      continue;
    }
    actualByRef.set(node.node_ref, node);
    if (expectedByRef.has(node.node_ref)) continue;
    input.issues.push({
      severity: "error",
      code: "approved-structure-node-not-approved",
      path: APPROVED_STRUCTURE_PATH,
      message: `approved structure node ${index} does not correspond to an approved Markdown page: ${node.node_ref}`,
    });
  }
  for (const expected of input.expectedNodes) {
    const actual = actualByRef.get(expected.nodeRef);
    if (actual === undefined) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-missing",
        path: APPROVED_STRUCTURE_PATH,
        message: `ready approved structure is missing node projection for approved Markdown page: ${expected.nodeRef}`,
      });
      continue;
    }
    if (actual.title !== expected.title) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure node ${expected.nodeRef} title must be ${expected.title}`,
      });
    }
    if (actual.node_type !== expected.nodeType) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure node ${expected.nodeRef} node_type must be ${expected.nodeType}`,
      });
    }
    if (actual.summary !== expected.summary) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure node ${expected.nodeRef} summary must match approved Markdown frontmatter`,
      });
    }
    if (!sameStringArray(actual.tags, expected.tags)) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure node ${expected.nodeRef} tags must match approved Markdown frontmatter`,
      });
    }
  }
}

function validateApprovedStructureViewList(input: {
  parsed: Record<string, unknown>;
  viewRefs: ReadonlySet<string>;
  issues: ProjectVerifyIssue[];
}): void {
  if (!Array.isArray(input.parsed.views)) return;
  for (const [index, view] of input.parsed.views.entries()) {
    if (!isRecord(view) || typeof view.view_ref !== "string" || view.view_ref.trim().length === 0) continue;
    if (input.viewRefs.has(view.view_ref)) continue;
    input.issues.push({
      severity: "error",
      code: "approved-structure-node-not-approved",
      path: APPROVED_STRUCTURE_PATH,
      message: `approved structure view ${index} does not correspond to an approved Markdown page: ${view.view_ref}`,
    });
  }
}

function validateApprovedStructureShape(input: {
  parsed: Record<string, unknown>;
  expectedInputHash?: string;
  issues: ProjectVerifyIssue[];
}): void {
  if (input.parsed.schema_version !== APPROVED_STRUCTURE_SCHEMA_VERSION) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-invalid",
      path: APPROVED_STRUCTURE_PATH,
      message: `approved structure schema_version must be ${APPROVED_STRUCTURE_SCHEMA_VERSION}`,
    });
  }
  if (typeof input.parsed.input_hash !== "string" || input.parsed.input_hash.trim().length === 0) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-input-hash-invalid",
      path: APPROVED_STRUCTURE_PATH,
      message: "approved structure must include non-empty input_hash",
    });
  } else if (input.expectedInputHash !== undefined && input.parsed.input_hash !== input.expectedInputHash) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-input-hash-mismatch",
      path: APPROVED_STRUCTURE_PATH,
      message: "approved structure input_hash is stale; rerun deterministic close",
    });
  }
  if (!Array.isArray(input.parsed.nodes)) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-nodes-invalid",
      path: APPROVED_STRUCTURE_PATH,
      message: "approved structure must include nodes[]",
    });
  }
  if (!Array.isArray(input.parsed.views)) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-views-invalid",
      path: APPROVED_STRUCTURE_PATH,
      message: "approved structure must include views[]",
    });
  }
  if (!Array.isArray(input.parsed.edges)) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-edges-invalid",
      path: APPROVED_STRUCTURE_PATH,
      message: "approved structure must include edges[]",
    });
  }
}

async function approvedStructureProjection(
  projectRoot: string,
  parsedStructure?: Record<string, unknown>,
): Promise<{
  inputFiles: ApprovedStructureInputFile[];
  nodes: Array<{ nodeRef: string; title: string; nodeType: string; summary?: string; tags?: string[] }>;
  views: ApprovedStructureViewProjection[];
  parentIndexes: Array<{ viewRef: string; path: string; children: ParentIndexChild[] }>;
  codeEdges: Array<Record<string, unknown>>;
}> {
  const approvedFiles: Array<{ relPath: string; content: string }> = [];
  const views: ApprovedStructureViewProjection[] = [];
  const parentIndexes: Array<{ viewRef: string; path: string; children: ParentIndexChild[] }> = [];
  const codeEdges: Array<Record<string, unknown>> = [];
  for (const file of await walkApprovedMarkdown(join(projectRoot, "knowledge"))) {
    if (isKnowledgeAssetPath(file.relPath)) continue;
    const rawContent = await readFile(file.absPath, "utf8");
    if (isDeprecatedApprovedMarkdown(rawContent)) continue;
    const content = hydrateApprovedKnowledgeMarkdown({
      content: rawContent,
      relPath: file.relPath,
      metadata: approvedKnowledgeMetadataIndex(parsedStructure),
    });
    approvedFiles.push({
      relPath: file.relPath,
      content: compactApprovedKnowledgeMarkdown(rawContent),
    });
    const parts = file.relPath.split("/");
    if (parts.length < 2) continue;
    const location = viewLocationFromRelPath(file.relPath);
    const frontmatter = parseFrontmatterLoose(content);
    codeEdges.push(...codegraphEdgesFromFrontmatter(frontmatter, file.relPath));
    const nodeRef = typeof frontmatter.node_ref === "string" && frontmatter.node_ref.trim().length > 0
      ? frontmatter.node_ref.trim()
      : parts.slice(1).join("/").replace(/\.md$/u, "");
    const viewRef = typeof frontmatter.view_ref === "string" && frontmatter.view_ref.trim().length > 0
      ? frontmatter.view_ref.trim()
      : `${parts[0]}:${nodeRef}`;
    if (nodeRef.length === 0) continue;
    const nodeType = nodeTypeFromFrontmatter(frontmatter, nodeRef);
    const title = typeof frontmatter.title === "string" && frontmatter.title.trim().length > 0
      ? frontmatter.title.trim()
      : nodeRef;
    const summary = typeof frontmatter.description === "string" && frontmatter.description.trim().length > 0
      ? frontmatter.description.trim()
      : undefined;
    const tags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags.filter((item): item is string => typeof item === "string")
      : undefined;
    const nodeTags = Array.isArray(frontmatter.node_tags)
      ? frontmatter.node_tags.filter((item): item is string => typeof item === "string")
      : undefined;
    const sources = Array.isArray(frontmatter.sources)
      ? frontmatter.sources.filter((item): item is string => typeof item === "string")
      : [];
    const sections = approvedContextSectionsInMarkdown(content).map((section, index) => {
      const id = section.id ?? `section-${index + 1}`;
      return {
        id,
        kind: section.kind ?? "body",
        sectionRef: `${viewRef}#${id}`,
        sourceRefs: section.refs.map((ref) => canonicalizeSourceRef(ref, sources)),
        ...(section.contentMode !== undefined ? { contentMode: section.contentMode } : {}),
        ...(section.summary !== undefined ? { summary: section.summary } : {}),
      };
    });
    const sectionRefs = sections.map((section) => section.sectionRef);
    const children = parentIndexChildren(frontmatter);
    if (frontmatter.generated === PARENT_INDEX_GENERATED_KIND) {
      parentIndexes.push({ viewRef, path: file.relPath, children });
    }
    views.push({
      viewRef,
      nodeRef,
      collection: collectionFromViewRef(viewRef) ?? location.collection,
      containment: location.containment,
      slug: location.slug,
      title,
      path: file.relPath,
      nodeType,
      sourceOrphaned: frontmatter.evidence_status === "source-orphaned",
      ...(frontmatter.generated === PARENT_INDEX_GENERATED_KIND ? { generated: PARENT_INDEX_GENERATED_KIND } : {}),
      ...(summary !== undefined ? { summary } : {}),
      sectionRefs,
      sections,
      sources,
      ...(tags !== undefined ? { tags } : {}),
      ...(nodeTags !== undefined ? { nodeTags } : {}),
      ...(typeof frontmatter.relationship_mode === "string"
        ? { relationshipMode: frontmatter.relationship_mode }
        : {}),
    });
  }
  const nodesByRef = new Map<string, { nodeRef: string; title: string; nodeType: string; summary?: string; tags?: string[] }>();
  for (const view of views) {
    if (!nodesByRef.has(view.nodeRef)) {
      nodesByRef.set(view.nodeRef, {
        nodeRef: view.nodeRef,
        title: view.title,
        nodeType: view.nodeType,
        ...(view.summary !== undefined ? { summary: view.summary } : {}),
        ...(view.nodeTags !== undefined ? { tags: view.nodeTags } : {}),
      });
    }
  }
  return {
    inputFiles: approvedFiles.map((file) => ({ path: file.relPath, sha256: sha256Text(file.content) })),
    nodes: [...nodesByRef.values()],
    views,
    parentIndexes,
    codeEdges,
  };
}

function validateApprovedStructureViewProjection(input: {
  parsed: Record<string, unknown>;
  expectedViews: readonly ApprovedStructureViewProjection[];
  issues: ProjectVerifyIssue[];
}): void {
  if (!Array.isArray(input.parsed.views)) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-views-invalid",
      path: APPROVED_STRUCTURE_PATH,
      message: "ready approved structure must include views[]",
    });
    return;
  }
  const actualByRef = new Map<string, Record<string, unknown>>();
  for (const view of input.parsed.views) {
    if (!isRecord(view) || typeof view.view_ref !== "string" || view.view_ref.trim().length === 0) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-view-invalid",
        path: APPROVED_STRUCTURE_PATH,
        message: "ready approved structure views[] must contain objects with non-empty view_ref",
      });
      continue;
    }
    actualByRef.set(view.view_ref, view);
  }
  for (const expected of input.expectedViews) {
    const actual = actualByRef.get(expected.viewRef);
    if (actual === undefined) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-missing",
        path: APPROVED_STRUCTURE_PATH,
        message: `ready approved structure is missing view projection for approved Markdown page: ${expected.viewRef}`,
      });
      continue;
    }
    if (actual.collection !== expected.collection) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} collection must be ${expected.collection}`,
      });
    }
    if (actual.containment !== expected.containment) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} containment must be ${expected.containment}`,
      });
    }
    if (actual.slug !== expected.slug) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} slug must be ${expected.slug}`,
      });
    }
    if (actual.title !== expected.title) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} title must be ${expected.title}`,
      });
    }
    if (actual.node_ref !== expected.nodeRef) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} node_ref must be ${expected.nodeRef}`,
      });
    }
    if (actual.path !== expected.path) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} path must be ${expected.path}`,
      });
    }
    if (actual.node_type !== expected.nodeType) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} node_type must be ${expected.nodeType}`,
      });
    }
    if (actual.generated !== expected.generated) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} generated marker must match approved Markdown frontmatter`,
      });
    }
    if (actual.summary !== expected.summary) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} summary must match approved Markdown frontmatter`,
      });
    }
    if (!sameStringArray(actual.tags, expected.tags)) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} tags must match approved Markdown frontmatter`,
      });
    }
    if (!sameStringArray(actual.node_tags, expected.nodeTags)) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} node_tags must match approved Markdown frontmatter`,
      });
    }
    if (!sameStringArray(actual.sources, expected.sources)) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} sources must match approved Markdown frontmatter`,
      });
    }
    if (actual.relationship_mode !== expected.relationshipMode) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-node-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} relationship_mode must match approved Markdown frontmatter`,
      });
    }
    if (!Array.isArray(actual.sections)) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-view-sections-invalid",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} must include sections[]`,
      });
      continue;
    }
    const actualSectionRefs: string[] = [];
    for (const [sectionIndex, section] of actual.sections.entries()) {
      if (!isRecord(section) || typeof section.section_ref !== "string" || section.section_ref.trim().length === 0) {
        input.issues.push({
          severity: "error",
          code: "approved-structure-view-section-invalid",
          path: APPROVED_STRUCTURE_PATH,
          message: `approved structure view ${expected.viewRef} sections[${sectionIndex}] must contain section_ref`,
        });
        continue;
      }
      actualSectionRefs.push(section.section_ref);
    }
    if (!sameStringArray(actualSectionRefs, expected.sectionRefs)) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-view-section-projection-mismatch",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure view ${expected.viewRef} sections must match approved Markdown context sections`,
      });
    }
    for (const [sectionIndex, expectedSection] of expected.sections.entries()) {
      const actualSection = actual.sections[sectionIndex];
      if (!isRecord(actualSection)) continue;
      validateApprovedStructureSectionProjection({
        actual: actualSection,
        expected: expectedSection,
        viewRef: expected.viewRef,
        sectionIndex,
        issues: input.issues,
      });
    }
  }
}

function validateApprovedStructureSectionProjection(input: {
  actual: Record<string, unknown>;
  expected: ApprovedStructureSectionProjection;
  viewRef: string;
  sectionIndex: number;
  issues: ProjectVerifyIssue[];
}): void {
  const mismatches = [
    input.actual.id !== input.expected.id,
    input.actual.kind !== input.expected.kind,
    input.actual.section_ref !== input.expected.sectionRef,
    input.actual.content_mode !== input.expected.contentMode,
    input.actual.summary !== input.expected.summary,
    !sameStringArray(input.actual.source_refs, input.expected.sourceRefs),
  ];
  if (!mismatches.some(Boolean)) return;
  input.issues.push({
    severity: "error",
    code: "approved-structure-view-section-projection-mismatch",
    path: APPROVED_STRUCTURE_PATH,
    message: `approved structure view ${input.viewRef} sections[${input.sectionIndex}] must match approved Markdown context section metadata`,
  });
}

function structureEdges(parsed: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(parsed.edges)
    ? parsed.edges.filter((edge): edge is Record<string, unknown> => isRecord(edge))
    : [];
}

function validateParentIndexStructure(input: {
  parsed: Record<string, unknown>;
  approvedProjection: Awaited<ReturnType<typeof approvedStructureProjection>>;
  issues: ProjectVerifyIssue[];
}): void {
  if (input.approvedProjection.parentIndexes.length === 0) return;
  const viewByRef = new Map(input.approvedProjection.views.map((view) => [view.viewRef, view]));
  const containsEdges = structureEdges(input.parsed)
    .filter((edge) => edge.type === "contains" && typeof edge.from === "string" && typeof edge.to === "string");
  for (const parent of input.approvedProjection.parentIndexes) {
    const childRefs = new Set(parent.children.map((child) => child.view_ref));
    for (const child of parent.children) {
      const approvedChild = viewByRef.get(child.view_ref);
      if (approvedChild === undefined) {
        input.issues.push({
          severity: "error",
          code: "approved-parent-index-child-not-approved",
          path: parent.path,
          message: `parent-index child is not an approved view: ${child.view_ref}`,
        });
        continue;
      }
      if (child.node_ref !== approvedChild.nodeRef ||
        child.path !== approvedChild.path ||
        child.title !== approvedChild.title) {
        input.issues.push({
          severity: "error",
          code: "approved-parent-index-child-projection-mismatch",
          path: parent.path,
          message: `parent-index child metadata must match approved child view: ${child.view_ref}`,
        });
      }
      if (!containsEdges.some((edge) => edge.from === parent.viewRef && edge.to === child.view_ref)) {
        input.issues.push({
          severity: "error",
          code: "approved-parent-index-edge-missing",
          path: APPROVED_STRUCTURE_PATH,
          message: `approved structure must contain contains edge ${parent.viewRef} -> ${child.view_ref}`,
        });
      }
    }
    for (const edge of containsEdges.filter((item) => item.from === parent.viewRef)) {
      const target = typeof edge.to === "string" ? edge.to : "";
      if (viewByRef.has(target) && !childRefs.has(target)) {
        input.issues.push({
          severity: "error",
          code: "approved-parent-index-edge-extra",
          path: APPROVED_STRUCTURE_PATH,
          message: `approved structure contains edge from parent-index ${parent.viewRef} to undeclared child ${target}`,
        });
      }
    }
  }
}

export async function validateApprovedStructureEdges(input: {
  projectRoot: string;
  sourceRegistry: SourceRegistryLookup;
  evidenceIndexCache: EvidenceIndexCache;
  issues: ProjectVerifyIssue[];
  structureOverride?: Record<string, unknown>;
}): Promise<void> {
  const parsed = await readApprovedStructureForVerify(input);
  if (parsed === undefined) return;
  const approvedProjection = await approvedStructureProjection(input.projectRoot, parsed);
  const endpointRefs = approvedStructureEndpointRefs(approvedProjection);
  const endpointContexts = approvedStructureEndpointContexts(approvedProjection);
  let confirmedEdges: Array<Record<string, unknown>> | null = null;
  try {
    confirmedEdges = await readConfirmedStructureEdgeProjection(input.projectRoot, endpointRefs, {
      tolerateInvalidYaml: true,
      tolerateMissingEndpoints: true,
    });
  } catch (error) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-edge-invalid",
      path: LIFECYCLE_STRUCTURE_PATH,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const expectedEdges = currentCodegraphEdges({
    baseEdges: confirmedEdges ?? (Array.isArray(parsed.edges) ? parsed.edges.filter(isRecord) : []),
    markdownEdges: approvedProjection.codeEdges,
    endpointRefs,
  });
  let sourceInputs;
  try {
    sourceInputs = parseApprovedStructureSourceInputs(parsed);
  } catch (error) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-source-inputs-invalid",
      path: APPROVED_STRUCTURE_PATH,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const expectedInputHash = sourceInputs === undefined
    ? undefined
    : approvedStructureInputHash({
        schemaVersion: APPROVED_STRUCTURE_SCHEMA_VERSION,
        files: approvedProjection.inputFiles,
        edges: expectedEdges,
        sourceInputs,
        metadata: Array.isArray(parsed.views)
          ? parsed.views.filter(isRecord).map((view) => ({
              view_ref: view.view_ref,
              node_type: view.node_type,
              ...(view.node_tags === undefined ? {} : { node_tags: view.node_tags }),
              ...(view.generated === undefined ? {} : { generated: view.generated }),
              ...(view.children === undefined ? {} : { children: view.children }),
              ...(view.relationship_mode === undefined ? {} : { relationship_mode: view.relationship_mode }),
              ...(view.source_orphaned === undefined ? {} : { source_orphaned: view.source_orphaned }),
              ...(view.machine === undefined ? {} : { machine: view.machine }),
            }))
          : [],
      });
  validateApprovedStructureShape({
    parsed,
    ...(expectedInputHash === undefined ? {} : { expectedInputHash }),
    issues: input.issues,
  });
  const viewRefs = new Set<string>(approvedProjection.views.map((view) => view.viewRef));
  validateApprovedStructureNodeProjection({
    parsed,
    expectedNodes: approvedProjection.nodes,
    issues: input.issues,
  });
  validateApprovedStructureViewProjection({
    parsed,
    expectedViews: approvedProjection.views,
    issues: input.issues,
  });
  validateApprovedStructureViewList({ parsed, viewRefs, issues: input.issues });
  validateParentIndexStructure({
    parsed,
    approvedProjection,
    issues: input.issues,
  });
  await validateApprovedStructureEdgeRecords({
    parsed,
    endpointContexts,
    endpointRefs,
    evidenceIndexCache: input.evidenceIndexCache,
    issues: input.issues,
    projectRoot: input.projectRoot,
    sourceRegistry: input.sourceRegistry,
    sourceOrphanedViewRefs: new Set(
      approvedProjection.views
        .filter((view) => view.sourceOrphaned)
        .map((view) => view.viewRef),
    ),
  });
}
