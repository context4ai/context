import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ErrorCategory, formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { CANDIDATE_LEDGER_FILE, readCandidateRecords, type CandidateRecord } from "./candidateLedger.js";
import { validateApprovedStructureEdges } from "./verifyApprovedStructure.js";
import { parseFrontmatterLoose, validateApprovedMarkdown } from "./verifyFrontmatter.js";
import { isKnowledgeAssetPath, walkApprovedMarkdown } from "./verifyProjectFiles.js";
import {
  loadSourceRegistryLookup,
  loadVerifiedSymbolIndex,
  type EvidenceIndexCache,
} from "./verifySourceRefs.js";
import type { ProjectVerifyIssue, ProjectVerifyResult } from "./verifyTypes.js";
import { findContextProjectRoot } from "./workspace.js";
import { readRejectedDecisions, REVIEW_DECISIONS_FILE } from "./reviewDecisions.js";
import { knowledgeAssetReferences, unprojectedSourceAssetLinks } from "./knowledgeAssets.js";
import { parseDocumentSourceLocator } from "@c4a/extract";
import {
  groupProjectVerifyIssues,
  pagedProjectVerifyIssues,
} from "./verifyDiagnostics.js";
import {
  hydrateApprovedKnowledgeMarkdown,
  readApprovedKnowledgeMetadataIndex,
} from "./approvedKnowledgeMetadata.js";

export type { ProjectVerifyIssue, ProjectVerifyResult } from "./verifyTypes.js";

function approvedDocumentSourceKeys(frontmatter: Record<string, unknown>): string[] {
  const candidates = [
    ...(typeof frontmatter.resource === "string" ? [frontmatter.resource] : []),
    ...(Array.isArray(frontmatter.sources)
      ? frontmatter.sources.filter((value): value is string => typeof value === "string")
      : []),
  ];
  return [...new Set(candidates.flatMap((candidate) => {
    const locator = parseDocumentSourceLocator(candidate);
    return locator === null ? [] : [`${locator.sourceType}:${locator.sourceName}`];
  }))].sort();
}

function evidenceStatusForIssues(issues: readonly ProjectVerifyIssue[]): ProjectVerifyResult["evidenceStatus"] {
  if (issues.some((issue) => issue.severity === "error")) return "fail";
  return issues.some((issue) => issue.severity === "warning") ? "pass-with-unverifiable-evidence" : "pass";
}

async function readCandidateDecisionState(input: {
  projectRoot: string;
  issues: ProjectVerifyIssue[];
}): Promise<{
  candidatesByViewRef: Map<string, CandidateRecord>;
  rejectedDecisions: Map<string, string>;
}> {
  let rejectedDecisions = new Map<string, string>();
  try {
    rejectedDecisions = await readRejectedDecisions(input.projectRoot);
  } catch (error) {
    input.issues.push({
      severity: "error",
      code: "decisions-invalid",
      path: REVIEW_DECISIONS_FILE,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const candidateIds = new Set<string>();
  const candidatesByViewRef = new Map<string, CandidateRecord>();
  try {
    for (const record of await readCandidateRecords(input.projectRoot)) {
      if (candidateIds.has(record.candidate_id)) {
        input.issues.push({ severity: "error", code: "candidate-id-duplicate", path: CANDIDATE_LEDGER_FILE, message: `duplicate candidate_id: ${record.candidate_id}` });
      }
      candidateIds.add(record.candidate_id);
      const existingView = candidatesByViewRef.get(record.view_ref);
      if (existingView !== undefined) {
        input.issues.push({
          severity: "error",
          code: "candidate-view-ref-duplicate",
          path: CANDIDATE_LEDGER_FILE,
          message: `multiple Candidates target the same view_ref: ${record.view_ref}`,
        });
      }
      candidatesByViewRef.set(record.view_ref, record);
      const rejectedFingerprint = rejectedDecisions.get(record.candidate_id);
      if (record.status === "rejected" && rejectedFingerprint !== record.fingerprint) {
        input.issues.push({
          severity: "error",
          code: "candidate-decision-conflict",
          path: CANDIDATE_LEDGER_FILE,
          message: `rejected candidate does not match its durable decision: ${record.candidate_id}`,
        });
      } else if (record.status === "draft" && rejectedFingerprint !== undefined) {
        input.issues.push({
          severity: "error",
          code: "candidate-decision-conflict",
          path: CANDIDATE_LEDGER_FILE,
          message: `draft candidate also has a durable rejected decision: ${record.candidate_id}`,
        });
      }
    }
  } catch (error) {
    input.issues.push({
      severity: "error",
      code: "candidate-ledger-invalid",
      path: CANDIDATE_LEDGER_FILE,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return { candidatesByViewRef, rejectedDecisions };
}

export async function verifyProjectWorkspace(
  projectRoot: string,
  options: {
    approvedStructureOverride?: Record<string, unknown>;
  } = {},
): Promise<ProjectVerifyResult> {
  const issues: ProjectVerifyIssue[] = [];
  const symbolIndex = await loadVerifiedSymbolIndex(projectRoot);
  const sourceRegistry = await loadSourceRegistryLookup(projectRoot, issues);
  const evidenceIndexCache: EvidenceIndexCache = {
    entries: new Map(),
    ignoredPaths: new Map(),
  };
  const approvedMetadata = await readApprovedKnowledgeMetadataIndex(
    projectRoot,
    options.approvedStructureOverride,
  );

  const { candidatesByViewRef, rejectedDecisions } = await readCandidateDecisionState({
    projectRoot,
    issues,
  });

  const seenViewRefs = new Set<string>();
  for (const file of await walkApprovedMarkdown(join(projectRoot, "knowledge"))) {
    if (isKnowledgeAssetPath(file.relPath)) continue;
    const rawContent = await readFile(file.absPath, "utf8");
    const content = hydrateApprovedKnowledgeMarkdown({
      content: rawContent,
      relPath: file.relPath,
      metadata: approvedMetadata,
    });
    const frontmatter = parseFrontmatterLoose(content);
    const viewRef = typeof frontmatter.view_ref === "string" ? frontmatter.view_ref : undefined;
    const sourceKeys = approvedDocumentSourceKeys(frontmatter);
    const unprojectedResourceLinks = unprojectedSourceAssetLinks(content);
    if (unprojectedResourceLinks.length > 0) {
      issues.push({
        severity: "error",
        code: "approved-resource-source-path-unprojected",
        path: file.relPath,
        ...(unprojectedResourceLinks[0]?.line === undefined ? {} : { line: unprojectedResourceLinks[0].line }),
        ...(viewRef === undefined ? {} : { view_ref: viewRef }),
        ...(sourceKeys.length === 0 ? {} : { source_keys: sourceKeys }),
        message: `approved Markdown contains ${unprojectedResourceLinks.length} source-snapshot resource link(s) that were not projected into knowledge/assets`,
      });
    }
    for (const assetPath of knowledgeAssetReferences({
      pageRelPath: `knowledge/${file.relPath}`,
      content,
    })) {
      if (!existsSync(join(projectRoot, assetPath))) {
        issues.push({
          severity: "error",
          code: "approved-resource-missing",
          path: file.relPath,
          message: `approved Markdown references a missing resource: ${assetPath}`,
        });
      }
    }
    if (/^>\s*(?:(?:Image|File):.*\(lark:(?:image|file):|(?:Whiteboard|Diagram):\s*lark:(?:whiteboard|diagram):|Embedded (?:Sheet|Base).*\(lark:(?:sheet|base):|Synced reference.*lark:synced-reference:)/imu.test(content)) {
      issues.push({
        severity: "error",
        code: "approved-resource-placeholder-unresolved",
        path: file.relPath,
        ...(viewRef === undefined ? {} : { view_ref: viewRef }),
        ...(sourceKeys.length === 0 ? {} : { source_keys: sourceKeys }),
        message: "approved Markdown still contains a required Lark resource placeholder; recapture and re-review the source",
      });
    }
    if (viewRef !== undefined && viewRef.length > 0) {
      const pending = candidatesByViewRef.get(viewRef);
      const isResolvedRejection = pending?.status === "rejected" &&
        rejectedDecisions.get(pending.candidate_id) === pending.fingerprint;
      const approvedFingerprint = typeof frontmatter.candidate_fingerprint === "string"
        ? frontmatter.candidate_fingerprint
        : undefined;
      if (
        pending !== undefined &&
        approvedFingerprint !== undefined &&
        rejectedDecisions.get(pending.candidate_id) === approvedFingerprint
      ) {
        issues.push({
          severity: "error",
          code: "approved-decision-conflict",
          path: file.relPath,
          message: `approved page has the same fingerprint as a rejected decision: ${pending.candidate_id}`,
        });
      }
      if (pending !== undefined && pending.status !== "draft" && !isResolvedRejection) {
        issues.push({
          severity: "error",
          code: "candidate-decision-conflict",
          path: file.relPath,
          message: `approved page has an unresolved Candidate state: ${pending.candidate_id}`,
        });
      }
    }
    const pageIssues: ProjectVerifyIssue[] = [];
    await validateApprovedMarkdown({
      projectRoot,
      relPath: file.relPath,
      content,
      seenViewRefs,
      sourceRegistry,
      symbolIndex,
      evidenceIndexCache,
      issues: pageIssues,
    });
    issues.push(...pageIssues);
  }

  await validateApprovedStructureEdges({
    projectRoot,
    sourceRegistry,
    evidenceIndexCache,
    issues,
    ...(options.approvedStructureOverride !== undefined ? { structureOverride: options.approvedStructureOverride } : {}),
  });

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    evidenceStatus: evidenceStatusForIssues(issues),
    issues,
  };
}

function formatProjectVerifyResult(
  result: ProjectVerifyResult,
  format: "table" | "json",
  compact = false,
): string {
  const errors = result.issues.filter((issue) => issue.severity === "error").length;
  const warnings = result.issues.length - errors;
  if (format === "json") {
    const groups = compact ? groupProjectVerifyIssues(result.issues) : undefined;
    return `${JSON.stringify(compact
      ? {
          protocol: "context.verify.summary.v1",
          ok: result.ok,
          evidence_status: result.evidenceStatus,
          summary: {
            errors,
            warnings,
            groups: groups?.length ?? 0,
          },
          groups,
          diagnostics: {
            command: "context verify --view diagnostics --page-size 25 --format json",
          },
        }
      : { ok: result.ok, evidence_status: result.evidenceStatus, summary: { errors, warnings }, issues: result.issues }, null, 2)}\n`;
  }
  if (result.issues.length === 0) {
    return formatFeedback({
      symbol: "✓",
      action: "verified",
      subject: "context project",
      headline: `no issues (evidence_status=${result.evidenceStatus})`,
    });
  }
  return formatFeedback({
    symbol: errors > 0 ? "✗" : "⚠",
    action: "verified",
    subject: "context project",
    headline: `${result.issues.length} issue(s) (${errors} error, ${warnings} warning, evidence_status=${result.evidenceStatus})`,
    body: result.issues.map((issue) =>
      `[${issue.severity}] ${issue.code}${issue.path ? ` path=${issue.path}` : ""}${issue.line ? ` line=${issue.line}` : ""}: ${issue.message}`
    ),
  });
}

export async function runProjectVerifyCommand(input: {
  cwd: string;
  format?: "table" | "json";
  compact?: boolean;
  view?: "diagnostics";
  pageToken?: string;
  pageSize?: string;
}): Promise<boolean> {
  const found = findContextProjectRoot(input.cwd);
  if (found === null) return false;
  const result = await verifyProjectWorkspace(found.projectRoot);
  if (input.view === "diagnostics") {
    process.stdout.write(`${JSON.stringify(pagedProjectVerifyIssues({
      issues: result.issues,
      ...(input.pageToken === undefined ? {} : { pageToken: input.pageToken }),
      ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
    }), null, 2)}\n`);
    return true;
  }
  process.stdout.write(formatProjectVerifyResult(
    result,
    input.format ?? "table",
    input.compact === true,
  ));
  if (!result.ok) {
    throw new ContextError(ExitCode.WorkspaceStateError, "context project verify failed", {
      category: ErrorCategory.SchemaInvalid,
      errors: result.issues.filter((issue) => issue.severity === "error").length,
    });
  }
  return true;
}
