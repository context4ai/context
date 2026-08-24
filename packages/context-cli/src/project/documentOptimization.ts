import { readFile } from "node:fs/promises";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  DOCUMENT_OPTIMIZATION_POLICY,
  enableDocumentOptimization,
  isDocumentOptimizationEnabled,
} from "./documentOptimizationConfig.js";
import {
  assertSafeDocumentOptimizationReplacement,
  collectDocumentOptimizationFragments,
  inferDocumentRevisionReplacements,
  parseDocumentRevision,
  sha256,
  type DocumentOptimizationFragment,
} from "./documentOptimizationModel.js";
import {
  documentRevisionPath,
  documentOptimizationPageKeepKey,
  ensureDocumentRevision,
  listDocumentRevisionFiles,
  readDocumentOptimizationKeptPages,
  readDocumentRevision,
  removeDocumentRevision,
  writeDocumentOptimizationKeptPages,
  writeDocumentRevision,
} from "./documentOptimizationStorage.js";
import {
  clearDocumentRevisionRequest,
  collectDocumentRevisionTargets,
  documentRevisionRequestPath,
  readDocumentRevisionRequest,
  resolveDocumentRevisionTarget,
  writeDocumentRevisionRequest,
  type DocumentRevisionTarget,
} from "./documentRevisionRequest.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";

export type { DocumentOptimizationFragment } from "./documentOptimizationModel.js";

export interface DocumentOptimizationStatus {
  schema: "context.document-optimization-status.v2";
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
}

export interface DocumentOptimizationPlan extends Omit<DocumentOptimizationStatus, "schema"> {
  schema: "context.document-optimization-plan.v2";
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
  state: "revised" | "kept" | "pending" | "conflict";
  replacement?: string;
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
  const fragments = collectDocumentOptimizationFragments(input.files);
  await assertRevisionOwnership({ ...input, fragments });
  const keptPages = await readDocumentOptimizationKeptPages(input.projectRoot);
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
    const rawRevision = await readDocumentRevision(input.projectRoot, file.relPath);
    if (rawRevision === null) {
      const pageKept = keptPages.has(documentOptimizationPageKeepKey(file));
      states.push(...pageFragments.map((fragment) => ({
        fragment,
        state: pageKept ? "kept" as const : "pending" as const,
      })));
      continue;
    }
    const revision = parseDocumentRevision(rawRevision);
    if (revision === null || revision.baseDigest !== sha256(file.content)) {
      states.push(...pageFragments.map((fragment) => ({ fragment, state: "conflict" as const })));
      continue;
    }
    let replacements: Map<string, string> | null;
    try {
      replacements = inferDocumentRevisionReplacements({ file, revisionContent: revision.content });
    } catch {
      replacements = null;
    }
    if (replacements === null) {
      states.push(...pageFragments.map((fragment) => ({ fragment, state: "conflict" as const })));
      continue;
    }
    for (const fragment of pageFragments) {
      const replacement = replacements.get(fragment.fragment_id);
      if (replacement !== undefined) {
        states.push({ fragment, state: "revised", replacement });
        continue;
      }
      states.push({ fragment, state: "kept" });
    }
  }
  return states;
}

function statusFromStates(input: {
  enabled: boolean;
  states: readonly ResolvedFragmentState[];
  requestedApprovedPath?: string;
}): DocumentOptimizationStatus {
  const pending = input.states.filter((item) => item.state === "pending");
  const conflicts = input.states.filter((item) => item.state === "conflict");
  const revisionPaths = new Set(input.states
    .filter((item) => item.state === "revised")
    .map((item) => item.fragment.approved_path));
  return {
    schema: "context.document-optimization-status.v2",
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
  return statusFromStates({
    enabled,
    states: await resolveFragmentStates(input),
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
  const status = statusFromStates({
    enabled,
    states,
    ...(request === null ? {} : { requestedApprovedPath: request.approved_path }),
  });
  const payloadTarget = ".tmp/agent-payloads/document-optimization-decisions.json";
  return {
    ...status,
    schema: "context.document-optimization-plan.v2",
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

function decisionMatches(fragment: DocumentOptimizationFragment, decision: ApplyDecisionInput): boolean {
  return fragment.input_digest === decision.input_digest &&
    fragment.context_digest === decision.context_digest &&
    fragment.policy_digest === decision.policy_digest;
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

  const keptPages = new Set<string>();
  const replacementsByPath = new Map<string, Map<string, string>>();
  for (const state of states) {
    if (state.state !== "revised" || state.replacement === undefined) continue;
    const replacements = replacementsByPath.get(state.fragment.approved_path) ?? new Map<string, string>();
    replacements.set(state.fragment.fragment_id, state.replacement);
    replacementsByPath.set(state.fragment.approved_path, replacements);
  }
  for (const { decision, fragment } of validated) {
    const replacements = replacementsByPath.get(fragment.approved_path) ?? new Map<string, string>();
    if (decision.action === "keep") {
      replacements.delete(fragment.fragment_id);
    } else {
      replacements.set(fragment.fragment_id, decision.replacement!);
    }
    replacementsByPath.set(fragment.approved_path, replacements);
  }
  for (const file of input.files) {
    const replacements = replacementsByPath.get(file.relPath) ?? new Map();
    await writeDocumentRevision({
      projectRoot: input.projectRoot,
      file,
      replacements,
    });
    if (
      replacements.size === 0 &&
      states.some((state) => state.fragment.approved_path === file.relPath)
    ) keptPages.add(documentOptimizationPageKeepKey(file));
  }
  await writeDocumentOptimizationKeptPages(input.projectRoot, keptPages);
  return { applied: validated.length, status: await collectDocumentOptimizationStatus(input) };
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
  const keptPages = new Set<string>();
  for (const file of input.files) {
    const replacements = new Map(states
      .filter((state) => state.fragment.approved_path === file.relPath && state.state === "revised" && state.replacement !== undefined)
      .map((state) => [state.fragment.fragment_id, state.replacement!]));
    await writeDocumentRevision({ projectRoot: input.projectRoot, file, replacements });
    if (replacements.size === 0 && states.some((state) => state.fragment.approved_path === file.relPath)) {
      keptPages.add(documentOptimizationPageKeepKey(file));
    }
  }
  await writeDocumentOptimizationKeptPages(input.projectRoot, keptPages);
  return collectDocumentOptimizationStatus(input);
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
  const files = await Promise.all(input.files.map(async (file) => {
    const rawRevision = await readDocumentRevision(input.projectRoot, file.relPath);
    if (rawRevision === null) return file;
    const revision = parseDocumentRevision(rawRevision);
    return revision === null ? file : { ...file, content: revision.content };
  }));
  return { files, status };
}

export async function createDocumentOptimizationRevision(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
  fragmentId: string;
}): Promise<{ path: string; created: boolean; approved_path: string; line_range: string }> {
  const fragments = collectDocumentOptimizationFragments(input.files);
  const fragment = fragments.find((item) => item.fragment_id === input.fragmentId);
  if (fragment === undefined) {
    throw new ContextError(ExitCode.UserError, `document optimization fragment not found: ${input.fragmentId}`, {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const file = input.files.find((item) => item.relPath === fragment.approved_path)!;
  const revision = await ensureDocumentRevision({ projectRoot: input.projectRoot, file });
  return { path: revision.path, created: revision.created, approved_path: file.relPath, line_range: fragment.line_range };
}

export interface DocumentRevisionEntryResult {
  schema: "context.document-revision-entry.v1";
  status: "started" | "target-selection-required";
  selector: string;
  target?: DocumentRevisionTarget;
  candidates?: DocumentRevisionTarget[];
  revision_path?: string;
  created?: boolean;
  next_action?: { kind: "reevaluate-workspace"; command: string };
}

export async function beginDocumentRevision(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
  selector: string;
}): Promise<DocumentRevisionEntryResult> {
  const targets = collectDocumentRevisionTargets(input.files);
  const resolution = resolveDocumentRevisionTarget(targets, input.selector);
  if (resolution.target === undefined) {
    return {
      schema: "context.document-revision-entry.v1",
      status: "target-selection-required",
      selector: input.selector,
      candidates: resolution.candidates.slice(0, 20),
    };
  }

  const target = resolution.target;
  const active = await readDocumentRevisionRequest(input.projectRoot);
  if (active !== null && active.approved_path === target.approved_path) {
    return {
      schema: "context.document-revision-entry.v1",
      status: "started",
      selector: input.selector,
      target,
      revision_path: documentRevisionRequestPath(target.approved_path),
      created: false,
      next_action: { kind: "reevaluate-workspace", command: "context status --format json" },
    };
  }
  if (active !== null) {
    const activeRevision = await readDocumentRevision(input.projectRoot, active.approved_path);
    if (activeRevision === null || sha256(activeRevision) !== active.revision_digest) {
      throw new ContextError(ExitCode.WorkspaceStateError, "another document revision is already awaiting validation", {
        category: ErrorCategory.WorkspaceStateInvalid,
        approved_path: active.approved_path,
        next: "Finish the current revision and run context optimize-docs validate before selecting another page.",
      });
    }
    await removeDocumentRevision(input.projectRoot, active.approved_path);
  }

  const wasEnabled = await isDocumentOptimizationEnabled(input.projectRoot);
  if (!wasEnabled) {
    await enableDocumentOptimization(input.projectRoot);
    await writeDocumentOptimizationKeptPages(
      input.projectRoot,
      input.files
        .filter((file) => collectDocumentOptimizationFragments([file]).length > 0)
        .map(documentOptimizationPageKeepKey),
    );
  }
  const file = input.files.find((item) => item.relPath === target.approved_path)!;
  const revision = await ensureDocumentRevision({ projectRoot: input.projectRoot, file });
  await writeDocumentRevisionRequest({
    projectRoot: input.projectRoot,
    approvedPath: target.approved_path,
    revisionContent: revision.content,
  });
  return {
    schema: "context.document-revision-entry.v1",
    status: "started",
    selector: input.selector,
    target,
    revision_path: documentRevisionRequestPath(target.approved_path),
    created: revision.created,
    next_action: { kind: "reevaluate-workspace", command: "context status --format json" },
  };
}

export async function currentDocumentRevisionPlan(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<{
  schema: "context.document-revision-plan.v1";
  target: DocumentRevisionTarget;
  revision_path: string;
  changed: boolean;
  next_action: { kind: "validate-document-revision"; command: string };
}> {
  const request = await readDocumentRevisionRequest(input.projectRoot);
  if (request === null) {
    throw new ContextError(ExitCode.WorkspaceStateError, "no document revision is currently requested", {
      category: ErrorCategory.WorkspaceStateInvalid,
      next: "Run context revise \"<document title or approved path>\" --format json first.",
    });
  }
  const target = collectDocumentRevisionTargets(input.files)
    .find((item) => item.approved_path === request.approved_path);
  const revision = await readDocumentRevision(input.projectRoot, request.approved_path);
  if (target === undefined || revision === null) {
    throw new ContextError(ExitCode.WorkspaceStateError, "the requested document revision no longer resolves", {
      category: ErrorCategory.WorkspaceStateInvalid,
      approved_path: request.approved_path,
      next: "Restore the approved page and its revision, or disable document optimization.",
    });
  }
  return {
    schema: "context.document-revision-plan.v1",
    target,
    revision_path: documentRevisionRequestPath(target.approved_path),
    changed: sha256(revision) !== request.revision_digest,
    next_action: {
      kind: "validate-document-revision",
      command: "context optimize-docs validate --format json",
    },
  };
}

export async function validateDocumentOptimizationRevisions(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<DocumentOptimizationStatus> {
  const request = await readDocumentRevisionRequest(input.projectRoot);
  if (request !== null) {
    const path = documentRevisionPath(input.projectRoot, request.approved_path);
    let revision: string;
    try {
      revision = await readFile(path, "utf8");
    } catch {
      throw new ContextError(ExitCode.WorkspaceStateError, "the requested document revision file is missing", {
        category: ErrorCategory.WorkspaceStateInvalid,
        approved_path: request.approved_path,
      });
    }
    if (sha256(revision) === request.revision_digest) {
      throw new ContextError(ExitCode.UserError, "the requested document revision has not changed", {
        category: ErrorCategory.UserInputInvalid,
        approved_path: request.approved_path,
        next: `Edit ${documentRevisionRequestPath(request.approved_path)}, then rerun context optimize-docs validate.`,
      });
    }
  }
  const status = await reconcileDocumentOptimizationRevisions(input);
  if (status.conflict_fragments === 0 && request !== null) {
    await clearDocumentRevisionRequest(input.projectRoot);
    return collectDocumentOptimizationStatus(input);
  }
  return status;
}
