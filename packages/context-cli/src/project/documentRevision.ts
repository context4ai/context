import { readFile } from "node:fs/promises";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { enableDocumentOptimization, isDocumentOptimizationEnabled } from "./documentOptimizationConfig.js";
import {
  collectDocumentOptimizationFragments,
  fragmentSectionState,
  sha256,
} from "./documentOptimizationModel.js";
import {
  documentRevisionPath,
  ensureDocumentRevision,
  readDocumentRevision,
  removeDocumentRevision,
  writeDocumentOptimizationKeepState,
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
import {
  collectDocumentOptimizationStatus,
  reconcileDocumentOptimizationRevisions,
  type DocumentOptimizationStatus,
} from "./documentOptimization.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";

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
  const revision = await ensureDocumentRevision({
    projectRoot: input.projectRoot,
    file,
    fragments: fragments.filter((candidate) => candidate.approved_path === file.relPath),
  });
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
  let currentFiles = [...input.files];
  if (!wasEnabled) {
    await enableDocumentOptimization(input.projectRoot);
    currentFiles = await Promise.all(input.files.map(async (file) => {
      const fragments = collectDocumentOptimizationFragments([file]);
      return fragments.length === 0 ? file : writeDocumentOptimizationKeepState({
        projectRoot: input.projectRoot,
        file,
        sections: new Map(fragments.map((fragment) => [fragment.section_id, fragmentSectionState(fragment)])),
      });
    }));
  }
  const file = currentFiles.find((item) => item.relPath === target.approved_path)!;
  const revision = await ensureDocumentRevision({
    projectRoot: input.projectRoot,
    file,
    fragments: collectDocumentOptimizationFragments([file]),
  });
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
