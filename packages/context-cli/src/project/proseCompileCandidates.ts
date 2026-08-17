import { createHash } from "node:crypto";
import type { CompileProsePhaseDefinition } from "@c4a/context";
import { parseDocumentSourceLocator, parseSpanSourceRef } from "@c4a/extract";
import type { AlignPayload, EvidenceContext, StructureViewPlan } from "./proseAlignTypes.js";
import { candidateIdFromViewRef } from "./candidateIdentity.js";
import {
  PARENT_INDEX_GENERATED_KIND,
  parentIndexModel,
  renderParentIndexBody,
} from "./parentIndexView.js";
import {
  proseCompileBatchNextAction,
  readProseCompileBatchProgress,
} from "./proseCompileBatch.js";
import type { CompileStageResult } from "./proseCompileTypes.js";
import {
  readCandidateRecords,
  writeCandidateRecords,
  type ProseCandidateSection,
  type CandidateRecord,
} from "./candidateLedger.js";
import { workspaceRouteReevaluation } from "./workflow/workflowReceipt.js";
import { withProjectWriteLock } from "./writeLock.js";
import { readRejectedDecisions, writeRejectedDecisions } from "./reviewDecisions.js";
import { removeCandidateSnapshot } from "./reviewShared.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function candidateSource(input: {
  sourceRef: string;
  evidence: EvidenceContext;
}): CandidateRecord["source"] {
  const parsed = parseSpanSourceRef(input.sourceRef);
  const locator = parsed?.locator === undefined ? null : parseDocumentSourceLocator(parsed.locator);
  if (locator === null) return undefined;
  return {
    type: locator.sourceType,
    name: locator.sourceName,
    document_path: locator.documentPath,
    locator: parsed!.locator!,
    source_ref: input.sourceRef,
    snapshot_hash: input.evidence.index.snapshot_hash,
  };
}

function candidateFingerprint(record: Pick<CandidateRecord, "candidate_id" | "node_ref" | "view_ref" | "collection" | "path" | "structure_digest" | "source_refs" | "shared_source_refs" | "body" | "sections" | "generated" | "parent_index" | "node_tags" | "review">): string {
  return `sha256:${sha256(stableStringify(record))}`;
}

function viewEndpointRefs(view: StructureViewPlan): Set<string> {
  return new Set([
    view.node_ref,
    view.view_ref,
    ...view.sections.map((section) => section.section_ref),
  ]);
}

function edgeLabel(input: {
  edge: AlignPayload["edges"][number];
  endpoints: ReadonlySet<string>;
}): string {
  const fromLocal = input.endpoints.has(input.edge.from);
  const toLocal = input.endpoints.has(input.edge.to);
  const type = input.edge.confidence === undefined ? input.edge.type : `${input.edge.confidence} ${input.edge.type}`;
  if (fromLocal && toLocal) return `${input.edge.from} ${type} ${input.edge.to}`;
  if (fromLocal) return `${type} -> ${input.edge.to}`;
  return `${type} <- ${input.edge.from}`;
}

function edgeSummaryForView(input: {
  structure: AlignPayload;
  node: StructureViewPlan;
}): string | undefined {
  const endpoints = viewEndpointRefs(input.node);
  const labels = [...new Set(input.structure.edges
    .filter((edge) => endpoints.has(edge.from) || endpoints.has(edge.to))
    .map((edge) => edgeLabel({ edge, endpoints })))]
    .sort();
  if (labels.length === 0) return undefined;
  const visible = labels.slice(0, 3).join("; ");
  const suffix = labels.length > 3 ? `; +${labels.length - 3} more` : "";
  return `Reachable edges: ${visible}${suffix}.`;
}

function nodeTagsForView(input: { structure: AlignPayload; node: StructureViewPlan }): string[] | undefined {
  const tags = input.structure.nodes.find((node) => node.node_ref === input.node.node_ref)?.tags;
  return tags === undefined || tags.length === 0 ? undefined : tags;
}

function sharedSourceRefSet(structure: AlignPayload): Set<string> {
  const ownersByRef = new Map<string, Set<string>>();
  for (const view of structure.views) {
    for (const section of view.sections) {
      for (const sourceRef of section.source_refs) {
        const owners = ownersByRef.get(sourceRef) ?? new Set<string>();
        owners.add(section.section_ref);
        ownersByRef.set(sourceRef, owners);
      }
    }
  }
  return new Set([...ownersByRef.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([sourceRef]) => sourceRef));
}

function sharedSourceRefsForCandidate(input: {
  structure: AlignPayload;
  sourceRefs: readonly string[];
}): string[] | undefined {
  const sharedRefs = sharedSourceRefSet(input.structure);
  const refs = [...new Set(input.sourceRefs.filter((sourceRef) => sharedRefs.has(sourceRef)))].sort();
  return refs.length > 0 ? refs : undefined;
}

export function candidateRecord(input: {
  evidence: EvidenceContext;
  structure: AlignPayload;
  node: StructureViewPlan;
  sections: ProseCandidateSection[];
}): CandidateRecord {
  const sourceRefs = [...new Set(input.sections.flatMap((section) => [section.source_ref, ...(section.source_refs ?? [])]))];
  const sections = input.sections;
  const behaviorSummary = (input.node.summary ?? sections.map((section) => section.summary).filter(Boolean).join(" ")).trim();
  const edgeSummary = edgeSummaryForView({ structure: input.structure, node: input.node });
  const nodeTags = nodeTagsForView({ structure: input.structure, node: input.node });
  const sharedSourceRefs = sharedSourceRefsForCandidate({ structure: input.structure, sourceRefs });
  const summary = [
    behaviorSummary.length > 0 ? behaviorSummary : undefined,
    edgeSummary,
  ].filter((item): item is string => item !== undefined && item.trim().length > 0).join(" ");
  const candidateId = candidateIdFromViewRef(input.node.view_ref);
  const partial = {
    candidate_id: candidateId,
    node_ref: input.node.node_ref,
    view_ref: input.node.view_ref,
    collection: input.node.collection,
    path: input.node.path,
    structure_digest: input.structure.structure_digest,
    source_refs: sourceRefs,
    ...(sharedSourceRefs !== undefined ? { shared_source_refs: sharedSourceRefs } : {}),
    sections,
    ...(nodeTags !== undefined ? { node_tags: nodeTags } : {}),
    review: {
      title: input.node.title,
      summary: summary.trim().length > 0 ? summary : `${input.node.title} source-bound knowledge.`,
      ...(behaviorSummary.length > 0 ? { behavior_summary: behaviorSummary } : {}),
      ...(edgeSummary !== undefined ? { edge_summary: edgeSummary } : {}),
      signals: [
        `node_type:${input.node.node_type}`,
        `sections:${sections.length}`,
      ],
      reason: "Generated by compileProse from confirmed structure and committed source spans.",
    },
  };
  const source = sourceRefs[0] !== undefined
    ? candidateSource({ sourceRef: sourceRefs[0], evidence: input.evidence })
    : undefined;
  return {
    candidate_id: candidateId,
    node_ref: input.node.node_ref,
    view_ref: input.node.view_ref,
    collection: input.node.collection,
    status: "draft",
    candidate_type: "prose-align",
    kind: input.node.node_type,
    ...(nodeTags !== undefined ? { node_tags: nodeTags } : {}),
    visibility: "exported",
    module: input.evidence.source.sourceName,
    path: input.node.path,
    structure_digest: input.structure.structure_digest,
    source_refs: sourceRefs,
    ...(sharedSourceRefs !== undefined ? { shared_source_refs: sharedSourceRefs } : {}),
    ...(source !== undefined ? { source } : {}),
    sections,
    fingerprint: candidateFingerprint(partial),
    review: partial.review,
    updated: new Date().toISOString(),
  };
}

export function parentIndexCandidateRecord(input: {
  evidence: EvidenceContext;
  structure: AlignPayload;
  node: StructureViewPlan;
}): CandidateRecord | undefined {
  const model = parentIndexModel({ structure: input.structure, view: input.node });
  if (model === undefined || model.children.length === 0 || model.source_refs.length === 0) return undefined;
  const behaviorSummary = (input.node.summary ?? model.children.map((child) => child.summary).filter(Boolean).join(" ")).trim();
  const edgeSummary = edgeSummaryForView({ structure: input.structure, node: input.node });
  const nodeTags = nodeTagsForView({ structure: input.structure, node: input.node });
  const sharedSourceRefs = sharedSourceRefsForCandidate({ structure: input.structure, sourceRefs: model.source_refs });
  const summary = [
    behaviorSummary.length > 0 ? behaviorSummary : undefined,
    edgeSummary,
  ].filter((item): item is string => item !== undefined && item.trim().length > 0).join(" ");
  const body = renderParentIndexBody({
    title: input.node.title,
    path: input.node.path,
    children: model.children,
  });
  const candidateId = candidateIdFromViewRef(input.node.view_ref);
  const partial = {
    candidate_id: candidateId,
    node_ref: input.node.node_ref,
    view_ref: input.node.view_ref,
    collection: input.node.collection,
    path: input.node.path,
    structure_digest: input.structure.structure_digest,
    generated: PARENT_INDEX_GENERATED_KIND as typeof PARENT_INDEX_GENERATED_KIND,
    source_refs: model.source_refs,
    ...(sharedSourceRefs !== undefined ? { shared_source_refs: sharedSourceRefs } : {}),
    body,
    parent_index: { children: model.children },
    ...(nodeTags !== undefined ? { node_tags: nodeTags } : {}),
    review: {
      title: input.node.title,
      summary: summary.trim().length > 0 ? summary : `${input.node.title} parent index.`,
      ...(behaviorSummary.length > 0 ? { behavior_summary: behaviorSummary } : {}),
      ...(edgeSummary !== undefined ? { edge_summary: edgeSummary } : {}),
      signals: [
        `node_type:${input.node.node_type}`,
        "generated:parent_index",
        `children:${model.children.length}`,
      ],
      reason: "Generated by compileProse from confirmed child views and contains edges.",
    },
  };
  const source = candidateSource({ sourceRef: model.source_refs[0]!, evidence: input.evidence });
  return {
    candidate_id: candidateId,
    node_ref: input.node.node_ref,
    view_ref: input.node.view_ref,
    collection: input.node.collection,
    status: "draft",
    candidate_type: "prose-align",
    generated: PARENT_INDEX_GENERATED_KIND,
    parent_index: { children: model.children },
    kind: input.node.node_type,
    ...(nodeTags !== undefined ? { node_tags: nodeTags } : {}),
    visibility: "exported",
    module: input.evidence.source.sourceName,
    path: input.node.path,
    structure_digest: input.structure.structure_digest,
    source_refs: model.source_refs,
    ...(sharedSourceRefs !== undefined ? { shared_source_refs: sharedSourceRefs } : {}),
    ...(source !== undefined ? { source } : {}),
    body,
    fingerprint: candidateFingerprint(partial),
    review: partial.review,
    updated: new Date().toISOString(),
  };
}

export async function writeCompileCandidates(input: {
  projectRoot: string;
  records: CandidateRecord[];
}): Promise<CompileStageResult["candidates"]> {
  return withProjectWriteLock(input.projectRoot, "compile-prose", async () => {
    const existing = await readCandidateRecords(input.projectRoot);
    const rejectedDecisions = await readRejectedDecisions(input.projectRoot);
    const byId = new Map(existing.map((record) => [record.candidate_id, record]));
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let skippedRejected = 0;
    let replacedIdentityConflicts = 0;
    let decisionsUpdated = false;
    const snapshotsToRemove = new Set<string>();
    for (const record of input.records) {
      if (record.candidate_type === "prose-align") {
        const replacedIds = [...byId.values()]
          .filter((candidate) =>
            candidate.candidate_type === "prose-align" &&
            candidate.path === record.path &&
            candidate.candidate_id !== record.candidate_id
          )
          .map((candidate) => candidate.candidate_id);
        for (const candidateId of replacedIds) {
          byId.delete(candidateId);
          rejectedDecisions.delete(candidateId);
          decisionsUpdated = true;
          replacedIdentityConflicts += 1;
          snapshotsToRemove.add(candidateId);
        }
      }
      const previous = byId.get(record.candidate_id);
      const rejectedFingerprint = rejectedDecisions.get(record.candidate_id);
      if (rejectedFingerprint === record.fingerprint) {
        skippedRejected += 1;
        byId.set(record.candidate_id, {
          ...record,
          status: "rejected",
          updated: previous?.fingerprint === record.fingerprint && previous.status === "rejected"
            ? previous.updated
            : record.updated,
        });
        continue;
      }
      if (rejectedFingerprint !== undefined) {
        rejectedDecisions.delete(record.candidate_id);
        decisionsUpdated = true;
      }
      if (previous === undefined) added += 1;
      else if (
        previous.fingerprint === record.fingerprint &&
        previous.status === "draft" &&
        previous.structure_digest === record.structure_digest
      ) {
        unchanged += 1;
        continue;
      } else updated += 1;
      byId.set(record.candidate_id, record);
    }
    await writeCandidateRecords(input.projectRoot, [...byId.values()]);
    for (const candidateId of snapshotsToRemove) {
      await removeCandidateSnapshot(input.projectRoot, candidateId);
    }
    if (decisionsUpdated) await writeRejectedDecisions(input.projectRoot, rejectedDecisions);
    return { added, updated, unchanged, skippedRejected, replacedIdentityConflicts };
  });
}

export async function compileBatchNextAction(input: {
  projectRoot: string;
  phase: CompileProsePhaseDefinition;
  structure: AlignPayload;
}): Promise<Record<string, unknown>> {
  const progress = await readProseCompileBatchProgress({
    projectRoot: input.projectRoot,
    structure: input.structure,
  });
  return progress === undefined
    ? {
        ...workspaceRouteReevaluation(input.phase.id),
        batch: {
          collection: input.phase.collection,
          state: "candidate_set_ready",
        },
      }
    : proseCompileBatchNextAction({ phaseId: input.phase.id, progress });
}
