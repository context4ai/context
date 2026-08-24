import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { readCandidateRecords, type CandidateRecord } from "./candidateLedger.js";
import { isApprovedKnowledgeMarkdownPath } from "./knowledgeFileClassification.js";
import { parseAlignPayload } from "./proseAlignPayloadParse.js";
import type { AlignPayload, StructureViewPlan } from "./proseAlignTypes.js";
import {
  activeStructureSlots,
  readStructureSnapshotPayload,
  writeStructureSnapshot,
} from "./proseStructureStore.js";
import { parseFrontmatterLoose } from "./verifyFrontmatter.js";
import { withProjectWriteLock } from "./writeLock.js";

export interface ReviewPathIdentityConflict {
  kind: "candidate-path-owned-by-other-identity" | "approved-identity-at-other-path";
  candidateId: string;
  collection: string;
  path: string;
  candidatePath: string;
  approvedPath: string;
  sourceKey?: string;
  structureDigest?: string;
  existingViewRef?: string;
  existingNodeRef?: string;
  candidateViewRef: string;
  candidateNodeRef: string;
}

export interface ReviewPathIdentityConflictStatus {
  count: number;
  sourceKeys: string[];
  conflicts: ReviewPathIdentityConflict[];
}

function candidateSourceKey(record: CandidateRecord): string | undefined {
  return record.source === undefined
    ? undefined
    : `${record.source.type}:${record.source.name}`;
}

function activeSlotKey(sourceKey: string, collection: string): string {
  return `${sourceKey}\u0000${collection}`;
}

interface ApprovedPageIdentity {
  path: string;
  viewRef: string;
  nodeRef?: string;
}

function toPosixPath(value: string): string {
  return value.split(/[\\/]+/u).join("/");
}

async function approvedPageIdentities(projectRoot: string): Promise<{
  byPath: Map<string, ApprovedPageIdentity>;
  byViewRef: Map<string, ApprovedPageIdentity>;
}> {
  const root = join(projectRoot, "knowledge");
  const identities: ApprovedPageIdentity[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !isApprovedKnowledgeMarkdownPath(entry.name)) continue;
      const frontmatter = parseFrontmatterLoose(await readFile(absolutePath, "utf8"));
      const viewRef = typeof frontmatter.view_ref === "string" ? frontmatter.view_ref : undefined;
      if (viewRef === undefined) continue;
      identities.push({
        path: toPosixPath(relative(root, absolutePath)),
        viewRef,
        ...(typeof frontmatter.node_ref === "string" ? { nodeRef: frontmatter.node_ref } : {}),
      });
    }
  };
  if (existsSync(root)) await visit(root);
  return {
    byPath: new Map(identities.map((identity) => [identity.path, identity])),
    byViewRef: new Map(identities.map((identity) => [identity.viewRef, identity])),
  };
}

export async function readReviewPathIdentityConflicts(
  projectRoot: string,
): Promise<ReviewPathIdentityConflictStatus> {
  const activeSlots = new Map((await activeStructureSlots(projectRoot)).map((slot) => [
    activeSlotKey(slot.source, slot.collection),
    slot.structureDigest,
  ]));
  const approved = await approvedPageIdentities(projectRoot);
  const conflicts: ReviewPathIdentityConflict[] = [];
  for (const record of await readCandidateRecords(projectRoot)) {
    if (record.status !== "draft" || record.candidate_type !== "prose-align") continue;
    const sourceKey = candidateSourceKey(record);
    if (sourceKey === undefined || record.structure_digest === undefined) continue;
    if (activeSlots.get(activeSlotKey(sourceKey, record.collection)) !== record.structure_digest) continue;
    const sameView = approved.byViewRef.get(record.view_ref);
    const samePath = approved.byPath.get(record.path);
    const identityMoved = sameView !== undefined && sameView.path !== record.path;
    const pathReassigned = samePath !== undefined &&
      (samePath.viewRef !== record.view_ref || samePath.nodeRef !== record.node_ref);
    if (!identityMoved && !pathReassigned) continue;
    const existing = identityMoved ? sameView : samePath!;
    conflicts.push({
      kind: identityMoved
        ? "approved-identity-at-other-path"
        : "candidate-path-owned-by-other-identity",
      candidateId: record.candidate_id,
      collection: record.collection,
      path: record.path,
      candidatePath: record.path,
      approvedPath: existing.path,
      ...(sourceKey === undefined ? {} : { sourceKey }),
      ...(record.structure_digest === undefined ? {} : { structureDigest: record.structure_digest }),
      existingViewRef: existing.viewRef,
      ...(existing.nodeRef === undefined ? {} : { existingNodeRef: existing.nodeRef }),
      candidateViewRef: record.view_ref,
      candidateNodeRef: record.node_ref,
    });
  }
  conflicts.sort((left, right) =>
    (left.sourceKey ?? "").localeCompare(right.sourceKey ?? "") ||
    left.path.localeCompare(right.path) ||
    left.candidateId.localeCompare(right.candidateId)
  );
  return {
    count: conflicts.length,
    sourceKeys: [...new Set(conflicts.flatMap((conflict) =>
      conflict.sourceKey === undefined ? [] : [conflict.sourceKey]
    ))].sort(),
    conflicts,
  };
}

function replaceRef(value: string, replacements: ReadonlyMap<string, string>): string {
  const direct = replacements.get(value);
  if (direct !== undefined) return direct;
  for (const [from, to] of replacements) {
    if (value.startsWith(`${from}#`)) return `${to}${value.slice(from.length)}`;
  }
  return value;
}

function repairedStructurePayload(input: {
  structure: AlignPayload;
  conflicts: readonly ReviewPathIdentityConflict[];
}): AlignPayload {
  const replacements = new Map<string, string>();
  const approvedPaths = new Map<string, string>();
  for (const conflict of input.conflicts) {
    if (conflict.kind === "approved-identity-at-other-path") {
      approvedPaths.set(conflict.candidateViewRef, conflict.approvedPath);
      continue;
    }
    if (conflict.existingViewRef === undefined || conflict.existingNodeRef === undefined) {
      throw new ContextError(ExitCode.WorkspaceStateError, "approved path identity is incomplete", {
        category: ErrorCategory.WorkspaceStateInvalid,
        path: conflict.path,
        candidate_id: conflict.candidateId,
        next: "Repair the approved page identity before coordinating Review.",
      });
    }
    replacements.set(conflict.candidateViewRef, conflict.existingViewRef);
    replacements.set(conflict.candidateNodeRef, conflict.existingNodeRef);
  }
  const nodes = input.structure.nodes.map((node) => ({
    ...node,
    node_ref: replaceRef(node.node_ref, replacements),
  }));
  const views = input.structure.views.map((view): StructureViewPlan => {
    const approvedPath = approvedPaths.get(view.view_ref);
    const pathParts = approvedPath === undefined
      ? undefined
      : approvedViewPathParts(approvedPath, view.collection);
    return {
      ...view,
      view_ref: replaceRef(view.view_ref, replacements),
      node_ref: replaceRef(view.node_ref, replacements),
      ...(pathParts === undefined ? {} : pathParts),
      sections: view.sections.map((section) => ({
        ...section,
        section_ref: replaceRef(section.section_ref, replacements),
      })),
    };
  });
  const body = {
    schema_version: input.structure.schema_version,
    sources: input.structure.sources,
    evidence_snapshot_hash: input.structure.evidence_snapshot_hash,
    nodes,
    views,
    edges: input.structure.edges.map((edge) => ({
      ...edge,
      from: replaceRef(edge.from, replacements),
      to: replaceRef(edge.to, replacements),
    })),
    unresolved: input.structure.unresolved,
    ...(input.structure.user_or_agent_hints === undefined
      ? {}
      : {
          user_or_agent_hints: {
            ...input.structure.user_or_agent_hints,
            ...(input.structure.user_or_agent_hints.preferred_nodes === undefined
              ? {}
              : {
                  preferred_nodes: input.structure.user_or_agent_hints.preferred_nodes.map((preferred) => ({
                    ...preferred,
                    node_ref: replaceRef(preferred.node_ref, replacements),
                  })),
                }),
          },
        }),
    lifecycle: { state: "draft" as const },
  };
  const draft = parseAlignPayload(body);
  if (draft.payload === undefined || draft.diagnostics.some((item) => item.severity === "error")) {
    throw new ContextError(ExitCode.WorkspaceStateError, "preserving approved identities produced an invalid structure", {
      category: ErrorCategory.WorkspaceStateInvalid,
      diagnostics: draft.diagnostics,
      next: "Return to structure planning and resolve the identity conflict explicitly.",
    });
  }
  const confirmed = parseAlignPayload({
    ...body,
    lifecycle: {
      state: "confirmed",
      phase_collection: input.structure.lifecycle.phase_collection,
      confirmed_by: "approved-identity-reconciliation",
      confirmed_at: input.structure.lifecycle.confirmed_at ?? "structure-snapshot",
      structure_digest: draft.payload.structure_digest,
    },
  });
  if (confirmed.payload === undefined || confirmed.diagnostics.some((item) => item.severity === "error")) {
    throw new ContextError(ExitCode.WorkspaceStateError, "preserving approved identities could not be confirmed", {
      category: ErrorCategory.WorkspaceStateInvalid,
      diagnostics: confirmed.diagnostics,
      next: "Return to structure planning and resolve the identity conflict explicitly.",
    });
  }
  return confirmed.payload;
}

function approvedViewPathParts(
  approvedPath: string,
  collection: string,
): Pick<StructureViewPlan, "containment" | "slug" | "path"> {
  const normalized = toPosixPath(approvedPath);
  const prefix = `${collection}/`;
  if (!normalized.startsWith(prefix) || !normalized.endsWith(".md")) {
    throw new ContextError(ExitCode.WorkspaceStateError, "approved view path cannot be represented by the structure contract", {
      category: ErrorCategory.WorkspaceStateInvalid,
      approved_path: approvedPath,
      collection,
      next: "Repair the approved page path before coordinating Review.",
    });
  }
  const withinCollection = normalized.slice(prefix.length);
  const segments = withinCollection.split("/");
  const fileName = segments.at(-1)!;
  const slug = basename(fileName, ".md");
  const containment = segments.slice(0, -1).join("/") || "root";
  return { containment, slug, path: normalized };
}

export interface PreserveApprovedIdentityResult {
  kind: "review.identity-reconciliation.result";
  strategy: "preserve-approved";
  source: string;
  conflictsResolved: number;
  affectedViews: number;
  previousStructureDigests: string[];
  structureDigests: string[];
  migrationPerformed: false;
  next_action: {
    kind: "reevaluate_workspace";
    command: "context status --format json";
    reason_code: "review-identities-preserved";
  };
}

export async function preserveApprovedPathIdentities(input: {
  projectRoot: string;
  sourceKey: string;
}): Promise<PreserveApprovedIdentityResult> {
  return withProjectWriteLock(input.projectRoot, "review-preserve-approved-identities", async () => {
    const status = await readReviewPathIdentityConflicts(input.projectRoot);
    const conflicts = status.conflicts.filter((conflict) => conflict.sourceKey === input.sourceKey);
    if (conflicts.length === 0) {
      throw new ContextError(ExitCode.WorkspaceStateError, `no current approved path identity conflicts exist for ${input.sourceKey}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        source: input.sourceKey,
        next: "context status --format json",
      });
    }
    if (conflicts.some((conflict) => conflict.structureDigest === undefined)) {
      throw new ContextError(ExitCode.WorkspaceStateError, "approved identity preservation supports source-bound prose candidates only", {
        category: ErrorCategory.WorkspaceStateInvalid,
        source: input.sourceKey,
        next: "Return to the owning extraction or structure phase and resolve the path identity explicitly.",
      });
    }
    const groups = new Map<string, ReviewPathIdentityConflict[]>();
    for (const conflict of conflicts) {
      const digest = conflict.structureDigest!;
      groups.set(digest, [...(groups.get(digest) ?? []), conflict]);
    }
    const repaired: Array<{ previous: string; payload: AlignPayload; conflicts: number }> = [];
    for (const [structureDigest, group] of groups) {
      const structure = await readStructureSnapshotPayload(input.projectRoot, structureDigest);
      if (structure === undefined) {
        throw new ContextError(ExitCode.WorkspaceStateError, `identity-conflicted structure snapshot is missing: ${structureDigest}`, {
          category: ErrorCategory.WorkspaceStateInvalid,
          source: input.sourceKey,
          structure_digest: structureDigest,
          next: "Rerun the owning align phase before coordinating Review.",
        });
      }
      repaired.push({
        previous: structureDigest,
        payload: repairedStructurePayload({ structure, conflicts: group }),
        conflicts: group.length,
      });
    }
    for (const item of repaired) await writeStructureSnapshot(input.projectRoot, item.payload);
    return {
      kind: "review.identity-reconciliation.result",
      strategy: "preserve-approved",
      source: input.sourceKey,
      conflictsResolved: repaired.reduce((count, item) => count + item.conflicts, 0),
      affectedViews: repaired.reduce((count, item) => count + item.payload.views.length, 0),
      previousStructureDigests: repaired.map((item) => item.previous).sort(),
      structureDigests: repaired.map((item) => item.payload.structure_digest).sort(),
      migrationPerformed: false,
      next_action: {
        kind: "reevaluate_workspace",
        command: "context status --format json",
        reason_code: "review-identities-preserved",
      },
    };
  });
}
