import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { KnowledgeCollection } from "@c4a/context";
import { ErrorCategory, formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { applyReviewDecisions } from "./reviewApply.js";
import { collectAllReviewCandidates, collectReviewCandidates, writeReviewHtml } from "./reviewHtml.js";
import {
  applyEvidenceMaintenance,
  deprecateApprovedPage,
  keepOrphanedApprovedPage,
  parseEvidenceMaintenancePayload,
  rePinApprovedPage,
} from "./reviewMaintenance.js";
import { readYamlOrJsonInput } from "./payloadInput.js";
import {
  assertCollection,
  candidateIdsHash,
  candidateSetHash,
  isRecord,
  REVIEW_PAYLOAD_SCHEMA,
  type ApplyReviewDecisionsResult,
  type ReviewDecision,
  type ReviewFormat,
  type ReviewMaintenanceResult,
  type ReviewPayload,
  type ReviewPayloadScope,
  type ReviewStatus,
} from "./reviewShared.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { htmlReportReference, openLocalFile } from "./localHtmlReport.js";
import { findContextProjectRoot } from "./workspace.js";

export { applyReviewDecisions } from "./reviewApply.js";
export { collectReviewCandidates, writeReviewHtml } from "./reviewHtml.js";
export { deprecateApprovedPage, rePinApprovedPage } from "./reviewMaintenance.js";
export type { ApplyReviewDecisionsResult } from "./reviewShared.js";

function parseReviewStatus(value: unknown, label: string): ReviewStatus {
  if (value !== "approved" && value !== "rejected") {
    throw new ContextError(ExitCode.UserError, `${label} must be approved|rejected`, {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  return value;
}

function requirePayloadHeaderField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContextError(ExitCode.UserError, `review payload header requires ${field}`, {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  return value;
}

function parsePayloadLineDecision(value: unknown, index: number): ReviewDecision {
  if (!isRecord(value) || typeof value.candidate_id !== "string") {
    throw new ContextError(ExitCode.UserError, `review payload line ${index} must contain candidate_id and status`, {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  return {
    candidate_id: value.candidate_id,
    status: parseReviewStatus(value.status, `review payload line ${index} status`),
  };
}

function parsePayloadScope(value: unknown): ReviewPayloadScope | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    typeof value.count !== "number" ||
    !Number.isInteger(value.count) ||
    value.count < 0 ||
    typeof value.ids_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/iu.test(value.ids_sha256)
  ) {
    throw new ContextError(ExitCode.UserError, "review payload scope must contain count and ids_sha256", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  if (
    value.kind !== undefined &&
    value.kind !== "collection" &&
    value.kind !== "all"
  ) {
    throw new ContextError(ExitCode.UserError, "review payload scope.kind must be collection or all", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const visibleIds = value.visible_candidate_ids;
  if (
    visibleIds !== undefined &&
    (!Array.isArray(visibleIds) || visibleIds.some((item) => typeof item !== "string" || item.length === 0))
  ) {
    throw new ContextError(ExitCode.UserError, "review payload scope.visible_candidate_ids must be a string array", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const collection = value.collection;
  if (collection !== undefined && typeof collection !== "string") {
    throw new ContextError(ExitCode.UserError, "review payload scope.collection must be a string when present", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const candidatesHash = value.candidates_sha256;
  if (candidatesHash !== undefined && (typeof candidatesHash !== "string" || !/^[a-f0-9]{64}$/iu.test(candidatesHash))) {
    throw new ContextError(ExitCode.UserError, "review payload scope.candidates_sha256 must be a SHA-256 digest", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  return {
    ...(value.kind === "collection" || value.kind === "all" ? { kind: value.kind } : {}),
    ...(typeof collection === "string" ? { collection: assertCollection(collection) } : {}),
    count: value.count,
    ids_sha256: value.ids_sha256.toLowerCase(),
    ...(typeof candidatesHash === "string" ? { candidates_sha256: candidatesHash.toLowerCase() } : {}),
    ...(Array.isArray(visibleIds) ? { visible_candidate_ids: visibleIds as string[] } : {}),
  };
}

function parsePayloadValues(parsed: unknown[]): ReviewPayload {
  const first = parsed[0];
  if (!isRecord(first)) {
    throw new ContextError(ExitCode.UserError, "review payload header must be a JSON object", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  if (first.schema !== REVIEW_PAYLOAD_SCHEMA) {
    throw new ContextError(ExitCode.UserError, `review payload header schema must be ${REVIEW_PAYLOAD_SCHEMA}`, {
      category: ErrorCategory.UserInputInvalid,
      next: "Copy a fresh review payload from context review html <collection>.",
    });
  }

  const scope = parsePayloadScope(first.scope);
  const collection = first.collection === undefined
    ? undefined
    : assertCollection(requirePayloadHeaderField(first.collection, "collection"));
  if (collection === undefined && scope?.kind !== "all") {
    throw new ContextError(ExitCode.UserError, "review payload header requires collection unless scope.kind is all", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  if (collection !== undefined && scope?.kind === "all") {
    throw new ContextError(ExitCode.UserError, "review payload all scope must not include collection", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  if (collection !== undefined && scope?.collection !== undefined && scope.collection !== collection) {
    throw new ContextError(ExitCode.UserError, "review payload collection and scope.collection must match", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const defaultStatus = parseReviewStatus(first.default, "review payload default");
  const decisions = parsed.slice(1).map((item, index) => parsePayloadLineDecision(item, index + 2));
  return {
    decisions,
    ...(typeof first.note === "string" ? { note: first.note } : {}),
    ...(collection !== undefined ? { collection } : {}),
    default: defaultStatus,
    ...(scope !== undefined ? { scope } : {}),
  };
}

function parsePayloadJsonl(raw: string): ReviewPayload {
  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) {
    throw new ContextError(ExitCode.UserError, "review payload is empty", {
      category: ErrorCategory.UserInputInvalid,
    });
  }

  const parsed = lines.map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ContextError(ExitCode.UserError, `review payload line ${index + 1} is invalid JSON`, {
        category: ErrorCategory.UserInputInvalid,
        reason: message,
      });
    }
  });
  return parsePayloadValues(parsed);
}

function parseReviewPayloadText(raw: string): ReviewPayload {
  try {
    return parsePayloadValues([JSON.parse(raw) as unknown]);
  } catch (error) {
    if (error instanceof SyntaxError) return parsePayloadJsonl(raw);
    throw error;
  }
}

export async function readReviewPayloadFile(filePath: string): Promise<ReviewPayload> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContextError(ExitCode.UserError, `review payload file cannot be read: ${filePath}`, {
      category: ErrorCategory.UserInputInvalid,
      path: filePath,
      reason: message,
      next: "Pass the JSON or JSONL review Payload copied from the review HTML page.",
    });
  }
  return parseReviewPayloadText(raw);
}

function formatApplyResult(result: ApplyReviewDecisionsResult, format: ReviewFormat): string {
  if (format === "json") return `${JSON.stringify(result, null, 2)}\n`;
  return formatFeedback({
    symbol: "✓",
    action: "applied",
    subject: "review decisions",
    headline: `${result.applied} decision(s)`,
    body: [
      `approved: ${result.approved}`,
      `rejected: ${result.rejected}`,
      `materialized: ${result.materialized}`,
      `removed: ${result.removed}`,
      `unchanged: ${result.unchanged}`,
      `candidate file: ${result.candidateFileUpdated ? "updated" : "unchanged"}`,
      ...result.pages.map((page) => `page: ${page}`),
    ],
  });
}

function formatMaintenanceResult(action: string, result: ReviewMaintenanceResult, format: ReviewFormat): string {
  if (format === "json") return `${JSON.stringify(result, null, 2)}\n`;
  return formatFeedback({
    symbol: "✓",
    action,
    subject: result.id,
    headline: result.changed ? "updated" : "unchanged",
    body: [
      `page: ${result.path}`,
      ...(result.refsUpdated !== undefined ? [`refs updated: ${result.refsUpdated}`] : []),
      `action log: ${result.actionLog}`,
    ],
  });
}

function projectRootFromCwd(cwd: string): string {
  const found = findContextProjectRoot(cwd);
  if (found === null) {
    throw new ContextError(ExitCode.WorkspaceStateError, "review requires a context project", {
      category: ErrorCategory.WorkspaceNotFound,
    });
  }
  return found.projectRoot;
}

async function reviewCommandScope(input: {
  projectRoot: string;
  collection?: string;
  all?: boolean;
}): Promise<{ collection?: KnowledgeCollection; scope: ReviewPayloadScope }> {
  if (input.all === true && input.collection !== undefined) {
    throw new ContextError(ExitCode.UserError, "review quick decision accepts either --collection or --all, not both", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  if (input.all !== true && input.collection === undefined) {
    throw new ContextError(ExitCode.UserError, "review quick decision requires --collection <collection> or --all", {
      category: ErrorCategory.UserInputInvalid,
      next: "Use context review html <collection> for the interactive gate, or pass an explicit scope to the quick command.",
    });
  }
  const rows = await readCandidateRecords(input.projectRoot);
  if (input.all === true) {
    const scopedRows = rows.filter((row) => row.status === "draft");
    const ids = scopedRows.map((row) => row.candidate_id).sort();
    return {
      scope: {
        kind: "all",
        count: ids.length,
        ids_sha256: candidateIdsHash(ids),
        candidates_sha256: candidateSetHash(scopedRows),
        visible_candidate_ids: ids,
      },
    };
  }
  const collection = assertCollection(input.collection);
  const scopedRows = rows.filter((row) => row.collection === collection && row.status === "draft");
  const ids = scopedRows.map((row) => row.candidate_id).sort();
  return {
    collection,
    scope: {
      kind: "collection",
      collection,
      count: ids.length,
      ids_sha256: candidateIdsHash(ids),
      candidates_sha256: candidateSetHash(scopedRows),
      visible_candidate_ids: ids,
    },
  };
}

export async function runReviewHtmlCommand(input: {
  cwd: string;
  collection?: string;
  all?: boolean;
  out?: string;
  format?: ReviewFormat;
  open?: boolean;
}): Promise<void> {
  const projectRoot = projectRootFromCwd(input.cwd);
  if (input.all === true && input.collection !== undefined) {
    throw new ContextError(ExitCode.UserError, "review html accepts either <collection> or --all, not both", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const collection = input.all === true ? undefined : assertCollection(input.collection);
  const result = await writeReviewHtml({
    projectRoot,
    ...(collection !== undefined ? { collection } : { all: true }),
    ...(input.out ? { out: input.out } : {}),
  });
  const report = htmlReportReference({
    projectRoot,
    path: result.path,
    title: collection === undefined ? "Review Candidates - all collections" : `Review Candidates - ${collection}`,
  });
  const openResult = input.open === true ? await openLocalFile(result.path) : undefined;
  if (input.format === "json") {
    process.stdout.write(`${JSON.stringify({
      ...result,
      absolute_path: report.absolute_path,
      file_url: report.file_url,
      url: report.file_url,
      candidate_details_command: collection === undefined
        ? "context review list --all --format json"
        : `context review list ${collection} --format json`,
      ...(openResult !== undefined ? { opened: openResult.opened, open_error: openResult.error } : {}),
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatFeedback({
    symbol: "✓",
    action: "wrote",
    subject: "review html",
    headline: `${result.candidates} candidate(s)`,
    body: [
      `file: ${result.path}`,
      `absolute path: ${report.absolute_path}`,
      `file_url: ${report.file_url}`,
      ...(openResult !== undefined ? [
        `opened: ${openResult.opened ? "yes" : "no"}`,
        ...(openResult.error !== undefined ? [`open_error: ${openResult.error}`] : []),
      ] : []),
    ],
    next: "Apply the exact decision Payload returned by this report.",
  }));
}

export async function runReviewListCommand(input: {
  cwd: string;
  collection?: string;
  all?: boolean;
  format?: ReviewFormat;
}): Promise<void> {
  const projectRoot = projectRootFromCwd(input.cwd);
  if (input.all === true && input.collection !== undefined) {
    throw new ContextError(ExitCode.UserError, "review list accepts either <collection> or --all, not both", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const collection = input.all === true ? undefined : assertCollection(input.collection);
  const candidates = collection === undefined
    ? await collectAllReviewCandidates(projectRoot)
    : await collectReviewCandidates(projectRoot, collection);
  if (input.format === "json") {
    process.stdout.write(`${JSON.stringify(candidates.map(({ record, snapshot }) => ({
      candidate_id: record.candidate_id,
      node_ref: record.node_ref,
      view_ref: record.view_ref,
      collection: record.collection,
      status: record.status,
      module: record.module,
      source_refs: record.source_refs,
      review: record.review,
      snapshot_ready: snapshot !== undefined,
      fingerprint: record.fingerprint,
      structure_digest: record.structure_digest,
    })), null, 2)}\n`);
    return;
  }
  const byKind = new Map<string, number>();
  const byModule = new Map<string, number>();
  for (const { record } of candidates) {
    byKind.set(record.kind, (byKind.get(record.kind) ?? 0) + 1);
    byModule.set(record.module, (byModule.get(record.module) ?? 0) + 1);
  }
  const formatCounts = (counts: Map<string, number>) => [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
  const lines = candidates.length === 0
    ? ["draft candidates: none"]
    : candidates.map(({ record }) => `draft ${record.candidate_id} (${record.module}) ${record.source_refs[0] ?? ""}`);
  const scopeLabel = collection ?? "all";
  process.stdout.write(formatFeedback({
    symbol: "✓",
    action: "listed",
    subject: `review ${scopeLabel}`,
    headline: `${candidates.length} draft candidate(s)`,
    body: [
      `by kind: ${formatCounts(byKind) || "none"}`,
      `by module: ${formatCounts(byModule) || "none"}`,
      ...lines,
    ],
    next: collection === undefined ? "context review html --all" : `context review html ${collection}`,
  }));
}

export async function runReviewApplyCommand(input: {
  cwd: string;
  payloadInput: string;
  format?: ReviewFormat;
}): Promise<void> {
  const projectRoot = projectRootFromCwd(input.cwd);
  const payloadPath = isAbsolute(input.payloadInput) ? input.payloadInput : resolve(input.cwd, input.payloadInput);
  const payload = await readReviewPayloadFile(payloadPath);
  const result = await applyReviewDecisions({ projectRoot, payload });
  process.stdout.write(formatApplyResult(result, input.format ?? "text"));
}

export async function runReviewApproveAllCommand(input: {
  cwd: string;
  collection?: string;
  all?: boolean;
  managed?: boolean;
  force?: boolean;
  verbose?: boolean;
  format?: ReviewFormat;
}): Promise<void> {
  if (input.managed === true && input.force === true) {
    throw new ContextError(ExitCode.UserError, "review approve-all accepts either --managed or --force, not both", {
      category: ErrorCategory.UserInputInvalid,
      code: "review-approval-authority-conflict",
      next: "context status --format json",
    });
  }
  if (input.managed !== true && input.force !== true) {
    throw new ContextError(ExitCode.UserError, "review approve-all requires explicit --managed authority or --force user confirmation", {
      category: ErrorCategory.UserInputInvalid,
      code: "review-approval-authority-required",
      next: "context status --format json",
    });
  }
  const decisionSource = input.managed === true
    ? "managed-session"
    : "explicit-user-force-approval";
  const projectRoot = projectRootFromCwd(input.cwd);
  const scoped = await reviewCommandScope({
    projectRoot,
    ...(input.collection !== undefined ? { collection: input.collection } : {}),
    ...(input.all === true ? { all: true } : {}),
  });
  const result = await applyReviewDecisions({
    projectRoot,
    payload: {
      decisions: [],
      default: "approved",
      note: input.managed === true
        ? "managed-session auto approval"
        : "explicit user force approval",
      ...(scoped.collection !== undefined ? { collection: scoped.collection } : {}),
      scope: scoped.scope,
    },
  });
  if ((input.format ?? "text") === "json") {
    const { visible_candidate_ids: visibleCandidateIds, ...compactScope } = scoped.scope;
    process.stdout.write(`${JSON.stringify({
      kind: "review.approve-all.result",
      decision_source: decisionSource,
      scope: compactScope,
      applied: result.applied,
      approved: result.approved,
      rejected: result.rejected,
      materialized: result.materialized,
      unchanged: result.unchanged,
      removed: result.removed,
      candidate_file_updated: result.candidateFileUpdated,
      details: input.verbose === true
        ? {
            visible_candidate_ids: visibleCandidateIds ?? [],
            pages: result.pages,
          }
        : {
            included: false,
            omitted_candidate_ids: visibleCandidateIds?.length ?? 0,
            omitted_pages: result.pages.length,
            hint: "Rerun with --verbose only when per-candidate paths are required for diagnostics.",
          },
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatFeedback({
    symbol: "✓",
    action: "approved",
    subject: input.managed === true ? "managed review batch" : "force-approved review batch",
    headline: `${result.approved} candidate(s) approved`,
    body: [
      `decision source: ${decisionSource}`,
      `materialized: ${result.materialized}`,
      `unchanged: ${result.unchanged}`,
      `removed: ${result.removed}`,
    ],
  }));
}

export async function runReviewMarkCommand(input: {
  cwd: string;
  id: string;
  status: ReviewStatus;
  collection?: string;
  all?: boolean;
  format?: ReviewFormat;
}): Promise<void> {
  const projectRoot = projectRootFromCwd(input.cwd);
  const scope = await reviewCommandScope({
    projectRoot,
    ...(input.collection !== undefined ? { collection: input.collection } : {}),
    ...(input.all === true ? { all: true } : {}),
  });
  const result = await applyReviewDecisions({
    projectRoot,
    payload: {
      decisions: [{ candidate_id: input.id, status: input.status }],
      ...(scope.collection !== undefined ? { collection: scope.collection } : {}),
      scope: scope.scope,
    },
  });
  process.stdout.write(formatApplyResult(result, input.format ?? "text"));
}

export async function runReviewRePinCommand(input: {
  cwd: string;
  viewRef: string;
  format?: ReviewFormat;
}): Promise<void> {
  const projectRoot = projectRootFromCwd(input.cwd);
  const result = await rePinApprovedPage({
    projectRoot,
    viewRef: input.viewRef,
  });
  process.stdout.write(formatMaintenanceResult("re-pinned", result, input.format ?? "text"));
}

export async function runReviewDeprecateCommand(input: {
  cwd: string;
  viewRef: string;
  format?: ReviewFormat;
}): Promise<void> {
  const projectRoot = projectRootFromCwd(input.cwd);
  const result = await deprecateApprovedPage({
    projectRoot,
    viewRef: input.viewRef,
  });
  process.stdout.write(formatMaintenanceResult("deprecated", result, input.format ?? "text"));
}

export async function runReviewKeepOrphanedCommand(input: {
  cwd: string;
  viewRef: string;
  format?: ReviewFormat;
}): Promise<void> {
  const projectRoot = projectRootFromCwd(input.cwd);
  const result = await keepOrphanedApprovedPage({
    projectRoot,
    viewRef: input.viewRef,
  });
  process.stdout.write(
    formatMaintenanceResult(
      "kept source-orphaned",
      result,
      input.format ?? "text",
    ),
  );
}

export async function runReviewMaintainCommand(input: {
  cwd: string;
  payloadInput: string;
  format?: ReviewFormat;
}): Promise<void> {
  const projectRoot = projectRootFromCwd(input.cwd);
  const payload = await readYamlOrJsonInput({
    path: input.payloadInput,
    label: "review maintain",
    missingNext:
      "Pass a context.evidence-maintenance.v1 payload with explicit decisions.",
    readFailureNext: "Fix the input path or pass --input - for stdin.",
    parseFailureNext: "Fix the evidence-maintenance YAML/JSON payload.",
  });
  const decisions = parseEvidenceMaintenancePayload(payload);
  const result = await applyEvidenceMaintenance({ projectRoot, decisions });
  if ((input.format ?? "text") === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatFeedback({
    symbol: "✓",
    action: "applied",
    subject: "evidence maintenance",
    headline: `${result.applied} decision(s)`,
    body: result.results.map((item) =>
      `${item.action}: ${item.id} (${item.changed ? "updated" : "unchanged"})`
    ),
    next: "context status --format json",
  }));
}
