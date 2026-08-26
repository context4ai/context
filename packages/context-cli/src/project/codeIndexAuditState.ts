import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "@c4a/agent-graph";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { buildCodeIndexAuditReport, CODE_INDEX_AUDIT_STATE_PATH } from "./codeIndexAudit.js";
import { stableHash } from "./extractCandidateArtifacts.js";
import type {
  CodeIndexAuditDecisionPayload,
  CodeIndexAuditApplyResult,
  CodeIndexAuditRecord,
  CodeIndexAuditReport,
  CodeIndexAuditRetryEntry,
  CodeIndexAuditSignalAssessment,
  CodeIndexAuditStatus,
} from "./codeIndexAuditTypes.js";
import { withProjectWriteLock } from "./writeLock.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function reportWithDeltas(
  report: CodeIndexAuditReport,
  history: readonly CodeIndexAuditRetryEntry[],
): CodeIndexAuditReport {
  return {
    ...report,
    units: report.units.map((unit) => {
      const previous = [...history].reverse().flatMap((entry) => entry.unit_attempts)
        .find((attempt) => attempt.unit_id === unit.id && attempt.problem_fingerprint === unit.problem_fingerprint);
      const byDimension = new Map((previous?.dimension_snapshot ?? []).map((item) => [item.dimension, item.observed]));
      return {
        ...unit,
        dimensions: unit.dimensions.map((dimension) => {
          const previousObserved = byDimension.get(dimension.dimension);
          if (previousObserved === undefined) return { ...dimension, previous_observed: null, delta: null };
          return {
            ...dimension,
            previous_observed: previousObserved,
            delta: previousObserved === null || dimension.observed === null
              ? null
              : Number((dimension.observed - previousObserved).toFixed(3)),
          };
        }),
      };
    }),
  };
}

async function readAuditRecord(projectRoot: string): Promise<CodeIndexAuditRecord | undefined> {
  const path = join(projectRoot, CODE_INDEX_AUDIT_STATE_PATH);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.schema !== "context.code-index-audit.v3") return undefined;
    return parsed as unknown as CodeIndexAuditRecord;
  } catch {
    return undefined;
  }
}

function currentRecord(
  record: CodeIndexAuditRecord | undefined,
  report: CodeIndexAuditReport,
): CodeIndexAuditRecord | undefined {
  if (record?.scope_digest === report.scope_digest) return record;
  if (
    record?.decision.decision !== "accept" ||
    record.accepted_draft_page_digests === undefined ||
    report.source !== "approved"
  ) return undefined;
  const reviewedPages = new Set(record.accepted_draft_page_digests);
  const isReviewedSubset = report.pages.every((page) => reviewedPages.has(stableHash({
    view_ref: page.view_ref,
    candidate_fingerprint: page.candidate_fingerprint,
  })));
  const hasCurrentAbsoluteFailure = report.units.some((unit) =>
    unit.dimensions.some((dimension) => dimension.absolute_gate)
  ) || report.signals.some((signal) => signal.absolute_gate === true);
  return isReviewedSubset &&
    report.pages.length <= record.accepted_draft_page_digests.length &&
    !hasCurrentAbsoluteFailure
    ? record
    : undefined;
}

export async function collectCodeIndexAuditStatus(projectRoot: string): Promise<CodeIndexAuditStatus> {
  const report = await buildCodeIndexAuditReport(projectRoot);
  const record = await readAuditRecord(projectRoot);
  if (report === undefined) {
    return {
      applicable: false,
      current: true,
      resolved: true,
      revision_required: false,
      input_required: false,
      guidance_required: false,
      guidance_units: [],
    };
  }
  const current = currentRecord(record, report);
  const history = record?.retry_history ?? [];
  const guidanceUnits = report.units.flatMap((unit) => {
    const attempts = history.flatMap((entry) => entry.unit_attempts)
      .filter((attempt) => attempt.unit_id === unit.id && attempt.problem_fingerprint === unit.problem_fingerprint);
    const count = Math.max(0, ...attempts.map((attempt) => attempt.attempt));
    if (count < 3 || unit.absolute_failure_count === 0) return [];
    const firstAttempt = [...attempts].sort((left, right) => left.attempt - right.attempt)[0];
    const firstByDimension = new Map((firstAttempt?.dimension_snapshot ?? [])
      .map((dimension) => [dimension.dimension, dimension]));
    return [{
      unit_id: unit.id,
      output_profile: unit.output_profile,
      problem_fingerprint: unit.problem_fingerprint,
      attempts: count,
      failed_dimensions: stableUnique([
        ...unit.dimensions.filter((dimension) => dimension.absolute_gate).map((dimension) => dimension.dimension),
        ...report.signals.filter((signal) => signal.unit_id === unit.id && signal.absolute_gate === true)
          .map((signal) => signal.code),
      ]),
      attempted_actions: stableUnique(attempts.flatMap((attempt) => attempt.actions)),
      dimension_deltas: unit.dimensions.map((dimension) => {
        const before = firstByDimension.get(dimension.dimension)?.observed ?? null;
        const after = dimension.observed;
        return {
          dimension: dimension.dimension,
          before,
          after,
          delta: before === null || after === null ? null : Number((after - before).toFixed(3)),
          status: dimension.status,
        };
      }),
    }];
  });
  return {
    applicable: true,
    current: current !== undefined,
    resolved: current?.decision.decision === "accept",
    revision_required: guidanceUnits.length === 0 && current?.decision.decision === "revise",
    input_required: current?.decision.decision === "request-input",
    guidance_required: guidanceUnits.length > 0,
    guidance_units: guidanceUnits,
    report: reportWithDeltas(report, history),
    ...(current === undefined ? {} : { decision: current.decision }),
  };
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContextError(ExitCode.UserError, `${field} must be a non-empty string`, {
      category: ErrorCategory.SchemaInvalid,
      field,
    });
  }
  return value.trim();
}

function nonEmptyStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new ContextError(ExitCode.UserError, `${field} must be a non-empty string array`, {
      category: ErrorCategory.SchemaInvalid,
      field,
    });
  }
  return stableUnique(value as string[]);
}

function parseDecisionPayload(value: unknown): CodeIndexAuditDecisionPayload {
  if (!isRecord(value) || value.schema !== "context.code-index-audit-decision.v1") {
    throw new ContextError(ExitCode.UserError, "code-index audit input must use context.code-index-audit-decision.v1", {
      category: ErrorCategory.SchemaInvalid,
      expected_schema: "context.code-index-audit-decision.v1",
    });
  }
  if (value.decision !== "accept" && value.decision !== "revise" && value.decision !== "request-input") {
    throw new ContextError(ExitCode.UserError, "code-index audit decision must be accept, revise, or request-input", {
      category: ErrorCategory.SchemaInvalid,
      valid_decisions: ["accept", "revise", "request-input"],
    });
  }
  if (!isRecord(value.scope_assessment) || typeof value.scope_assessment.matches_requested_scope !== "boolean") {
    throw new ContextError(ExitCode.UserError, "scope_assessment must record whether the registered sources match the requested scope", {
      category: ErrorCategory.SchemaInvalid,
      field: "scope_assessment",
    });
  }
  if (!Array.isArray(value.scope_assessment.omissions) || value.scope_assessment.omissions.some((item) => typeof item !== "string")) {
    throw new ContextError(ExitCode.UserError, "scope_assessment.omissions must be a string array", {
      category: ErrorCategory.SchemaInvalid,
      field: "scope_assessment.omissions",
    });
  }
  if (!Array.isArray(value.signal_assessments)) {
    throw new ContextError(ExitCode.UserError, "signal_assessments must be an array", {
      category: ErrorCategory.SchemaInvalid,
      field: "signal_assessments",
    });
  }
  const signalAssessments = value.signal_assessments.map((raw, index) => {
    if (!isRecord(raw) || (raw.disposition !== "fix" && raw.disposition !== "acceptable" && raw.disposition !== "not-applicable")) {
      throw new ContextError(ExitCode.UserError, `signal_assessments[${index}] is invalid`, {
        category: ErrorCategory.SchemaInvalid,
        field: `signal_assessments[${index}]`,
      });
    }
    return {
      signal_id: nonEmpty(raw.signal_id, `signal_assessments[${index}].signal_id`),
      disposition: raw.disposition,
      reason: nonEmpty(raw.reason, `signal_assessments[${index}].reason`),
    } satisfies CodeIndexAuditSignalAssessment;
  });
  const revisionPlan = value.revision_plan;
  const requestedMaterial = value.requested_material;
  return {
    schema: "context.code-index-audit-decision.v1",
    report_digest: nonEmpty(value.report_digest, "report_digest"),
    decision: value.decision,
    summary: nonEmpty(value.summary, "summary"),
    reviewed_units: nonEmptyStrings(value.reviewed_units, "reviewed_units"),
    scope_assessment: {
      matches_requested_scope: value.scope_assessment.matches_requested_scope,
      omissions: stableUnique(value.scope_assessment.omissions as string[]),
      summary: nonEmpty(value.scope_assessment.summary, "scope_assessment.summary"),
    },
    signal_assessments: signalAssessments,
    ...(revisionPlan === undefined ? {} : isRecord(revisionPlan) ? {
      revision_plan: {
        units: nonEmptyStrings(revisionPlan.units, "revision_plan.units"),
        actions: nonEmptyStrings(revisionPlan.actions, "revision_plan.actions"),
      },
    } : {}),
    ...(requestedMaterial === undefined ? {} : {
      requested_material: nonEmptyStrings(requestedMaterial, "requested_material"),
    }),
  };
}

function validateDecision(report: CodeIndexAuditReport, payload: CodeIndexAuditDecisionPayload): void {
  if (payload.report_digest !== report.digest) {
    throw new ContextError(ExitCode.WorkspaceStateError, "code-index audit report changed before the decision was applied", {
      category: ErrorCategory.WorkspaceStateInvalid,
      expected_report_digest: report.digest,
      actual_report_digest: payload.report_digest,
      next: "Read the current code-index audit report and submit a decision for its digest.",
    });
  }
  const unitIds = new Set(report.units.map((unit) => unit.id));
  const missingUnits = [...unitIds].filter((unit) => !payload.reviewed_units.includes(unit));
  const unknownUnits = payload.reviewed_units.filter((unit) => !unitIds.has(unit));
  if (missingUnits.length > 0 || unknownUnits.length > 0) {
    throw new ContextError(ExitCode.UserError, "reviewed_units must cover the complete current code-index audit batch", {
      category: ErrorCategory.SchemaInvalid,
      missing_units: missingUnits,
      unknown_units: unknownUnits,
    });
  }
  const signalIds = new Set(report.signals.map((signal) => signal.id));
  const assessmentBySignal = new Map(payload.signal_assessments.map((item) => [item.signal_id, item]));
  const missingSignals = report.signals.filter((signal) => signal.severity === "elevated")
    .map((signal) => signal.id).filter((id) => !assessmentBySignal.has(id));
  const unknownSignals = payload.signal_assessments.map((item) => item.signal_id).filter((id) => !signalIds.has(id));
  if (missingSignals.length > 0 || unknownSignals.length > 0) {
    throw new ContextError(ExitCode.UserError, "signal_assessments must address every elevated signal and no unknown signal", {
      category: ErrorCategory.SchemaInvalid,
      missing_signal_ids: missingSignals,
      unknown_signal_ids: unknownSignals,
    });
  }
  if (payload.decision === "accept") {
    const absoluteFailures = report.units.flatMap((unit) => unit.dimensions
      .filter((dimension) => dimension.absolute_gate)
      .map((dimension) => `${unit.id}:${dimension.dimension}`))
      .concat(report.signals.filter((signal) => signal.absolute_gate === true)
        .map((signal) => `${signal.unit_id}:${signal.code}`));
    const unresolved = payload.signal_assessments.filter((assessment) => assessment.disposition === "fix");
    if (!payload.scope_assessment.matches_requested_scope || payload.scope_assessment.omissions.length > 0 ||
      unresolved.length > 0 || absoluteFailures.length > 0) {
      throw new ContextError(ExitCode.UserError, "accept requires matching requested scope and no signal marked for repair", {
        category: ErrorCategory.SchemaInvalid,
        omissions: payload.scope_assessment.omissions,
        unresolved_signal_ids: unresolved.map((item) => item.signal_id),
        absolute_failures: absoluteFailures,
      });
    }
  }
  if (payload.decision === "revise" && payload.revision_plan === undefined) {
    throw new ContextError(ExitCode.UserError, "revise requires revision_plan.units and revision_plan.actions", {
      category: ErrorCategory.SchemaInvalid,
      field: "revision_plan",
    });
  }
  if (payload.decision === "request-input" && payload.requested_material === undefined) {
    throw new ContextError(ExitCode.UserError, "request-input requires requested_material", {
      category: ErrorCategory.SchemaInvalid,
      field: "requested_material",
    });
  }
}

export async function applyCodeIndexAuditDecision(input: {
  projectRoot: string;
  payload: unknown;
}): Promise<CodeIndexAuditApplyResult> {
  return withProjectWriteLock(input.projectRoot, "review-code-index", async () => {
    const report = await buildCodeIndexAuditReport(input.projectRoot);
    if (report === undefined) {
      throw new ContextError(ExitCode.WorkspaceStateError, "no code-index audit scope is available", {
        category: ErrorCategory.WorkspaceStateInvalid,
        next: "Complete the Route-selected code extraction before auditing the index.",
      });
    }
    const payload = parseDecisionPayload(input.payload);
    validateDecision(report, payload);
    const previous = await readAuditRecord(input.projectRoot);
    const entry: CodeIndexAuditRetryEntry = {
      report_digest: report.digest,
      unit_attempts: payload.decision !== "revise"
        ? []
        : payload.revision_plan!.units.map((unitId) => {
          const unit = report.units.find((candidate) => candidate.id === unitId)!;
          const previousAttempts = (previous?.retry_history ?? []).flatMap((item) => item.unit_attempts)
            .filter((attempt) => attempt.unit_id === unitId && attempt.problem_fingerprint === unit.problem_fingerprint);
          return {
            unit_id: unitId,
            problem_fingerprint: unit.problem_fingerprint,
            attempt: Math.max(0, ...previousAttempts.map((attempt) => attempt.attempt)) + 1,
            actions: payload.revision_plan!.actions,
            dimension_snapshot: unit.dimensions.map((dimension) => ({
              dimension: dimension.dimension,
              observed: dimension.observed,
            })),
          };
        }),
    };
    const retryHistory = [...(previous?.retry_history ?? [])];
    if (entry.unit_attempts.length > 0) retryHistory.push(entry);
    const record: CodeIndexAuditRecord = {
      schema: "context.code-index-audit.v3",
      scope_digest: report.scope_digest,
      decision: payload,
      retry_history: retryHistory,
      ...(payload.decision === "accept" && report.source === "draft-and-approved"
        ? {
            accepted_draft_page_digests: report.pages.map((page) => stableHash({
              view_ref: page.view_ref,
              candidate_fingerprint: page.candidate_fingerprint,
            })),
          }
        : {}),
    };
    await writeJsonAtomic(join(input.projectRoot, CODE_INDEX_AUDIT_STATE_PATH), record);
    return { record, report };
  });
}
