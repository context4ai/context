import { readFile, writeFile } from "node:fs/promises";
import { loadSourcesRegistry } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  buildCommittedEvidenceIndex,
  resolveProseSourceRef,
  type ResolvedProseSourceRef,
} from "./documentEvidenceIndex.js";
import {
  approvedPageForViewRef,
  parseApprovedSources,
  parseCanonicalProseRef,
  updateFrontmatter,
  writeReviewActionLog,
  type ReviewMaintenanceResult,
} from "./reviewShared.js";
import { withProjectWriteLock } from "./writeLock.js";

export const EVIDENCE_MAINTENANCE_SCHEMA =
  "context.evidence-maintenance.v1";

export type EvidenceMaintenanceAction =
  | "re-pin"
  | "deprecate"
  | "keep-orphaned";

export interface EvidenceMaintenanceDecision {
  view_ref: string;
  action: EvidenceMaintenanceAction;
}

export interface EvidenceMaintenanceResult {
  schema: "context.evidence-maintenance.result.v1";
  applied: number;
  results: Array<ReviewMaintenanceResult & {
    action: EvidenceMaintenanceAction;
  }>;
}

interface PreparedMaintenance {
  decision: EvidenceMaintenanceDecision;
  page: { path: string; relPath: string };
  content: string;
  changed: boolean;
  refsUpdated?: number;
}

function localSpanRefs(
  content: string,
): Array<{ full: string; sourceIndex: number; spanBody: string }> {
  const refs: Array<{
    full: string;
    sourceIndex: number;
    spanBody: string;
  }> = [];
  const regex = /source_ref="(src-(\d+)#span:[^"]+)"/giu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const full = match[1];
    const index = Number(match[2]);
    if (
      full === undefined ||
      !Number.isInteger(index) ||
      index < 1
    ) {
      continue;
    }
    refs.push({
      full,
      sourceIndex: index,
      spanBody: full.replace(/^src-\d+/iu, ""),
    });
  }
  return refs;
}

function withoutEvidenceStatus(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...frontmatter };
  delete next.evidence_status;
  return next;
}

async function resolveCurrentProseRef(input: {
  projectRoot: string;
  source: string;
  spanBody: string;
}): Promise<ResolvedProseSourceRef> {
  const parsed = parseCanonicalProseRef(`${input.source}${input.spanBody}`);
  if (parsed === null) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      `approved source_ref is not a canonical prose ref: ${input.source}${input.spanBody}`,
      {
        category: ErrorCategory.SchemaInvalid,
        next:
          "Create a replacement Candidate through the current Indexer lifecycle or fix the approved source_ref.",
      },
    );
  }
  const registry = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const entry = parsed.sourceType === "file"
    ? registry.files.find((source) =>
      source.name === parsed.sourceName || source.id === parsed.sourceName
    )
    : registry.larks.find((source) =>
      source.name === parsed.sourceName || source.id === parsed.sourceName
    );
  if (entry === undefined) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      `approved source is not registered: ${parsed.sourceType}:${parsed.sourceName}`,
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        next: "Restore the source registry entry or deprecate the approved page.",
      },
    );
  }
  const indexResult = await buildCommittedEvidenceIndex({
    projectRoot: input.projectRoot,
    sourceType: parsed.sourceType,
    sourceName: parsed.sourceName,
    materializedAt: entry.materializedAt,
    ...(entry.snapshot?.manifest === undefined
      ? {}
      : { manifestPath: entry.snapshot.manifest }),
  });
  const resolved = await resolveProseSourceRef({
    projectRoot: input.projectRoot,
    index: indexResult.index,
    sourceRef: `${input.source}${input.spanBody}`,
    snapshotMarkdownCache: indexResult.snapshotMarkdownCache,
  });
  if (resolved === null) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      `approved source_ref cannot be re-pinned: ${input.source}${input.spanBody}`,
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        next:
          "Create a replacement review candidate, deprecate the page, or explicitly keep it as source-orphaned knowledge.",
      },
    );
  }
  return resolved;
}

async function prepareRePin(input: {
  projectRoot: string;
  decision: EvidenceMaintenanceDecision;
  page: PreparedMaintenance["page"];
  original: string;
}): Promise<PreparedMaintenance> {
  const sources = parseApprovedSources(input.original);
  if (sources.length === 0) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      `approved page has no prose sources: ${input.decision.view_ref}`,
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        next:
          "Create a replacement review candidate or fix frontmatter sources.",
      },
    );
  }
  const refs = localSpanRefs(input.original);
  if (refs.length === 0) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      `approved page has no document span source_refs to re-pin: ${input.decision.view_ref}`,
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        next:
          "Only approved prose pages with document span source_refs can be re-pinned.",
      },
    );
  }
  let content = input.original;
  let refsUpdated = 0;
  for (const ref of refs) {
    const source = sources[ref.sourceIndex - 1];
    if (source === undefined) {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        `source_ref ${ref.full} has no matching frontmatter source`,
        { category: ErrorCategory.SchemaInvalid },
      );
    }
    const resolved = await resolveCurrentProseRef({
      projectRoot: input.projectRoot,
      source,
      spanBody: ref.spanBody,
    });
    const current = parseCanonicalProseRef(
      resolved.span.canonical_source_ref,
    );
    if (current === null || current.locator !== source) {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        `source_ref cannot be re-pinned to a unique source span: ${ref.full}`,
        {
          category: ErrorCategory.WorkspaceStateInvalid,
          next: "Create a replacement Candidate through the current Indexer lifecycle.",
        },
      );
    }
    if (!resolved.hashMatches || resolved.status === "content-drift") {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        `approved source_ref content changed and cannot be re-pinned without rewriting the approved body: ${ref.full}`,
        {
          category: ErrorCategory.WorkspaceStateInvalid,
          candidate_id: input.decision.view_ref,
          status: resolved.status,
          next:
            "Create a replacement Candidate through the current Indexer lifecycle, or deprecate the approved page.",
        },
      );
    }
    const nextRef = `src-${ref.sourceIndex}${current.spanBody}`;
    if (nextRef !== ref.full) {
      content = content.replace(
        `source_ref="${ref.full}"`,
        `source_ref="${nextRef}"`,
      );
      refsUpdated++;
    }
  }
  content = updateFrontmatter(content, withoutEvidenceStatus);
  return {
    decision: input.decision,
    page: input.page,
    content,
    changed: content !== input.original,
    refsUpdated,
  };
}

function prepareFrontmatterMaintenance(input: {
  decision: EvidenceMaintenanceDecision;
  page: PreparedMaintenance["page"];
  original: string;
}): PreparedMaintenance {
  const content = updateFrontmatter(input.original, (frontmatter) => {
    if (input.decision.action === "deprecate") {
      return {
        ...withoutEvidenceStatus(frontmatter),
        deprecated: true,
      };
    }
    return {
      ...frontmatter,
      evidence_status: "source-orphaned",
    };
  });
  return {
    decision: input.decision,
    page: input.page,
    content,
    changed: content !== input.original,
  };
}

async function prepareDecision(input: {
  projectRoot: string;
  decision: EvidenceMaintenanceDecision;
}): Promise<PreparedMaintenance> {
  const page = await approvedPageForViewRef(
    input.projectRoot,
    input.decision.view_ref,
  );
  const original = await readFile(page.path, "utf8");
  if (input.decision.action === "re-pin") {
    return prepareRePin({
      projectRoot: input.projectRoot,
      decision: input.decision,
      page,
      original,
    });
  }
  return prepareFrontmatterMaintenance({
    decision: input.decision,
    page,
    original,
  });
}

export function parseEvidenceMaintenancePayload(
  value: unknown,
): EvidenceMaintenanceDecision[] {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new ContextError(
      ExitCode.UserError,
      "evidence maintenance payload must be an object",
      { category: ErrorCategory.UserInputInvalid },
    );
  }
  const payload = value as Record<string, unknown>;
  const unknownPayloadKey = Object.keys(payload).find((key) =>
    key !== "schema" && key !== "decisions"
  );
  if (unknownPayloadKey !== undefined) {
    throw new ContextError(
      ExitCode.UserError,
      `evidence maintenance payload has unknown field: ${unknownPayloadKey}`,
      { category: ErrorCategory.UserInputInvalid },
    );
  }
  if (payload.schema !== EVIDENCE_MAINTENANCE_SCHEMA) {
    throw new ContextError(
      ExitCode.UserError,
      `evidence maintenance payload schema must be ${EVIDENCE_MAINTENANCE_SCHEMA}`,
      { category: ErrorCategory.UserInputInvalid },
    );
  }
  if (!Array.isArray(payload.decisions) || payload.decisions.length === 0) {
    throw new ContextError(
      ExitCode.UserError,
      "evidence maintenance payload decisions must be a non-empty array",
      { category: ErrorCategory.UserInputInvalid },
    );
  }
  const validActions = new Set<EvidenceMaintenanceAction>([
    "re-pin",
    "deprecate",
    "keep-orphaned",
  ]);
  const decisions = payload.decisions.map((raw, index) => {
    if (
      raw === null ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      throw new ContextError(
        ExitCode.UserError,
        `evidence maintenance decision ${index} must be an object`,
        { category: ErrorCategory.UserInputInvalid },
      );
    }
    const decision = raw as Record<string, unknown>;
    const unknownDecisionKey = Object.keys(decision).find((key) =>
      key !== "view_ref" && key !== "action"
    );
    if (unknownDecisionKey !== undefined) {
      throw new ContextError(
        ExitCode.UserError,
        `evidence maintenance decision ${index} has unknown field: ${unknownDecisionKey}`,
        { category: ErrorCategory.UserInputInvalid },
      );
    }
    if (
      typeof decision.view_ref !== "string" ||
      decision.view_ref.trim().length === 0 ||
      typeof decision.action !== "string" ||
      !validActions.has(decision.action as EvidenceMaintenanceAction)
    ) {
      throw new ContextError(
        ExitCode.UserError,
        `evidence maintenance decision ${index} requires view_ref and action=re-pin|deprecate|keep-orphaned`,
        { category: ErrorCategory.UserInputInvalid },
      );
    }
    return {
      view_ref: decision.view_ref.trim(),
      action: decision.action as EvidenceMaintenanceAction,
    };
  });
  const duplicate = decisions.find((decision, index) =>
    decisions.findIndex((item) => item.view_ref === decision.view_ref) !== index
  );
  if (duplicate !== undefined) {
    throw new ContextError(
      ExitCode.UserError,
      `evidence maintenance payload contains duplicate view_ref: ${duplicate.view_ref}`,
      { category: ErrorCategory.UserInputInvalid },
    );
  }
  return decisions;
}

export async function applyEvidenceMaintenance(input: {
  projectRoot: string;
  decisions: readonly EvidenceMaintenanceDecision[];
}): Promise<EvidenceMaintenanceResult> {
  return withProjectWriteLock(
    input.projectRoot,
    "evidence-maintenance",
    async () => {
      const prepared: PreparedMaintenance[] = [];
      for (const decision of input.decisions) {
        prepared.push(await prepareDecision({
          projectRoot: input.projectRoot,
          decision,
        }));
      }
      for (const item of prepared) {
        if (item.changed) {
          await writeFile(item.page.path, item.content, "utf8");
        }
      }
      const results: EvidenceMaintenanceResult["results"] = [];
      for (const item of prepared) {
        const actionLog = await writeReviewActionLog({
          projectRoot: input.projectRoot,
          action: item.decision.action,
          id: item.decision.view_ref,
          summary: {
            path: item.page.relPath,
            changed: item.changed,
            ...(item.refsUpdated === undefined
              ? {}
              : { refs_updated: item.refsUpdated }),
          },
        });
        results.push({
          action: item.decision.action,
          id: item.decision.view_ref,
          path: item.page.relPath,
          changed: item.changed,
          ...(item.refsUpdated === undefined
            ? {}
            : { refsUpdated: item.refsUpdated }),
          actionLog,
        });
      }
      return {
        schema: "context.evidence-maintenance.result.v1",
        applied: results.length,
        results,
      };
    },
  );
}

async function applyOne(input: {
  projectRoot: string;
  viewRef: string;
  action: EvidenceMaintenanceAction;
}): Promise<ReviewMaintenanceResult> {
  const result = await applyEvidenceMaintenance({
    projectRoot: input.projectRoot,
    decisions: [{ view_ref: input.viewRef, action: input.action }],
  });
  const first = result.results[0];
  if (first === undefined) {
    throw new Error("Evidence maintenance produced no result.");
  }
  return first;
}

export function rePinApprovedPage(input: {
  projectRoot: string;
  viewRef: string;
}): Promise<ReviewMaintenanceResult> {
  return applyOne({ ...input, action: "re-pin" });
}

export function deprecateApprovedPage(input: {
  projectRoot: string;
  viewRef: string;
}): Promise<ReviewMaintenanceResult> {
  return applyOne({ ...input, action: "deprecate" });
}

export function keepOrphanedApprovedPage(input: {
  projectRoot: string;
  viewRef: string;
}): Promise<ReviewMaintenanceResult> {
  return applyOne({ ...input, action: "keep-orphaned" });
}
