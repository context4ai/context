import { parseDocumentSourceLocator } from "@c4a/extract";
import YAML from "yaml";
import { okfTypeForKnowledgePath } from "./okfTypes.js";
import {
  PARENT_INDEX_GENERATED_KIND,
  renderParentIndexBody,
  type ParentIndexChild,
} from "./approvedParentIndex.js";
import {
  approvedContextSectionsInMarkdown,
  sourceRefKinds,
  validateApprovedSectionMetadata,
} from "./verifyContextSections.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";
import { isCodeIndexCollection } from "./codeIndexCollection.js";
import {
  hasRegisteredSource,
  validateApprovedSourceRefs,
  validateCodeSymbols,
  type EvidenceIndexCache,
  type SourceRegistryLookup,
  type SymbolIndexLookup,
} from "./verifySourceRefs.js";

const APPROVED_NODE_TYPES = new Set(["entity", "domain", "action"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isDeprecatedApprovedMarkdown(content: string): boolean {
  if (!content.startsWith("---\n")) return false;
  const end = content.indexOf("\n---", 4);
  if (end < 0) return false;
  try {
    const parsed = YAML.parse(content.slice(4, end)) as unknown;
    return isRecord(parsed) && parsed.deprecated === true;
  } catch {
    return false;
  }
}

function parseFrontmatter(content: string, path: string, issues: ProjectVerifyIssue[]): Record<string, unknown> | undefined {
  if (!content.startsWith("---\n")) {
    issues.push({ severity: "error", code: "frontmatter-missing", path, line: 1, message: "knowledge markdown must start with YAML frontmatter" });
    return undefined;
  }
  const end = content.indexOf("\n---", 4);
  if (end < 0) {
    issues.push({ severity: "error", code: "frontmatter-unclosed", path, line: 1, message: "knowledge markdown frontmatter is not closed" });
    return undefined;
  }
  try {
    const parsed = YAML.parse(content.slice(4, end)) as unknown;
    if (!isRecord(parsed)) {
      issues.push({ severity: "error", code: "frontmatter-invalid", path, line: 1, message: "frontmatter must be a YAML object" });
      return undefined;
    }
    return parsed;
  } catch (error) {
    issues.push({
      severity: "error",
      code: "frontmatter-invalid",
      path,
      line: 1,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

export function parseFrontmatterLoose(content: string): Record<string, unknown> {
  if (!content.startsWith("---\n")) return {};
  const end = content.indexOf("\n---", 4);
  if (end < 0) return {};
  try {
    const parsed = YAML.parse(content.slice(4, end)) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function bodyWithoutFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return content.trimEnd();
  const end = content.indexOf("\n---", 4);
  if (end < 0) return content.trimEnd();
  return content.slice(end + "\n---".length).replace(/^(?:\r?\n)+/u, "").trimEnd();
}

export function parentIndexChildren(frontmatter: Record<string, unknown>): ParentIndexChild[] {
  if (frontmatter.generated !== PARENT_INDEX_GENERATED_KIND) return [];
  const children = frontmatter.children;
  if (!Array.isArray(children)) return [];
  return children.flatMap((rawChild) => {
    if (!isRecord(rawChild)) return [];
    const viewRef = typeof rawChild.view_ref === "string" && rawChild.view_ref.trim().length > 0 ? rawChild.view_ref.trim() : undefined;
    const nodeRef = typeof rawChild.node_ref === "string" && rawChild.node_ref.trim().length > 0 ? rawChild.node_ref.trim() : undefined;
    const title = typeof rawChild.title === "string" && rawChild.title.trim().length > 0 ? rawChild.title.trim() : undefined;
    const path = typeof rawChild.path === "string" && rawChild.path.trim().length > 0 ? rawChild.path.trim() : undefined;
    if (viewRef === undefined || nodeRef === undefined || title === undefined || path === undefined) return [];
    return [{
      view_ref: viewRef,
      node_ref: nodeRef,
      title,
      path,
      ...(typeof rawChild.summary === "string" && rawChild.summary.trim().length > 0 ? { summary: rawChild.summary.trim() } : {}),
    }];
  });
}

function validateParentIndexFrontmatter(input: {
  relPath: string;
  frontmatter: Record<string, unknown>;
  content: string;
  issues: ProjectVerifyIssue[];
}): void {
  if (input.frontmatter.generated !== PARENT_INDEX_GENERATED_KIND) return;
  const children = parentIndexChildren(input.frontmatter);
  if (children.length === 0) {
    input.issues.push({
      severity: "error",
      code: "approved-parent-index-children-invalid",
      path: input.relPath,
      message: "parent-index approved page must include non-empty children[] frontmatter",
    });
    return;
  }
  const expected = renderParentIndexBody({
    title: typeof input.frontmatter.title === "string" ? input.frontmatter.title : input.relPath,
    path: input.relPath,
    children,
  });
  const actual = bodyWithoutFrontmatter(input.content);
  if (actual !== expected) {
    input.issues.push({
      severity: "error",
      code: "approved-parent-index-body-mismatch",
      path: input.relPath,
      message: "parent-index approved page body must be mechanically rendered from children[]",
    });
  }
}

export function nodeTypeFromRef(id: string): string | undefined {
  const first = id.split("/")[0] ?? "";
  return APPROVED_NODE_TYPES.has(first) ? first : undefined;
}

export function nodeTypeFromFrontmatter(frontmatter: Record<string, unknown>, id: string): string {
  if (typeof frontmatter.node_type === "string" && frontmatter.node_type.trim().length > 0) {
    return frontmatter.node_type.trim();
  }
  return nodeTypeFromRef(id) ?? "entity";
}

function validateOkfFrontmatter(input: {
  relPath: string;
  frontmatter: Record<string, unknown>;
  issues: ProjectVerifyIssue[];
}): void {
  const requiredStringFields = ["title", "type", "description", "timestamp", "resource"] as const;
  for (const field of requiredStringFields) {
    if (typeof input.frontmatter[field] !== "string" || input.frontmatter[field].trim().length === 0) {
      input.issues.push({
        severity: "error",
        code: "approved-okf-frontmatter-invalid",
        path: input.relPath,
        message: `approved markdown frontmatter must include non-empty ${field}`,
      });
    }
  }
  const timestamp = input.frontmatter.timestamp;
  if (typeof timestamp === "string" && Number.isNaN(Date.parse(timestamp))) {
    input.issues.push({
      severity: "error",
      code: "approved-okf-timestamp-invalid",
      path: input.relPath,
      message: `approved markdown timestamp must be ISO-like date string: ${timestamp}`,
    });
  }
  const tags = input.frontmatter.tags;
  if (!Array.isArray(tags) || tags.length === 0 || tags.some((tag) => typeof tag !== "string" || tag.trim().length === 0)) {
    input.issues.push({
      severity: "error",
      code: "approved-okf-tags-invalid",
      path: input.relPath,
      message: "approved markdown tags must be a non-empty string array",
    });
  }
  const resource = input.frontmatter.resource;
  if (typeof resource === "string" && (/^[a-zA-Z]:[\\/]/u.test(resource) || resource.startsWith("/"))) {
    input.issues.push({
      severity: "error",
      code: "approved-okf-resource-invalid",
      path: input.relPath,
      message: `approved markdown resource must not be a local absolute path: ${resource}`,
    });
  }
}

function validateIdentityFrontmatter(input: {
  relPath: string;
  collection: string;
  frontmatter: Record<string, unknown>;
  issues: ProjectVerifyIssue[];
}): { nodeRef?: string; viewRef?: string } {
  const nodeRef = typeof input.frontmatter.node_ref === "string" && input.frontmatter.node_ref.trim().length > 0
    ? input.frontmatter.node_ref.trim()
    : undefined;
  const viewRef = typeof input.frontmatter.view_ref === "string" && input.frontmatter.view_ref.trim().length > 0
    ? input.frontmatter.view_ref.trim()
    : undefined;
  if (nodeRef === undefined) {
    input.issues.push({
      severity: "error",
      code: "approved-frontmatter-node-ref-mismatch",
      path: input.relPath,
      message: "approved markdown frontmatter must include non-empty node_ref",
    });
  }
  if (viewRef === undefined) {
    input.issues.push({
      severity: "error",
      code: "approved-frontmatter-view-ref-mismatch",
      path: input.relPath,
      message: "approved markdown frontmatter must include non-empty view_ref",
    });
    return { ...(nodeRef !== undefined ? { nodeRef } : {}) };
  }
  const indexerIdentity = nodeRef !== undefined &&
    /^node:subject:sha256:[a-f0-9]{64}$/u.test(nodeRef) &&
    viewRef.startsWith("view:artifact:");
  if (
    nodeRef !== undefined &&
    !indexerIdentity &&
    viewRef !== `${input.collection}:${nodeRef}`
  ) {
    input.issues.push({
      severity: "error",
      code: "approved-frontmatter-view-ref-mismatch",
      path: input.relPath,
      message: `approved markdown view_ref must be ${input.collection}:${nodeRef}`,
    });
  }
  const nodeType = typeof input.frontmatter.node_type === "string" && input.frontmatter.node_type.trim().length > 0
    ? input.frontmatter.node_type.trim()
    : undefined;
  const expectedNodeType = nodeRef === undefined ? undefined : nodeTypeFromRef(nodeRef);
  if (nodeType === undefined) {
    input.issues.push({
      severity: "error",
      code: "approved-frontmatter-node-type-invalid",
      path: input.relPath,
      message: "approved markdown frontmatter must include non-empty node_type",
    });
  } else if (!APPROVED_NODE_TYPES.has(nodeType)) {
    input.issues.push({
      severity: "error",
      code: "approved-frontmatter-node-type-invalid",
      path: input.relPath,
      message: "approved markdown node_type must be one of entity, domain, action",
    });
  } else if (
    !indexerIdentity &&
    !isCodeIndexCollection(input.collection) &&
    (expectedNodeType === undefined || nodeType !== expectedNodeType)
  ) {
    input.issues.push({
      severity: "error",
      code: "approved-frontmatter-node-type-invalid",
      path: input.relPath,
      message: `approved markdown node_type must match node_ref prefix: expected ${expectedNodeType ?? "entity|domain|action"}`,
    });
  }
  return {
    ...(nodeRef !== undefined ? { nodeRef } : {}),
    viewRef,
  };
}

function validateIndexerApprovedMetadata(input: {
  relPath: string;
  frontmatter: Record<string, unknown>;
  content: string;
  issues: ProjectVerifyIssue[];
}): boolean {
  const indexerPage = typeof input.frontmatter.view_ref === "string" &&
    input.frontmatter.view_ref.startsWith("view:artifact:");
  if (!indexerPage) return false;
  const sources = input.frontmatter.sources;
  const sourceRefs = Array.isArray(sources)
    ? new Set(sources.filter((source): source is string => typeof source === "string"))
    : new Set<string>();
  if (sourceRefs.size === 0) {
    input.issues.push({
      severity: "error",
      code: "approved-sources-invalid",
      path: input.relPath,
      message: "approved Indexer page sources must be a non-empty string array",
    });
  }
  const sections = approvedContextSectionsInMarkdown(input.content);
  if (sections.length === 0) {
    input.issues.push({
      severity: "error",
      code: "approved-indexer-section-invalid",
      path: input.relPath,
      message: "approved Indexer page must contain at least one Context Section",
    });
  }
  for (const section of sections) {
    for (const ref of section.refs) {
      if (!sourceRefs.has(ref)) {
        input.issues.push({
          severity: "error",
          code: "approved-indexer-section-invalid",
          path: input.relPath,
          message: `approved Indexer Section references an undeclared source: ${ref}`,
        });
      }
    }
  }
  return true;
}

function validateApprovedSources(input: {
  relPath: string;
  frontmatter: Record<string, unknown>;
  sourceRegistry: SourceRegistryLookup;
  issues: ProjectVerifyIssue[];
}): string[] | null {
  const sources = input.frontmatter.sources;
  if (!Array.isArray(sources) || sources.length === 0 || sources.some((source) => typeof source !== "string")) {
    input.issues.push({ severity: "error", code: "approved-sources-invalid", path: input.relPath, message: "frontmatter sources must be a non-empty string array" });
    return null;
  }
  for (const source of sources as string[]) {
    const repoMatch = /^repo:([a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)$/u.exec(source);
    if (repoMatch !== null) {
      const sourceName = repoMatch[1];
      if (sourceName !== undefined && input.sourceRegistry.loaded && !hasRegisteredSource(input.sourceRegistry, "repo", sourceName)) {
        input.issues.push({ severity: "error", code: "approved-source-missing", path: input.relPath, message: `frontmatter sources entry is not registered: ${source}` });
      }
      continue;
    }
    const locator = parseDocumentSourceLocator(source);
    if (locator === null) {
      input.issues.push({
        severity: "error",
        code: "approved-source-invalid",
        path: input.relPath,
        message: `frontmatter sources entry must be repo:<namespace>/<module> or file|lark:<source>/<doc>: ${source}`,
      });
      continue;
    }
    if (input.sourceRegistry.loaded && !hasRegisteredSource(input.sourceRegistry, locator.sourceType, locator.sourceName)) {
      input.issues.push({
        severity: "error",
        code: "approved-source-missing",
        path: input.relPath,
        message: `frontmatter sources entry is not registered: ${source}`,
      });
    }
  }
  return sources as string[];
}

function validateVisibility(input: {
  relPath: string;
  frontmatter: Record<string, unknown>;
  issues: ProjectVerifyIssue[];
}): void {
  if (typeof input.frontmatter.visibility !== "string" || input.frontmatter.visibility.trim().length === 0) {
    input.issues.push({
      severity: "error",
      code: "approved-visibility-invalid",
      path: input.relPath,
      message: "frontmatter visibility must be a non-empty string",
    });
  }
}

function validateProseTypeMatchesCollection(input: {
  relPath: string;
  frontmatter: Record<string, unknown>;
  issues: ProjectVerifyIssue[];
}): void {
  const expected = okfTypeForKnowledgePath(input.relPath);
  if (expected === null) return;
  if (input.frontmatter.type !== expected) {
    input.issues.push({
      severity: "error",
      code: "approved-type-collection-mismatch",
      path: input.relPath,
      message: `approved prose type must be ${expected} for ${input.relPath}`,
    });
  }
}

export async function validateApprovedMarkdown(input: {
  projectRoot: string;
  relPath: string;
  content: string;
  seenViewRefs: Set<string>;
  sourceRegistry: SourceRegistryLookup;
  symbolIndex: SymbolIndexLookup;
  evidenceIndexCache: EvidenceIndexCache;
  issues: ProjectVerifyIssue[];
}): Promise<void> {
  const parts = input.relPath.split("/");
  const collection = parts[0];
  if (!collection || !okfTypeForKnowledgePath(input.relPath)) {
    input.issues.push({ severity: "error", code: "knowledge-collection-invalid", path: input.relPath, message: "knowledge file must live under a known collection" });
    return;
  }

  const frontmatter = parseFrontmatter(input.content, input.relPath, input.issues);
  if (frontmatter === undefined) return;
  for (const field of ["id", "candidate_id", "collection", "status"]) {
    if (frontmatter[field] !== undefined) {
      input.issues.push({
        severity: "error",
        code: "approved-frontmatter-duplicate-state",
        path: input.relPath,
        message: `approved markdown must not repeat ${field} in frontmatter`,
      });
    }
  }
  for (const field of ["updated", "context", "schema", "source_refs"]) {
    if (frontmatter[field] !== undefined) {
      input.issues.push({
        severity: "error",
        code: "approved-frontmatter-reserved-field",
        path: input.relPath,
        message: `approved markdown must not use reserved frontmatter field ${field}`,
      });
    }
  }
  const identity = validateIdentityFrontmatter({ relPath: input.relPath, collection, frontmatter, issues: input.issues });
  if (identity.viewRef !== undefined) {
    if (input.seenViewRefs.has(identity.viewRef)) {
      input.issues.push({
        severity: "error",
        code: "knowledge-view-ref-duplicate",
        path: input.relPath,
        message: `approved markdown view_ref is duplicated: ${identity.viewRef}`,
      });
    }
    input.seenViewRefs.add(identity.viewRef);
  }
  validateOkfFrontmatter({ relPath: input.relPath, frontmatter, issues: input.issues });
  if (frontmatter.deprecated === true) return;
  const indexerApproved = validateIndexerApprovedMetadata({
    relPath: input.relPath,
    frontmatter,
    content: input.content,
    issues: input.issues,
  });
  if (indexerApproved) {
    validateProseTypeMatchesCollection({
      relPath: input.relPath,
      frontmatter,
      issues: input.issues,
    });
    const sources = frontmatter.sources;
    if (
      !Array.isArray(sources) || sources.length === 0 ||
      sources.some((source) => typeof source !== "string" || source.length === 0)
    ) {
      input.issues.push({
        severity: "error",
        code: "approved-sources-invalid",
        path: input.relPath,
        message: "approved Indexer page sources must be a non-empty string array",
      });
    }
    return;
  }
  if (
    frontmatter.evidence_status !== undefined &&
    frontmatter.evidence_status !== "source-orphaned"
  ) {
    input.issues.push({
      severity: "error",
      code: "approved-evidence-status-invalid",
      path: input.relPath,
      message:
        "approved markdown evidence_status must be source-orphaned when present",
    });
  }
  const isParentIndex = frontmatter.generated === PARENT_INDEX_GENERATED_KIND;
  if (isParentIndex) {
    validateParentIndexFrontmatter({
      relPath: input.relPath,
      frontmatter,
      content: input.content,
      issues: input.issues,
    });
    validateProseTypeMatchesCollection({ relPath: input.relPath, frontmatter, issues: input.issues });
    if (approvedContextSectionsInMarkdown(input.content).length > 0) {
      input.issues.push({
        severity: "error",
        code: "approved-parent-index-has-context-section",
        path: input.relPath,
        message: "parent-index approved page must not contain context:section blocks",
      });
    }
    validateApprovedSources({
      relPath: input.relPath,
      frontmatter,
      sourceRegistry: input.sourceRegistry,
      issues: input.issues,
    });
    return;
  }
  const kinds = sourceRefKinds(input.content);
  if (kinds.hasSpan) {
    validateProseTypeMatchesCollection({ relPath: input.relPath, frontmatter, issues: input.issues });
    validateApprovedSectionMetadata({ relPath: input.relPath, content: input.content, issues: input.issues });
  }
  if (kinds.hasSymbol) {
    validateVisibility({ relPath: input.relPath, frontmatter, issues: input.issues });
    validateCodeSymbols({ relPath: input.relPath, frontmatter, issues: input.issues });
  } else if (frontmatter.code_symbols !== undefined) {
    validateCodeSymbols({ relPath: input.relPath, frontmatter, issues: input.issues });
  }
  const codeSymbols = Array.isArray(frontmatter.code_symbols) &&
    frontmatter.code_symbols.every((entry) => typeof entry === "string")
    ? frontmatter.code_symbols
    : null;
  const sources = validateApprovedSources({
    relPath: input.relPath,
    frontmatter,
    sourceRegistry: input.sourceRegistry,
    issues: input.issues,
  });
  const sourceKeys = sources === null
    ? []
    : [...new Set(sources.flatMap((source) => {
        const locator = parseDocumentSourceLocator(source);
        return locator === null
          ? []
          : [`${locator.sourceType}:${locator.sourceName}`];
      }))].sort();
  await validateApprovedSourceRefs({
    projectRoot: input.projectRoot,
    relPath: input.relPath,
    content: input.content,
    sources,
    codeSymbols,
    sourceRegistry: input.sourceRegistry,
    symbolIndex: input.symbolIndex,
    evidenceIndexCache: input.evidenceIndexCache,
    issues: input.issues,
    ...(frontmatter.evidence_status === "source-orphaned"
      ? { sourceOrphaned: true }
      : {}),
    ...(identity.nodeRef !== undefined && identity.viewRef !== undefined
      ? {
          context: {
            collection,
            node_ref: identity.nodeRef,
            view_ref: identity.viewRef,
            ...(sourceKeys.length === 0 ? {} : { source_keys: sourceKeys }),
          },
        }
      : {}),
  });
}
