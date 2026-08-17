import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseDocumentSourceLocator, parseSpanSourceRef } from "@c4a/extract";
import { resolveProseSourceRef } from "./documentEvidenceIndex.js";
import {
  addSnapshotIgnoredWarning,
  approvedViewIssueContext,
  defaultDocumentManifest,
  defaultDocumentMaterializedAt,
  getCommittedEvidenceIndex,
  hasRegisteredSource,
  proseStaleMessage,
  registeredDocumentSource,
  snapshotRootExists,
  type ApprovedViewIssueContext,
  type EvidenceIndexCache,
  type SourceRegistryLookup,
} from "./verifySourceRefs.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";

const CANONICAL_SOURCE_REF = /^repo:([^#]+)#symbol:(.+):([^:@]+):([^:@]+)@([a-f0-9]+)$/iu;

export function validateCanonicalSourceRef(input: {
  ref: string;
  sourceRegistry: SourceRegistryLookup;
  issues: ProjectVerifyIssue[];
  path?: string;
}): void {
  const path = input.path ?? ".tmp/context-runtime/lifecycle/candidates.jsonl";
  const match = CANONICAL_SOURCE_REF.exec(input.ref);
  const prose = parseSpanSourceRef(input.ref);
  if (match === null && prose === null) {
    input.issues.push({ severity: "error", code: "canonical-source-ref-invalid", path, message: `unsupported canonical source_ref: ${input.ref}` });
    return;
  }
  if (prose !== null) {
    const locator = prose.locator === undefined ? null : parseDocumentSourceLocator(prose.locator);
    if (locator === null) {
      input.issues.push({ severity: "error", code: "canonical-source-ref-invalid", path, message: `unsupported canonical prose source_ref: ${input.ref}` });
    } else if (input.sourceRegistry.loaded && !hasRegisteredSource(input.sourceRegistry, locator.sourceType, locator.sourceName)) {
      input.issues.push({
        severity: "error",
        code: "canonical-source-ref-source-missing",
        path,
        message: `source_ref source is not registered: ${locator.sourceType}:${locator.sourceName}`,
      });
    }
    return;
  }
  const sourceName = match?.[1];
  if (sourceName !== undefined && input.sourceRegistry.loaded && !hasRegisteredSource(input.sourceRegistry, "repo", sourceName)) {
    input.issues.push({ severity: "error", code: "canonical-source-ref-source-missing", path, message: `source_ref source is not registered: ${sourceName}` });
  }
}

export async function validateCanonicalEvidenceSourceRef(input: {
  projectRoot: string;
  ref: string;
  sourceRegistry: SourceRegistryLookup;
  evidenceIndexCache: EvidenceIndexCache;
  issues: ProjectVerifyIssue[];
  path?: string;
  line?: number;
  unresolvedSeverity?: ProjectVerifyIssue["severity"];
  sourceOrphaned?: boolean;
  context?: ApprovedViewIssueContext;
}): Promise<void> {
  const before = input.issues.length;
  validateCanonicalSourceRef({
    ref: input.ref,
    sourceRegistry: input.sourceRegistry,
    issues: input.issues,
    ...(input.path !== undefined ? { path: input.path } : {}),
  });
  if (input.issues.length > before) return;
  const prose = parseSpanSourceRef(input.ref);
  if (prose === null) return;
  const path = input.path ?? ".tmp/context-runtime/lifecycle/candidates.jsonl";
  const unresolvedSeverity = input.unresolvedSeverity ?? "warning";
  if (prose.locator === undefined) return;
  const locator = parseDocumentSourceLocator(prose.locator);
  if (locator === null) return;
  const issueContext = {
    ...approvedViewIssueContext(input.context),
    source_keys: [`${locator.sourceType}:${locator.sourceName}`],
  };
  const registryEntry = input.sourceRegistry.loaded
    ? registeredDocumentSource(input.sourceRegistry, locator.sourceType, locator.sourceName)
    : undefined;
  const materializedAt = registryEntry?.materializedAt ?? defaultDocumentMaterializedAt(locator.sourceType, locator.sourceName);
  const manifestPath = registryEntry?.snapshot?.manifest ?? defaultDocumentManifest(materializedAt);
  if (!existsSync(join(input.projectRoot, manifestPath)) && !snapshotRootExists(input.projectRoot, materializedAt)) {
    input.issues.push({
      severity: unresolvedSeverity,
      code: "approved-evidence-unavailable",
      path,
      ...(input.line !== undefined ? { line: input.line } : {}),
      ...issueContext,
      message: `document snapshot is unavailable for ${locator.sourceType}:${locator.sourceName}; evidence cannot be verified offline`,
    });
    return;
  }
  let indexResult: Awaited<ReturnType<typeof getCommittedEvidenceIndex>>;
  try {
    indexResult = await getCommittedEvidenceIndex({
      projectRoot: input.projectRoot,
      sourceType: locator.sourceType,
      sourceName: locator.sourceName,
      materializedAt,
      manifestPath,
      cache: input.evidenceIndexCache,
    });
  } catch (error) {
    input.issues.push({
      severity: "error",
      code: "approved-evidence-snapshot-invalid",
      path,
      ...(input.line !== undefined ? { line: input.line } : {}),
      ...issueContext,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (!indexResult.index.documents.some((document) => document.path === locator.documentPath)) {
    input.issues.push({
      severity: input.sourceOrphaned === true ? "warning" : unresolvedSeverity,
      code: input.sourceOrphaned === true
        ? "approved-source-orphaned"
        : "source-document-missing",
      path,
      ...(input.line !== undefined ? { line: input.line } : {}),
      ...issueContext,
      message: `source document is missing from current snapshot: ${locator.sourceType}:${locator.sourceName}/${locator.documentPath}; deprecate the page or keep it as source-orphaned knowledge`,
    });
    return;
  }
  await addSnapshotIgnoredWarning({
    projectRoot: input.projectRoot,
    cache: input.evidenceIndexCache,
    relPath: path,
    line: input.line ?? 1,
    manifestPath,
    materializedAt,
    documentPath: locator.documentPath,
    issues: input.issues,
    ...(input.context !== undefined ? { context: input.context } : {}),
  });
  const resolved = await resolveProseSourceRef({
    projectRoot: input.projectRoot,
    index: indexResult.index,
    sourceRef: input.ref,
    snapshotMarkdownCache: indexResult.snapshotMarkdownCache,
  });
  if (resolved === null || resolved.status !== "exact") {
    input.issues.push({
      severity: unresolvedSeverity,
      code: "approved-source-ref-stale",
      path,
      ...(input.line !== undefined ? { line: input.line } : {}),
      ...issueContext,
      message: proseStaleMessage(input.ref, resolved?.status),
    });
  }
}
