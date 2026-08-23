import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  DOCUMENT_OPTIMIZATION_POLICY,
  documentOptimizationRoot,
  isDocumentOptimizationEnabled,
} from "./documentOptimizationConfig.js";
import {
  assertSafeDocumentOptimizationReplacement,
  collectDocumentOptimizationFragments,
  inferDocumentOverlayReplacements,
  parseDocumentOverlay,
  sha256,
  withDocumentOverlayMetadata,
  type DocumentOptimizationFragment,
} from "./documentOptimizationModel.js";
import {
  migrateLegacyDocumentOptimization,
  pageOverlayPath,
  readDocumentOptimizationDecisions,
  readDocumentPageOverlay,
  removeDocumentPageOverlay,
  writeDocumentOptimizationDecisions,
  writeDocumentPageOverlay,
  type StoredDocumentOptimizationDecision,
} from "./documentOptimizationStorage.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";

export type { DocumentOptimizationFragment } from "./documentOptimizationModel.js";

export interface DocumentOptimizationStatus {
  schema: "context.document-optimization-status.v1";
  enabled: boolean;
  policy: string;
  overlay_root: string;
  overlay_pages: number;
  eligible_views: number;
  eligible_fragments: number;
  optimized_fragments: number;
  kept_fragments: number;
  override_fragments: number;
  pending_fragments: number;
  conflict_fragments: number;
  current: boolean;
  pending_fragment_ids: string[];
  conflict_fragment_ids: string[];
}

export interface DocumentOptimizationPlan extends Omit<DocumentOptimizationStatus, "schema"> {
  schema: "context.document-optimization-plan.v1";
  fragments: DocumentOptimizationFragment[];
  payload_target: string;
  next_action: { kind: "apply-document-optimization"; command: string };
}

interface ApplyDecisionInput {
  fragment_id: string;
  input_digest: string;
  context_digest: string;
  policy_digest: string;
  action: "keep" | "replace";
  replacement?: string;
  reason?: string;
}

export interface DocumentOptimizationApplyInput {
  schema: "context.document-optimization-decisions.v1";
  decisions: ApplyDecisionInput[];
}

interface ResolvedFragmentState {
  fragment: DocumentOptimizationFragment;
  state: "optimized" | "kept" | "override" | "pending" | "conflict";
  replacement?: string;
  reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decisionMatches(
  fragment: DocumentOptimizationFragment,
  decision: Pick<StoredDocumentOptimizationDecision, "input_digest" | "context_digest" | "policy_digest">,
): boolean {
  return fragment.input_digest === decision.input_digest &&
    fragment.context_digest === decision.context_digest &&
    fragment.policy_digest === decision.policy_digest;
}

function decisionForState(state: ResolvedFragmentState): StoredDocumentOptimizationDecision | null {
  if (state.state === "pending" || state.state === "conflict") return null;
  return {
    fragment_id: state.fragment.fragment_id,
    input_digest: state.fragment.input_digest,
    context_digest: state.fragment.context_digest,
    policy_digest: state.fragment.policy_digest,
    action: state.state === "kept" ? "keep" : state.state === "override" ? "override" : "replace",
    ...(state.replacement === undefined ? {} : { replacement: state.replacement }),
    ...(state.reason === undefined ? {} : { reason: state.reason }),
  };
}

async function resolveFragmentStates(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<ResolvedFragmentState[]> {
  const fragments = collectDocumentOptimizationFragments(input.files);
  const decisions = await readDocumentOptimizationDecisions(input.projectRoot);
  const byPath = new Map<string, DocumentOptimizationFragment[]>();
  for (const fragment of fragments) {
    const list = byPath.get(fragment.approved_path) ?? [];
    list.push(fragment);
    byPath.set(fragment.approved_path, list);
  }
  const states: ResolvedFragmentState[] = [];
  for (const file of input.files) {
    const pageFragments = byPath.get(file.relPath) ?? [];
    if (pageFragments.length === 0) continue;
    const rawOverlay = await readDocumentPageOverlay(input.projectRoot, file.relPath);
    if (rawOverlay === null) {
      for (const fragment of pageFragments) {
        const decision = decisions.get(fragment.fragment_id);
        states.push(decision !== undefined && decisionMatches(fragment, decision) && decision.action === "keep"
          ? { fragment, state: "kept", ...(decision.reason === undefined ? {} : { reason: decision.reason }) }
          : { fragment, state: "pending" });
      }
      continue;
    }
    const overlay = parseDocumentOverlay(rawOverlay);
    if (
      overlay === null || overlay.metadata.approved_path !== file.relPath ||
      overlay.metadata.base_digest !== sha256(file.content) ||
      overlay.metadata.policy_digest !== sha256(DOCUMENT_OPTIMIZATION_POLICY)
    ) {
      states.push(...pageFragments.map((fragment) => ({ fragment, state: "conflict" as const })));
      continue;
    }
    let replacements: Map<string, string> | null;
    try {
      replacements = inferDocumentOverlayReplacements({ file, overlayContent: overlay.content });
    } catch {
      replacements = null;
    }
    if (replacements === null) {
      states.push(...pageFragments.map((fragment) => ({ fragment, state: "conflict" as const })));
      continue;
    }
    for (const fragment of pageFragments) {
      const replacement = replacements.get(fragment.fragment_id);
      const decision = decisions.get(fragment.fragment_id);
      if (replacement !== undefined) {
        const automated = decision !== undefined && decisionMatches(fragment, decision) &&
          decision.action === "replace" && decision.replacement === replacement;
        states.push({
          fragment,
          state: automated ? "optimized" : "override",
          replacement,
          ...(decision?.reason === undefined ? {} : { reason: decision.reason }),
        });
      } else if (decision !== undefined && decisionMatches(fragment, decision) && decision.action === "keep") {
        states.push({ fragment, state: "kept", ...(decision.reason === undefined ? {} : { reason: decision.reason }) });
      } else {
        states.push({ fragment, state: "pending" });
      }
    }
  }
  return states;
}

function statusFromStates(input: {
  projectRoot: string;
  enabled: boolean;
  states: readonly ResolvedFragmentState[];
}): DocumentOptimizationStatus {
  const pending = input.states.filter((item) => item.state === "pending");
  const conflicts = input.states.filter((item) => item.state === "conflict");
  const overlayPaths = new Set(input.states
    .filter((item) => item.state === "optimized" || item.state === "override")
    .map((item) => item.fragment.approved_path));
  return {
    schema: "context.document-optimization-status.v1",
    enabled: input.enabled,
    policy: DOCUMENT_OPTIMIZATION_POLICY,
    overlay_root: documentOptimizationRoot(input.projectRoot),
    overlay_pages: overlayPaths.size,
    eligible_views: new Set(input.states.map((item) => item.fragment.view_ref)).size,
    eligible_fragments: input.states.length,
    optimized_fragments: input.states.filter((item) => item.state === "optimized").length,
    kept_fragments: input.states.filter((item) => item.state === "kept").length,
    override_fragments: input.states.filter((item) => item.state === "override").length,
    pending_fragments: pending.length,
    conflict_fragments: conflicts.length,
    current: !input.enabled || (pending.length === 0 && conflicts.length === 0),
    pending_fragment_ids: pending.map((item) => item.fragment.fragment_id),
    conflict_fragment_ids: conflicts.map((item) => item.fragment.fragment_id),
  };
}

export function disabledDocumentOptimizationStatus(projectRoot: string): DocumentOptimizationStatus {
  return statusFromStates({ projectRoot, enabled: false, states: [] });
}

export async function collectDocumentOptimizationStatus(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<DocumentOptimizationStatus> {
  const enabled = await isDocumentOptimizationEnabled(input.projectRoot);
  if (!enabled) return statusFromStates({ projectRoot: input.projectRoot, enabled, states: [] });
  return statusFromStates({ projectRoot: input.projectRoot, enabled, states: await resolveFragmentStates(input) });
}

async function prepareDocumentOptimizationStorage(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<void> {
  await migrateLegacyDocumentOptimization(input);
}

export async function createDocumentOptimizationPlan(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<DocumentOptimizationPlan> {
  const enabled = await isDocumentOptimizationEnabled(input.projectRoot);
  if (enabled) await prepareDocumentOptimizationStorage(input);
  const states = enabled ? await resolveFragmentStates(input) : [];
  const status = statusFromStates({ projectRoot: input.projectRoot, enabled, states });
  const payloadTarget = ".tmp/agent-payloads/document-optimization-decisions.json";
  return {
    ...status,
    schema: "context.document-optimization-plan.v1",
    fragments: states
      .filter((item) => item.state === "pending" || item.state === "conflict")
      .map((item) => item.fragment),
    payload_target: payloadTarget,
    next_action: {
      kind: "apply-document-optimization",
      command: `context optimize-docs apply --input ${payloadTarget} --format json`,
    },
  };
}

function parseApplyInput(value: unknown): DocumentOptimizationApplyInput {
  if (!isRecord(value) || value.schema !== "context.document-optimization-decisions.v1" || !Array.isArray(value.decisions)) {
    throw new ContextError(ExitCode.UserError, "document optimization input must match context.document-optimization-decisions.v1", {
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
      (raw.action !== "keep" && raw.action !== "replace") ||
      (raw.action === "replace" && typeof raw.replacement !== "string")
    ) {
      throw new ContextError(ExitCode.UserError, `document optimization decision ${index + 1} is invalid`, {
        category: ErrorCategory.SchemaInvalid,
      });
    }
    return raw as unknown as ApplyDecisionInput;
  });
  return { schema: "context.document-optimization-decisions.v1", decisions };
}

function storedDecision(
  fragment: DocumentOptimizationFragment,
  decision: ApplyDecisionInput,
): StoredDocumentOptimizationDecision {
  return {
    fragment_id: fragment.fragment_id,
    input_digest: fragment.input_digest,
    context_digest: fragment.context_digest,
    policy_digest: fragment.policy_digest,
    action: decision.action,
    ...(decision.replacement === undefined ? {} : { replacement: decision.replacement }),
    ...(decision.reason === undefined ? {} : { reason: decision.reason }),
  };
}

async function materializePageOverlays(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
  decisions: ReadonlyMap<string, StoredDocumentOptimizationDecision>;
}): Promise<void> {
  const fragments = collectDocumentOptimizationFragments(input.files);
  for (const file of input.files) {
    const replacements = new Map(fragments
      .filter((fragment) => fragment.approved_path === file.relPath)
      .flatMap((fragment) => {
        const decision = input.decisions.get(fragment.fragment_id);
        return decision?.replacement === undefined ? [] : [[fragment.fragment_id, decision.replacement] as const];
      }));
    await writeDocumentPageOverlay({ projectRoot: input.projectRoot, file, replacements });
  }
}

export async function applyDocumentOptimizationDecisions(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
  payload: unknown;
}): Promise<{ applied: number; status: DocumentOptimizationStatus }> {
  if (!(await isDocumentOptimizationEnabled(input.projectRoot))) {
    throw new ContextError(ExitCode.UserError, "document optimization is disabled", {
      category: ErrorCategory.WorkspaceStateInvalid,
      next: "Run context optimize-docs enable before applying decisions.",
    });
  }
  await prepareDocumentOptimizationStorage(input);
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
    if (decision.action === "replace") assertSafeDocumentOptimizationReplacement(fragment, decision.replacement!);
    return { decision, fragment };
  });
  if (seen.size !== expected.size) {
    throw new ContextError(ExitCode.UserError, "document optimization payload must resolve the complete current batch", {
      category: ErrorCategory.UserInputInvalid,
      expected: expected.size,
      received: seen.size,
    });
  }
  const decisions = new Map<string, StoredDocumentOptimizationDecision>();
  for (const state of states) {
    const decision = decisionForState(state);
    if (decision !== null) decisions.set(decision.fragment_id, decision);
  }
  for (const { decision, fragment } of validated) decisions.set(fragment.fragment_id, storedDecision(fragment, decision));
  await materializePageOverlays({ projectRoot: input.projectRoot, files: input.files, decisions });
  await writeDocumentOptimizationDecisions(input.projectRoot, decisions.values());
  return { applied: validated.length, status: await collectDocumentOptimizationStatus(input) };
}

export async function reconcileDocumentOptimizationOverlays(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<DocumentOptimizationStatus> {
  await prepareDocumentOptimizationStorage(input);
  const states = await resolveFragmentStates(input);
  const status = statusFromStates({ projectRoot: input.projectRoot, enabled: true, states });
  if (status.conflict_fragments > 0) return status;
  const decisions = states.flatMap((state) => {
    const decision = decisionForState(state);
    return decision === null ? [] : [decision];
  });
  await writeDocumentOptimizationDecisions(input.projectRoot, decisions);
  const paths = new Set(states
    .filter((state) => state.replacement !== undefined)
    .map((state) => state.fragment.approved_path));
  for (const file of input.files) {
    if (!paths.has(file.relPath) && existsSync(pageOverlayPath(input.projectRoot, file.relPath))) {
      await removeDocumentPageOverlay(input.projectRoot, file.relPath);
    }
  }
  return collectDocumentOptimizationStatus(input);
}

export async function projectDocumentOptimizedKnowledge(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<{ files: ApprovedKnowledgeFile[]; status: DocumentOptimizationStatus }> {
  const enabled = await isDocumentOptimizationEnabled(input.projectRoot);
  if (!enabled) return { files: [...input.files], status: statusFromStates({ projectRoot: input.projectRoot, enabled, states: [] }) };
  await prepareDocumentOptimizationStorage(input);
  const states = await resolveFragmentStates(input);
  const status = statusFromStates({ projectRoot: input.projectRoot, enabled, states });
  if (!status.current) return { files: [...input.files], status };
  const files = await Promise.all(input.files.map(async (file) => {
    const rawOverlay = await readDocumentPageOverlay(input.projectRoot, file.relPath);
    if (rawOverlay === null) return file;
    const overlay = parseDocumentOverlay(rawOverlay);
    return overlay === null ? file : { ...file, content: overlay.content };
  }));
  return { files, status };
}

export async function createDocumentOptimizationOverride(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
  fragmentId: string;
}): Promise<{ path: string; created: boolean; approved_path: string; line_range: string }> {
  await prepareDocumentOptimizationStorage(input);
  const fragments = collectDocumentOptimizationFragments(input.files);
  const fragment = fragments.find((item) => item.fragment_id === input.fragmentId);
  if (fragment === undefined) {
    throw new ContextError(ExitCode.UserError, `document optimization fragment not found: ${input.fragmentId}`, {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const file = input.files.find((item) => item.relPath === fragment.approved_path)!;
  const path = pageOverlayPath(input.projectRoot, file.relPath);
  const created = !existsSync(path);
  if (created) {
    const states = await resolveFragmentStates({ projectRoot: input.projectRoot, files: input.files });
    const replacements = new Map(states
      .filter((state) => state.fragment.approved_path === file.relPath && state.replacement !== undefined)
      .map((state) => [state.fragment.fragment_id, state.replacement!]));
    const content = withDocumentOverlayMetadata({
      content: file.content,
      approvedPath: file.relPath,
      baseDigest: sha256(file.content),
      optimizedFragments: replacements.size,
    });
    await mkdir(dirname(path), { recursive: true });
    await atomicWriteFile(path, content);
  }
  return { path, created, approved_path: file.relPath, line_range: fragment.line_range };
}
