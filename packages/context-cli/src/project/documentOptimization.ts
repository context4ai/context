import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  DOCUMENT_OPTIMIZATION_POLICY,
  isDocumentOptimizationEnabled,
} from "./documentOptimizationConfig.js";
import {
  assertSafeDocumentEditorialDecision,
  collectDocumentOptimizationFragments,
  fragmentSectionState,
  inferDocumentRevisionReplacements,
  parseDocumentOptimizationKeepState,
  parseDocumentRevision,
  renderDocumentOptimizationPage,
  type DocumentOptimizationFragment,
} from "./documentOptimizationModel.js";
import {
  analyzeDocumentEditorialSignals,
  documentEditorialSignalConfidence,
  DOCUMENT_EDITORIAL_OMISSION_REASONS,
  type DocumentEditorialAction,
  type DocumentEditorialOmissionReason,
} from "./documentEditorialSignals.js";
import {
  listDocumentRevisionFiles,
  readDocumentRevision,
  writeDocumentOptimizationKeepState,
  writeDocumentRevision,
} from "./documentOptimizationStorage.js";
import {
  readDocumentRevisionRequest,
} from "./documentRevisionRequest.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import {
  hydrateApprovedKnowledgeMarkdown,
  readApprovedKnowledgeMetadataIndex,
} from "./approvedKnowledgeMetadata.js";
import {
  clearDocumentOptimizationRetry,
  collectDocumentOptimizationGuidance,
  recordDocumentOptimizationFailure,
  type DocumentOptimizationGuidanceProblem,
} from "./documentOptimizationRetry.js";

export type { DocumentOptimizationFragment } from "./documentOptimizationModel.js";

export interface DocumentOptimizationStatus {
  schema: "context.document-optimization-status.v3";
  enabled: boolean;
  policy: string;
  revision_pages: number;
  eligible_views: number;
  eligible_fragments: number;
  revised_fragments: number;
  kept_fragments: number;
  pending_fragments: number;
  conflict_fragments: number;
  revision_requested: boolean;
  requested_approved_path?: string;
  current: boolean;
  pending_fragment_ids: string[];
  conflict_fragment_ids: string[];
  retry_attempts: number;
  guidance_required: boolean;
  guidance_problems: DocumentOptimizationGuidanceProblem[];
  signal_count: number;
  action_candidates: {
    repair: number;
    reshape: number;
    omit: number;
    request_input: number;
  };
}

export interface DocumentOptimizationPlan extends Omit<DocumentOptimizationStatus, "schema"> {
  schema: "context.document-optimization-plan.v3";
  fragments: DocumentOptimizationFragment[];
  input_requests: Array<{
    fragment_id: string;
    approved_path: string;
    section_id: string;
    signals: DocumentOptimizationFragment["signals"];
  }>;
  payload_target: string;
  next_action: { kind: "apply-document-optimization"; command: string };
}

interface ApplyDecisionInput {
  fragment_id: string;
  input_digest: string;
  context_digest: string;
  policy_digest: string;
  action: DocumentEditorialAction;
  replacement?: string;
  reason?: DocumentEditorialOmissionReason;
  assessment?: string;
}

export interface DocumentOptimizationApplyInput {
  schema: "context.document-optimization-decisions.v2";
  decisions: ApplyDecisionInput[];
}

export interface DocumentOptimizationRescanItem {
  fragment_id: string;
  approved_path: string;
  section_id: string;
  signal_code: string;
  source_range: string;
  post_revision_range?: string;
  selected_action: DocumentEditorialAction;
  status: "resolved" | "justified";
}

interface ResolvedFragmentState {
  fragment: DocumentOptimizationFragment;
  state: "revised" | "kept" | "pending" | "conflict";
  replacement?: string;
}

const OPERATIONAL_SHORTCUT_KEEP_ASSESSMENTS = [
  /\b(?:save|saving|reduce)\s+(?:time|cost|effort|work)\b/iu,
  /\b(?:too much|excessive|large)\s+(?:work|effort|workload|batch)\b/iu,
  /\b(?:time|cost|effort|workload|batch size|deadline|progress)\b.{0,48}\b(?:keep|skip|defer|unchanged)\b/iu,
  /(?:节省|减少|考虑).{0,8}(?:时间|成本|工作量|开销)/u,
  /(?:时间|成本|工作量|批次|批量|规模|进度|期限).{0,24}(?:保留|跳过|不改|暂不|延期|以后处理)/u,
  /(?:赶进度|工作量过大|数量太多|默认保留|全部保留|整批保留)/u,
] as const;

function assertQualityGroundedKeepAssessment(
  fragment: DocumentOptimizationFragment,
  assessment: string,
): void {
  if (OPERATIONAL_SHORTCUT_KEEP_ASSESSMENTS.some((pattern) => pattern.test(assessment))) {
    throw new ContextError(ExitCode.UserError, `keeping a signaled document fragment cannot be justified by delivery effort: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
      signals: fragment.signals.map((signal) => signal.code),
      next: "Resolve every actionable signal with a safe edit, eligible omission, or required input request. Keep only when a Section-specific assessment shows a false positive or a source-fidelity risk; time, cost, workload, batch size, and progress are not content-quality evidence.",
    });
  }
  const missingSignalCodes = [...new Set(fragment.signals.map((signal) => signal.code))]
    .filter((code) => !assessment.includes(code));
  if (missingSignalCodes.length > 0) {
    throw new ContextError(ExitCode.UserError, `keeping a signaled document fragment requires an assessment for every signal: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
      signals: fragment.signals.map((signal) => signal.code),
      missing_signal_codes: missingSignalCodes,
      next: "Name each reported signal code and explain from this Section why it is a false positive or why the corresponding edit would reduce source fidelity; otherwise resolve the signal with repair, reshape, omit, or required input.",
    });
  }
  const inputSignals = fragment.signals
    .filter((signal) => signal.recommended_action === "request-input")
    .map((signal) => signal.code);
  if (inputSignals.length > 0 && !/(?:false[ -]?positive|误报|不适用)/iu.test(assessment)) {
    throw new ContextError(ExitCode.UserError, `a required document input request cannot be silently kept: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
      signals: inputSignals,
      next: "Ask the plan-level input request and wait for the answer. Keep is allowed only when a Section-specific assessment explicitly establishes that the request-input signal is a false positive; source preservation or managed mode does not bypass the question.",
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function assertRevisionOwnership(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
  fragments: readonly DocumentOptimizationFragment[];
}): Promise<void> {
  const approved = new Set(input.files.map((file) => file.relPath));
  const eligible = new Set(input.fragments.map((fragment) => fragment.approved_path));
  for (const revision of await listDocumentRevisionFiles(input.projectRoot)) {
    if (approved.has(revision.approvedPath) && eligible.has(revision.approvedPath)) continue;
    throw new ContextError(ExitCode.WorkspaceStateError, `document revision has no eligible approved page: knowledge/${revision.relPath}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      path: `knowledge/${revision.relPath}`,
      next: "Remove the orphan revision or restore its approved document, then rerun context optimize-docs validate.",
    });
  }
}

async function resolveFragmentStates(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<ResolvedFragmentState[]> {
  const metadata = await readApprovedKnowledgeMetadataIndex(input.projectRoot);
  const files = await Promise.all(input.files.map(async (file) => {
    const path = join(input.projectRoot, "knowledge", file.relPath);
    if (!existsSync(path)) return file;
    return {
      ...file,
      absPath: path,
      content: hydrateApprovedKnowledgeMarkdown({
        content: await readFile(path, "utf8"),
        relPath: file.relPath,
        metadata,
      }),
    };
  }));
  const fragments = collectDocumentOptimizationFragments(files);
  await assertRevisionOwnership({ projectRoot: input.projectRoot, files, fragments });
  const byPath = new Map<string, DocumentOptimizationFragment[]>();
  for (const fragment of fragments) {
    const list = byPath.get(fragment.approved_path) ?? [];
    list.push(fragment);
    byPath.set(fragment.approved_path, list);
  }
  const states: ResolvedFragmentState[] = [];
  for (const file of files) {
    const pageFragments = byPath.get(file.relPath) ?? [];
    if (pageFragments.length === 0) continue;
    const keptSections = parseDocumentOptimizationKeepState(file.content);
    const isKept = (fragment: DocumentOptimizationFragment): boolean => {
      const state = keptSections.get(fragment.section_id);
      return state?.input_digest === fragment.input_digest &&
        state.context_digest === fragment.context_digest &&
        state.policy_digest === fragment.policy_digest;
    };
    const rawRevision = await readDocumentRevision(input.projectRoot, file.relPath);
    if (rawRevision === null) {
      states.push(...pageFragments.map((fragment) => ({
        fragment,
        state: isKept(fragment) ? "kept" as const : "pending" as const,
      })));
      continue;
    }
    const revision = parseDocumentRevision(rawRevision);
    if (revision === null) {
      states.push(...pageFragments.map((fragment) => ({ fragment, state: "conflict" as const })));
      continue;
    }
    const pageFragmentIds = new Set(pageFragments.map((fragment) => fragment.section_id));
    if ([...revision.sections.keys()].some((sectionId) => !pageFragmentIds.has(sectionId))) {
      states.push(...pageFragments.map((fragment) => ({ fragment, state: "conflict" as const })));
      continue;
    }
    const currentRevisionSections = new Map([...revision.sections].filter(([sectionId, state]) => {
      const fragment = pageFragments.find((candidate) => candidate.section_id === sectionId);
      return fragment !== undefined && state.input_digest === fragment.input_digest &&
        state.context_digest === fragment.context_digest && state.policy_digest === fragment.policy_digest;
    }));
    let replacements: Map<string, string> | null;
    try {
      replacements = inferDocumentRevisionReplacements({
        file,
        revisionContent: revision.content,
        revisionSections: currentRevisionSections,
      });
    } catch {
      replacements = null;
    }
    if (replacements === null) {
      states.push(...pageFragments.map((fragment) => ({ fragment, state: "conflict" as const })));
      continue;
    }
    for (const fragment of pageFragments) {
      const revisionState = revision.sections.get(fragment.section_id);
      if (revisionState !== undefined && (
        revisionState.input_digest !== fragment.input_digest ||
        revisionState.context_digest !== fragment.context_digest ||
        revisionState.policy_digest !== fragment.policy_digest
      )) {
        states.push({ fragment, state: "conflict" });
        continue;
      }
      const replacement = replacements.get(fragment.fragment_id);
      if (replacement !== undefined) {
        states.push({ fragment, state: "revised", replacement });
        continue;
      }
      states.push({ fragment, state: isKept(fragment) || revisionState !== undefined ? "kept" : "pending" });
    }
  }
  return states;
}

function statusFromStates(input: {
  enabled: boolean;
  states: readonly ResolvedFragmentState[];
  requestedApprovedPath?: string;
  retryAttempts?: number;
  guidanceRequired?: boolean;
  guidanceProblems?: DocumentOptimizationGuidanceProblem[];
}): DocumentOptimizationStatus {
  const pending = input.states.filter((item) => item.state === "pending");
  const conflicts = input.states.filter((item) => item.state === "conflict");
  const revisionPaths = new Set(input.states
    .filter((item) => item.state === "revised")
    .map((item) => item.fragment.approved_path));
  return {
    schema: "context.document-optimization-status.v3",
    enabled: input.enabled,
    policy: DOCUMENT_OPTIMIZATION_POLICY,
    revision_pages: revisionPaths.size,
    eligible_views: new Set(input.states.map((item) => item.fragment.view_ref)).size,
    eligible_fragments: input.states.length,
    revised_fragments: input.states.filter((item) => item.state === "revised").length,
    kept_fragments: input.states.filter((item) => item.state === "kept").length,
    pending_fragments: pending.length,
    conflict_fragments: conflicts.length,
    revision_requested: input.requestedApprovedPath !== undefined,
    ...(input.requestedApprovedPath === undefined
      ? {}
      : { requested_approved_path: input.requestedApprovedPath }),
    current: !input.enabled || (pending.length === 0 && conflicts.length === 0),
    pending_fragment_ids: pending.map((item) => item.fragment.fragment_id),
    conflict_fragment_ids: conflicts.map((item) => item.fragment.fragment_id),
    retry_attempts: input.retryAttempts ?? 0,
    guidance_required: input.guidanceRequired ?? false,
    guidance_problems: input.guidanceProblems ?? [],
    signal_count: input.states.reduce((total, item) => total + item.fragment.signals.length, 0),
    action_candidates: {
      repair: input.states.filter((item) => item.fragment.signals.some((signal) => signal.recommended_action === "repair")).length,
      reshape: input.states.filter((item) => item.fragment.signals.some((signal) => signal.recommended_action === "reshape")).length,
      omit: input.states.filter((item) => item.fragment.signals.some((signal) => signal.recommended_action === "omit")).length,
      request_input: input.states.filter((item) => item.fragment.signals.some((signal) => signal.recommended_action === "request-input")).length,
    },
  };
}

export function disabledDocumentOptimizationStatus(): DocumentOptimizationStatus {
  return statusFromStates({ enabled: false, states: [] });
}

export async function collectDocumentOptimizationStatus(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<DocumentOptimizationStatus> {
  const enabled = await isDocumentOptimizationEnabled(input.projectRoot);
  if (!enabled) return statusFromStates({ enabled, states: [] });
  const request = await readDocumentRevisionRequest(input.projectRoot);
  const states = await resolveFragmentStates(input);
  const guidance = await collectDocumentOptimizationGuidance({
    projectRoot: input.projectRoot,
    fragments: states.filter((state) => state.state === "pending" || state.state === "conflict")
      .map((state) => state.fragment),
  });
  return statusFromStates({
    enabled,
    states,
    retryAttempts: guidance.retry_attempts,
    guidanceRequired: guidance.guidance_required,
    guidanceProblems: guidance.guidance_problems,
    ...(request === null ? {} : { requestedApprovedPath: request.approved_path }),
  });
}

export async function createDocumentOptimizationPlan(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<DocumentOptimizationPlan> {
  const enabled = await isDocumentOptimizationEnabled(input.projectRoot);
  const states = enabled ? await resolveFragmentStates(input) : [];
  const request = enabled ? await readDocumentRevisionRequest(input.projectRoot) : null;
  const guidance = enabled ? await collectDocumentOptimizationGuidance({
    projectRoot: input.projectRoot,
    fragments: states.filter((state) => state.state === "pending" || state.state === "conflict")
      .map((state) => state.fragment),
  }) : { retry_attempts: 0, guidance_required: false, guidance_problems: [] };
  const status = statusFromStates({
    enabled,
    states,
    retryAttempts: guidance.retry_attempts,
    guidanceRequired: guidance.guidance_required,
    guidanceProblems: guidance.guidance_problems,
    ...(request === null ? {} : { requestedApprovedPath: request.approved_path }),
  });
  const payloadTarget = ".tmp/agent-payloads/document-optimization-decisions.json";
  return {
    ...status,
    schema: "context.document-optimization-plan.v3",
    fragments: states
      .filter((item) => item.state === "pending" || item.state === "conflict")
      .map((item) => item.fragment),
    input_requests: states
      .filter((item) => item.state === "pending" || item.state === "conflict")
      .filter((item) => item.fragment.signals.some((signal) => signal.recommended_action === "request-input"))
      .map((item) => ({
        fragment_id: item.fragment.fragment_id,
        approved_path: item.fragment.approved_path,
        section_id: item.fragment.section_id,
        signals: item.fragment.signals.filter((signal) => signal.recommended_action === "request-input"),
      })),
    payload_target: payloadTarget,
    next_action: {
      kind: "apply-document-optimization",
      command: `context optimize-docs apply --input ${payloadTarget} --format json`,
    },
  };
}

function parseApplyInput(value: unknown): DocumentOptimizationApplyInput {
  if (!isRecord(value) || value.schema !== "context.document-optimization-decisions.v2" || !Array.isArray(value.decisions)) {
    throw new ContextError(ExitCode.UserError, "document optimization input must match context.document-optimization-decisions.v2", {
      category: ErrorCategory.SchemaInvalid,
    });
  }
  const decisions = value.decisions.map((raw, index): ApplyDecisionInput => {
    if (!isRecord(raw)) {
      throw new ContextError(ExitCode.UserError, `document optimization decision ${index + 1} must be an object`, {
        category: ErrorCategory.SchemaInvalid,
      });
    }
    if (
      typeof raw.fragment_id !== "string" || typeof raw.input_digest !== "string" ||
      typeof raw.context_digest !== "string" || typeof raw.policy_digest !== "string" ||
      (raw.action !== "keep" && raw.action !== "repair" && raw.action !== "reshape" && raw.action !== "omit") ||
      ((raw.action === "repair" || raw.action === "reshape") && typeof raw.replacement !== "string") ||
      (raw.assessment !== undefined && typeof raw.assessment !== "string") ||
      (raw.action === "omit" && (
        typeof raw.reason !== "string" ||
        !(DOCUMENT_EDITORIAL_OMISSION_REASONS as readonly string[]).includes(raw.reason)
      ))
    ) {
      throw new ContextError(ExitCode.UserError, `document optimization decision ${index + 1} is invalid`, {
        category: ErrorCategory.SchemaInvalid,
      });
    }
    return raw as unknown as ApplyDecisionInput;
  });
  return { schema: "context.document-optimization-decisions.v2", decisions };
}

function decisionMatches(fragment: DocumentOptimizationFragment, decision: ApplyDecisionInput): boolean {
  return fragment.input_digest === decision.input_digest &&
    fragment.context_digest === decision.context_digest &&
    fragment.policy_digest === decision.policy_digest;
}

async function applyDocumentOptimizationDecisionsUnchecked(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
  payload: unknown;
}): Promise<{ applied: number; status: DocumentOptimizationStatus; rescan: DocumentOptimizationRescanItem[] }> {
  if (!(await isDocumentOptimizationEnabled(input.projectRoot))) {
    throw new ContextError(ExitCode.UserError, "document optimization is disabled", {
      category: ErrorCategory.WorkspaceStateInvalid,
      next: "Run context optimize-docs enable before applying decisions.",
    });
  }
  const payload = parseApplyInput(input.payload);
  const states = await resolveFragmentStates(input);
  const expected = new Map(states
    .filter((state) => state.state === "pending" || state.state === "conflict")
    .map((state) => [state.fragment.fragment_id, state.fragment]));
  const seen = new Set<string>();
  const validated = payload.decisions.map((decision) => {
    const fragment = expected.get(decision.fragment_id);
    if (fragment === undefined || seen.has(decision.fragment_id) || !decisionMatches(fragment, decision)) {
      throw new ContextError(ExitCode.UserError, `document optimization decision is stale or duplicated: ${decision.fragment_id}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        next: "Run context optimize-docs plan --format json and regenerate the decision payload.",
      });
    }
    seen.add(decision.fragment_id);
    const highConfidenceSignals = fragment.signals.filter((signal) => signal.confidence === "high");
    if (decision.action === "keep" && highConfidenceSignals.length > 0) {
      throw new ContextError(ExitCode.UserError, `high-confidence document signals cannot be kept unchanged: ${decision.fragment_id}`, {
        category: ErrorCategory.UserInputInvalid,
        signals: highConfidenceSignals.map((signal) => signal.code),
        fragment_ids: [decision.fragment_id],
        next: "Resolve deterministic presentation defects with repair, reshape, or an eligible omission; keep is reserved for review-confidence false positives and source-fidelity risks.",
      });
    }
    if (
      decision.action === "keep" && fragment.keep_requires_assessment &&
      (decision.assessment === undefined || decision.assessment.trim().length < 12)
    ) {
      throw new ContextError(ExitCode.UserError, `keeping a signaled document fragment requires a concrete assessment: ${decision.fragment_id}`, {
        category: ErrorCategory.UserInputInvalid,
        signals: fragment.signals.map((signal) => signal.code),
        next: "Read the Section and explain why every reported signal is a false positive or why changing it would reduce source fidelity; otherwise use repair, reshape, omit, or request user input.",
      });
    }
    if (decision.action === "keep" && fragment.keep_requires_assessment) {
      assertQualityGroundedKeepAssessment(fragment, decision.assessment!);
    }
    if (decision.action !== "keep") {
      assertSafeDocumentEditorialDecision(
        fragment,
        decision.action,
        decision.replacement,
        decision.reason,
      );
    }
    const postSignals = decision.action === "keep"
      ? fragment.signals
      : decision.action === "omit"
        ? []
        : analyzeDocumentEditorialSignals(decision.replacement!);
    const remainingReviewSignals = postSignals.filter((signal) =>
      documentEditorialSignalConfidence(signal.code) === "review"
    );
    if (decision.action !== "keep" && remainingReviewSignals.length > 0) {
      if (decision.assessment === undefined || decision.assessment.trim().length < 12) {
        throw new ContextError(ExitCode.UserError, `post-revision document signals require a concrete assessment: ${decision.fragment_id}`, {
          category: ErrorCategory.UserInputInvalid,
          signals: remainingReviewSignals.map((signal) => signal.code),
          next: "Resolve the remaining review signals or explain each signal against this effective Section; effort and schedule are not content-quality evidence.",
        });
      }
      assertQualityGroundedKeepAssessment({
        ...fragment,
        signals: remainingReviewSignals,
        keep_requires_assessment: true,
      }, decision.assessment);
    }
    return { decision, fragment, postSignals };
  });
  const signaledKeepAssessments = new Map<string, string>();
  for (const { decision, fragment } of validated) {
    if (decision.action !== "keep" || !fragment.keep_requires_assessment) continue;
    const assessment = decision.assessment!.trim().replace(/\s+/gu, " ").toLowerCase();
    const previous = signaledKeepAssessments.get(assessment);
    if (previous !== undefined) {
      throw new ContextError(ExitCode.UserError, "signaled document fragments require section-specific keep assessments", {
        category: ErrorCategory.UserInputInvalid,
        fragment_ids: [previous, fragment.fragment_id],
        next: "Assess each Section against its own signals; do not reuse one generic explanation across a batch.",
      });
    }
    signaledKeepAssessments.set(assessment, fragment.fragment_id);
  }
  if (seen.size !== expected.size) {
    throw new ContextError(ExitCode.UserError, "document optimization payload must resolve the complete current batch", {
      category: ErrorCategory.UserInputInvalid,
      expected: expected.size,
      received: seen.size,
    });
  }

  const replacementsByPath = new Map<string, Map<string, string>>();
  const keptSectionsByPath = new Map<string, Map<string, ReturnType<typeof fragmentSectionState>>>();
  for (const state of states) {
    if (state.state === "revised" && state.replacement !== undefined) {
      const replacements = replacementsByPath.get(state.fragment.approved_path) ?? new Map<string, string>();
      replacements.set(state.fragment.fragment_id, state.replacement);
      replacementsByPath.set(state.fragment.approved_path, replacements);
    } else if (state.state === "kept") {
      const kept = keptSectionsByPath.get(state.fragment.approved_path) ?? new Map();
      kept.set(state.fragment.section_id, fragmentSectionState(state.fragment));
      keptSectionsByPath.set(state.fragment.approved_path, kept);
    }
  }
  for (const { decision, fragment } of validated) {
    const replacements = replacementsByPath.get(fragment.approved_path) ?? new Map<string, string>();
    if (decision.action === "keep") {
      replacements.delete(fragment.fragment_id);
      const kept = keptSectionsByPath.get(fragment.approved_path) ?? new Map();
      kept.set(fragment.section_id, fragmentSectionState(fragment));
      keptSectionsByPath.set(fragment.approved_path, kept);
    } else if (decision.action === "omit") {
      replacements.set(fragment.fragment_id, "");
      keptSectionsByPath.get(fragment.approved_path)?.delete(fragment.section_id);
    } else {
      replacements.set(fragment.fragment_id, decision.replacement!);
      keptSectionsByPath.get(fragment.approved_path)?.delete(fragment.section_id);
    }
    replacementsByPath.set(fragment.approved_path, replacements);
  }
  const updatedFiles: ApprovedKnowledgeFile[] = [];
  for (const file of input.files) {
    const replacements = replacementsByPath.get(file.relPath) ?? new Map();
    const pageFragments = states.filter((state) => state.fragment.approved_path === file.relPath)
      .map((state) => state.fragment);
    const updated = pageFragments.length === 0 ? file : await writeDocumentOptimizationKeepState({
      projectRoot: input.projectRoot,
      file,
      sections: keptSectionsByPath.get(file.relPath) ?? new Map(),
    });
    updatedFiles.push(updated);
    await writeDocumentRevision({
      projectRoot: input.projectRoot,
      file: updated,
      replacements,
      fragments: pageFragments,
    });
  }
  return {
    applied: validated.length,
    status: await collectDocumentOptimizationStatus({ projectRoot: input.projectRoot, files: updatedFiles }),
    rescan: validated.flatMap(({ decision, fragment, postSignals }) => {
      const remainingByCode = new Map(postSignals.map((signal) => [signal.code, signal]));
      const original = fragment.signals.map((signal): DocumentOptimizationRescanItem => {
        const remaining = remainingByCode.get(signal.code);
        return {
          fragment_id: fragment.fragment_id,
          approved_path: fragment.approved_path,
          section_id: fragment.section_id,
          signal_code: signal.code,
          source_range: `${signal.line_start}-${signal.line_end}`,
          ...(remaining === undefined ? {} : {
            post_revision_range: `${remaining.line_start}-${remaining.line_end}`,
          }),
          selected_action: decision.action,
          status: remaining === undefined ? "resolved" : "justified",
        };
      });
      const originalCodes = new Set(fragment.signals.map((signal) => signal.code));
      return [...original, ...postSignals.filter((signal) => !originalCodes.has(signal.code)).map((signal) => ({
        fragment_id: fragment.fragment_id,
        approved_path: fragment.approved_path,
        section_id: fragment.section_id,
        signal_code: signal.code,
        source_range: fragment.line_range,
        post_revision_range: `${signal.line_start}-${signal.line_end}`,
        selected_action: decision.action,
        status: "justified" as const,
      }))];
    }),
  };
}

export async function applyDocumentOptimizationDecisions(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
  payload: unknown;
}): Promise<{ applied: number; status: DocumentOptimizationStatus; rescan: DocumentOptimizationRescanItem[] }> {
  try {
    const result = await applyDocumentOptimizationDecisionsUnchecked(input);
    await clearDocumentOptimizationRetry(input.projectRoot);
    return {
      ...result,
      status: await collectDocumentOptimizationStatus(input),
    };
  } catch (error) {
    if (
      error instanceof ContextError && error.code === ExitCode.UserError &&
      error.detail?.category === ErrorCategory.UserInputInvalid
    ) {
      const states = await resolveFragmentStates(input);
      await recordDocumentOptimizationFailure({
        projectRoot: input.projectRoot,
        fragments: states.filter((state) => state.state === "pending" || state.state === "conflict")
          .map((state) => state.fragment),
        error,
      });
    }
    throw error;
  }
}

export async function reconcileDocumentOptimizationRevisions(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<DocumentOptimizationStatus> {
  const states = await resolveFragmentStates(input);
  const request = await readDocumentRevisionRequest(input.projectRoot);
  const status = statusFromStates({
    enabled: true,
    states,
    ...(request === null ? {} : { requestedApprovedPath: request.approved_path }),
  });
  if (status.conflict_fragments > 0) return status;
  const updatedFiles: ApprovedKnowledgeFile[] = [];
  for (const file of input.files) {
    const pageStates = states.filter((state) => state.fragment.approved_path === file.relPath);
    const replacements = new Map(pageStates
      .filter((state) => state.state === "revised" && state.replacement !== undefined)
      .map((state) => [state.fragment.fragment_id, state.replacement!]));
    const keptSections = new Map(pageStates
      .filter((state) => state.state === "kept")
      .map((state) => [state.fragment.section_id, fragmentSectionState(state.fragment)]));
    const updated = pageStates.length === 0 ? file : await writeDocumentOptimizationKeepState({
      projectRoot: input.projectRoot,
      file,
      sections: keptSections,
    });
    updatedFiles.push(updated);
    await writeDocumentRevision({
      projectRoot: input.projectRoot,
      file: updated,
      replacements,
      fragments: pageStates.map((state) => state.fragment),
    });
  }
  return collectDocumentOptimizationStatus({ projectRoot: input.projectRoot, files: updatedFiles });
}

export async function projectDocumentOptimizedKnowledge(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<{ files: ApprovedKnowledgeFile[]; status: DocumentOptimizationStatus }> {
  const enabled = await isDocumentOptimizationEnabled(input.projectRoot);
  if (!enabled) return { files: [...input.files], status: statusFromStates({ enabled, states: [] }) };
  const states = await resolveFragmentStates(input);
  const request = await readDocumentRevisionRequest(input.projectRoot);
  const status = statusFromStates({
    enabled,
    states,
    ...(request === null ? {} : { requestedApprovedPath: request.approved_path }),
  });
  if (!status.current) return { files: [...input.files], status };
  const files = input.files.map((file) => {
    const replacements = new Map(states
      .filter((state) => state.fragment.approved_path === file.relPath && state.state === "revised" && state.replacement !== undefined)
      .map((state) => [state.fragment.fragment_id, state.replacement!]));
    return replacements.size === 0
      ? file
      : { ...file, content: renderDocumentOptimizationPage({ file, replacements }) };
  });
  return { files, status };
}
