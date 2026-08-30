import { z } from "zod";
import {
  indexerLayoutProposalSchema,
  type IndexerLayoutProposal,
} from "./indexerLayoutResolver.js";
import { indexerKnowledgeCollectionSchema } from "./indexerCollectionMapping.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";
import {
  indexerSharedArtifactFingerprintSchema,
  validateIndexerSharedArtifactFingerprint,
} from "./indexerSharedArtifactFingerprint.js";

const approvedArtifactSchema = z.object({
  artifact_ref: indexerCanonicalRefSchema,
  artifact_id: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  collection: indexerKnowledgeCollectionSchema,
  output_path: portableIndexerPathSchema,
  shared_artifact_fingerprint_digest: indexerDigestSchema,
  purpose: z.enum(["required", "discretionary", "semantic-split"]),
  split_of_artifact_ref: indexerCanonicalRefSchema.nullable(),
  split_boundary: z.object({
    axis: indexerIdSchema,
    start_key: z.string().min(1),
    end_key: z.string().min(1),
  }).strict().nullable(),
  sections: z.array(z.object({
    section_ref: indexerCanonicalRefSchema,
    section_identity_ref: indexerCanonicalRefSchema,
  }).strict()),
}).strict();

const approvedLayoutPayloadSchema = z.object({
  protocol: z.literal("context.indexer.approved-layout-projection/v1"),
  indexer_id: indexerIdSchema,
  profile: indexerIdSchema,
  profile_contract_digest: indexerDigestSchema,
  subject_key_schema_set_digest: indexerDigestSchema,
  subject_key_schema_digest: indexerDigestSchema,
  node_ref: indexerCanonicalRefSchema,
  shared_artifact_fingerprint: indexerSharedArtifactFingerprintSchema,
  artifacts: z.array(approvedArtifactSchema),
}).strict();

export const indexerApprovedLayoutProjectionSchema = approvedLayoutPayloadSchema.extend({
  projection_digest: indexerDigestSchema,
}).strict();

export type IndexerApprovedLayoutProjection = z.infer<
  typeof indexerApprovedLayoutProjectionSchema
>;

const layoutChangeSchema = z.object({
  kind: z.enum([
    "artifact-added",
    "artifact-removed",
    "artifact-split",
    "artifact-merge",
    "artifact-rename",
    "section-move",
    "collection-move",
    "path-move",
  ]),
  artifact_ref: indexerCanonicalRefSchema,
  related_artifact_ref: indexerCanonicalRefSchema.nullable(),
  section_identity_refs: z.array(indexerCanonicalRefSchema),
  before_collection: indexerKnowledgeCollectionSchema.nullable(),
  after_collection: indexerKnowledgeCollectionSchema.nullable(),
  before_path: portableIndexerPathSchema.nullable(),
  after_path: portableIndexerPathSchema.nullable(),
  confirmation_class: z.enum([
    "compatible-addition",
    "destructive",
    "ambiguous",
  ]),
}).strict();

const layoutChangeReportPayloadSchema = z.object({
  protocol: z.literal("context.indexer.layout-change-report/v1"),
  base_projection_digest: indexerDigestSchema.nullable(),
  target_proposal_digest: indexerDigestSchema,
  reused_artifact_refs: z.array(indexerCanonicalRefSchema),
  changes: z.array(layoutChangeSchema),
  requires_confirmation: z.boolean(),
  gate: z.object({
    id: z.literal("confirm-layout-change"),
    authority: z.literal("human"),
    delegation: z.literal("forbidden"),
  }).strict().nullable(),
}).strict();

export const indexerLayoutChangeReportSchema = layoutChangeReportPayloadSchema.extend({
  report_digest: indexerDigestSchema,
}).strict();

export type IndexerLayoutChangeReport = z.infer<typeof indexerLayoutChangeReportSchema>;

const layoutChangeConfirmationPayloadSchema = z.object({
  protocol: z.literal("context.indexer.layout-change-confirmation/v1"),
  gate: z.literal("confirm-layout-change"),
  report_digest: indexerDigestSchema,
  base_projection_digest: indexerDigestSchema,
  target_proposal_digest: indexerDigestSchema,
  decision: z.literal("approved"),
  authority: z.literal("human"),
  delegation: z.literal("none"),
  actor_ref: indexerCanonicalRefSchema,
}).strict();

export const indexerLayoutChangeConfirmationSchema =
  layoutChangeConfirmationPayloadSchema.extend({
    confirmation_digest: indexerDigestSchema,
  }).strict();

export type IndexerLayoutChangeConfirmation = z.infer<
  typeof indexerLayoutChangeConfirmationSchema
>;

function proposalPayload(
  value: IndexerLayoutProposal,
): Omit<IndexerLayoutProposal, "proposal_digest"> {
  const { proposal_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

function validateProposalDigest(value: unknown): IndexerLayoutProposal {
  const proposal = indexerLayoutProposalSchema.parse(value);
  if (indexerProtocolDigest(proposalPayload(proposal)) !== proposal.proposal_digest) {
    throw new TypeError("layout proposal digest is invalid");
  }
  return proposal;
}

export function buildIndexerApprovedLayoutProjection(
  value: unknown,
): IndexerApprovedLayoutProjection {
  const proposal = validateProposalDigest(value);
  const payload = approvedLayoutPayloadSchema.parse({
    protocol: "context.indexer.approved-layout-projection/v1",
    indexer_id: proposal.indexer_id,
    profile: proposal.profile,
    profile_contract_digest: proposal.profile_contract_digest,
    subject_key_schema_set_digest: proposal.subject_key_schema_set_digest,
    subject_key_schema_digest: proposal.subject_key_schema_digest,
    node_ref: proposal.node.node_ref,
    shared_artifact_fingerprint: proposal.shared_artifact_fingerprint,
    artifacts: proposal.artifacts.map((artifact) => ({
      artifact_ref: artifact.artifact_ref,
      artifact_id: artifact.artifact_id,
      artifact_kind: artifact.artifact_kind,
      collection: artifact.collection,
      output_path: artifact.output_path,
      shared_artifact_fingerprint_digest:
        artifact.shared_artifact_fingerprint_digest,
      purpose: artifact.purpose,
      split_of_artifact_ref: artifact.split_of_artifact_ref,
      split_boundary: artifact.split_boundary,
      sections: artifact.sections.map((section) => ({
        section_ref: section.section_ref,
        section_identity_ref: section.section_identity_ref,
      })).sort((left, right) => compareIndexerCanonicalText(
        left.section_identity_ref,
        right.section_identity_ref,
      )),
    })).sort((left, right) => compareIndexerCanonicalText(
      left.artifact_ref,
      right.artifact_ref,
    )),
  });
  return indexerApprovedLayoutProjectionSchema.parse({
    ...payload,
    projection_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerApprovedLayoutProjection(
  value: unknown,
): IndexerApprovedLayoutProjection {
  const projection = indexerApprovedLayoutProjectionSchema.parse(value);
  const { projection_digest: _digest, ...payload } = projection;
  void _digest;
  if (indexerProtocolDigest(payload) !== projection.projection_digest) {
    throw new TypeError("approved layout projection digest is invalid");
  }
  const sharedFingerprint = validateIndexerSharedArtifactFingerprint(
    projection.shared_artifact_fingerprint,
  );
  if (
    sharedFingerprint.indexer_id !== projection.indexer_id ||
    projection.artifacts.some((artifact) =>
      artifact.shared_artifact_fingerprint_digest !==
        sharedFingerprint.fingerprint_digest
    )
  ) {
    throw new TypeError("approved layout Artifacts do not share one Indexer fingerprint");
  }
  const artifactRefs = projection.artifacts.map((artifact) => artifact.artifact_ref);
  const outputPaths = projection.artifacts.map((artifact) => artifact.output_path);
  const sectionRefs = projection.artifacts.flatMap((artifact) =>
    artifact.sections.map((section) => section.section_ref)
  );
  const sectionIdentities = projection.artifacts.flatMap((artifact) =>
    artifact.sections.map((section) => section.section_identity_ref)
  );
  for (const [values, label] of [
    [artifactRefs, "Artifact identities"],
    [outputPaths, "Artifact output paths"],
    [sectionRefs, "Section placements"],
    [sectionIdentities, "logical Section identities"],
  ] as const) {
    if (new Set(values).size !== values.length) {
      throw new TypeError(`approved layout projection has colliding ${label}`);
    }
  }
  const canonicalArtifactRefs = [...artifactRefs].sort(compareIndexerCanonicalText);
  if (canonicalIndexerJson(canonicalArtifactRefs) !== canonicalIndexerJson(artifactRefs)) {
    throw new TypeError("approved layout projection Artifacts are not canonical");
  }
  const byArtifactRef = new Map(projection.artifacts.map((artifact) => [
    artifact.artifact_ref,
    artifact,
  ]));
  for (const artifact of projection.artifacts) {
    const canonicalSections = [...artifact.sections].sort((left, right) =>
      compareIndexerCanonicalText(
        left.section_identity_ref,
        right.section_identity_ref,
      )
    );
    if (canonicalIndexerJson(canonicalSections) !== canonicalIndexerJson(artifact.sections)) {
      throw new TypeError("approved layout projection Sections are not canonical");
    }
    if (artifact.purpose === "semantic-split") {
      const parent = artifact.split_of_artifact_ref === null
        ? undefined
        : byArtifactRef.get(artifact.split_of_artifact_ref);
      if (
        artifact.split_boundary === null ||
        parent === undefined ||
        parent.purpose === "semantic-split" ||
        parent.artifact_kind !== artifact.artifact_kind
      ) {
        throw new TypeError("approved layout projection has invalid split lineage");
      }
    } else if (
      artifact.split_of_artifact_ref !== null ||
      artifact.split_boundary !== null
    ) {
      throw new TypeError("approved non-split Artifact declares split lineage");
    }
  }
  return projection;
}

function changeKey(change: z.infer<typeof layoutChangeSchema>): string {
  return `${change.artifact_ref}\u0000${change.kind}\u0000${change.related_artifact_ref ?? ""}`;
}

function sectionIdentities(artifact: {
  sections: readonly { section_identity_ref: string }[];
}): string[] {
  return artifact.sections.map((section) => section.section_identity_ref)
    .sort(compareIndexerCanonicalText);
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).sort(compareIndexerCanonicalText);
}

type LayoutChange = z.infer<typeof layoutChangeSchema>;
type ApprovedArtifact = IndexerApprovedLayoutProjection["artifacts"][number];
type ProposedArtifact = IndexerLayoutProposal["artifacts"][number];

function confirmationClass(
  kind: LayoutChange["kind"],
): LayoutChange["confirmation_class"] {
  if (kind === "artifact-added") return "compatible-addition";
  if (kind === "artifact-split" || kind === "section-move") return "ambiguous";
  return "destructive";
}

function appendStableArtifactMoves(input: {
  base: readonly ApprovedArtifact[];
  target_by_ref: ReadonlyMap<string, ProposedArtifact>;
  changes: LayoutChange[];
}): void {
  for (const artifact of input.base) {
    const next = input.target_by_ref.get(artifact.artifact_ref);
    if (next === undefined) continue;
    const kind = artifact.collection !== next.collection
      ? "collection-move" as const
      : artifact.output_path !== next.output_path
      ? "path-move" as const
      : null;
    if (kind === null) continue;
    input.changes.push({
      kind,
      confirmation_class: confirmationClass(kind),
      artifact_ref: artifact.artifact_ref,
      related_artifact_ref: null,
      section_identity_refs: intersection(
        sectionIdentities(artifact),
        sectionIdentities(next),
      ),
      before_collection: artifact.collection,
      after_collection: next.collection,
      before_path: artifact.output_path,
      after_path: next.output_path,
    });
  }
}

function appendSplits(input: {
  target: readonly ProposedArtifact[];
  base_by_ref: ReadonlyMap<string, ApprovedArtifact>;
  target_by_ref: ReadonlyMap<string, ProposedArtifact>;
  classified_target: Set<string>;
  changes: LayoutChange[];
}): void {
  for (const artifact of input.target) {
    const parentRef = artifact.split_of_artifact_ref;
    if (
      input.base_by_ref.has(artifact.artifact_ref) ||
      artifact.purpose !== "semantic-split" ||
      parentRef === null ||
      (!input.target_by_ref.has(parentRef) && !input.base_by_ref.has(parentRef))
    ) continue;
    const previousParent = input.base_by_ref.get(parentRef);
    input.changes.push({
      kind: "artifact-split",
      confirmation_class: confirmationClass("artifact-split"),
      artifact_ref: artifact.artifact_ref,
      related_artifact_ref: parentRef,
      section_identity_refs: sectionIdentities(artifact),
      before_collection: previousParent?.collection ?? null,
      after_collection: artifact.collection,
      before_path: previousParent?.output_path ?? null,
      after_path: artifact.output_path,
    });
    input.classified_target.add(artifact.artifact_ref);
  }
}

function appendMerges(input: {
  base: readonly ApprovedArtifact[];
  target_by_ref: ReadonlyMap<string, ProposedArtifact>;
  classified_base: Set<string>;
  changes: LayoutChange[];
}): void {
  for (const artifact of input.base) {
    const parentRef = artifact.split_of_artifact_ref;
    if (
      input.target_by_ref.has(artifact.artifact_ref) ||
      artifact.purpose !== "semantic-split" ||
      parentRef === null ||
      !input.target_by_ref.has(parentRef)
    ) continue;
    const parent = input.target_by_ref.get(parentRef)!;
    input.changes.push({
      kind: "artifact-merge",
      confirmation_class: confirmationClass("artifact-merge"),
      artifact_ref: artifact.artifact_ref,
      related_artifact_ref: parent.artifact_ref,
      section_identity_refs: sectionIdentities(artifact),
      before_collection: artifact.collection,
      after_collection: parent.collection,
      before_path: artifact.output_path,
      after_path: parent.output_path,
    });
    input.classified_base.add(artifact.artifact_ref);
  }
}

function appendRenames(input: {
  base: readonly ApprovedArtifact[];
  target: readonly ProposedArtifact[];
  base_by_ref: ReadonlyMap<string, ApprovedArtifact>;
  target_by_ref: ReadonlyMap<string, ProposedArtifact>;
  classified_base: Set<string>;
  classified_target: Set<string>;
  changes: LayoutChange[];
}): void {
  const unmatchedBase = input.base.filter((artifact) =>
    !input.target_by_ref.has(artifact.artifact_ref) &&
    !input.classified_base.has(artifact.artifact_ref)
  );
  const unmatchedTarget = input.target.filter((artifact) =>
    !input.base_by_ref.has(artifact.artifact_ref) &&
    !input.classified_target.has(artifact.artifact_ref)
  );
  const overlaps = (left: ApprovedArtifact | ProposedArtifact, right: ProposedArtifact | ApprovedArtifact) =>
    intersection(sectionIdentities(left), sectionIdentities(right)).length > 0;
  for (const artifact of unmatchedBase) {
    const candidates = unmatchedTarget.filter((candidate) => overlaps(artifact, candidate));
    if (candidates.length !== 1) continue;
    const next = candidates[0]!;
    if (unmatchedBase.filter((candidate) => overlaps(candidate, next)).length !== 1) {
      continue;
    }
    input.changes.push({
      kind: "artifact-rename",
      confirmation_class: confirmationClass("artifact-rename"),
      artifact_ref: artifact.artifact_ref,
      related_artifact_ref: next.artifact_ref,
      section_identity_refs: intersection(
        sectionIdentities(artifact),
        sectionIdentities(next),
      ),
      before_collection: artifact.collection,
      after_collection: next.collection,
      before_path: artifact.output_path,
      after_path: next.output_path,
    });
    input.classified_base.add(artifact.artifact_ref);
    input.classified_target.add(next.artifact_ref);
  }
}

function appendSectionMoves(input: {
  base: readonly ApprovedArtifact[];
  target: readonly ProposedArtifact[];
  base_by_ref: ReadonlyMap<string, ApprovedArtifact>;
  target_by_ref: ReadonlyMap<string, ProposedArtifact>;
  changes: LayoutChange[];
}): void {
  const baseOwner = new Map(input.base.flatMap((artifact) =>
    artifact.sections.map((section) => [
      section.section_identity_ref,
      artifact.artifact_ref,
    ] as const)
  ));
  const targetOwner = new Map(input.target.flatMap((artifact) =>
    artifact.sections.map((section) => [
      section.section_identity_ref,
      artifact.artifact_ref,
    ] as const)
  ));
  for (const [sectionIdentityRef, beforeOwner] of baseOwner) {
    const afterOwner = targetOwner.get(sectionIdentityRef);
    if (afterOwner === undefined || afterOwner === beforeOwner) continue;
    const before = input.base_by_ref.get(beforeOwner)!;
    const after = input.target_by_ref.get(afterOwner)!;
    input.changes.push({
      kind: "section-move",
      confirmation_class: confirmationClass("section-move"),
      artifact_ref: beforeOwner,
      related_artifact_ref: afterOwner,
      section_identity_refs: [sectionIdentityRef],
      before_collection: before.collection,
      after_collection: after.collection,
      before_path: before.output_path,
      after_path: after.output_path,
    });
  }
}

function appendAddsAndRemovals(input: {
  base: readonly ApprovedArtifact[];
  target: readonly ProposedArtifact[];
  base_by_ref: ReadonlyMap<string, ApprovedArtifact>;
  target_by_ref: ReadonlyMap<string, ProposedArtifact>;
  classified_base: ReadonlySet<string>;
  classified_target: ReadonlySet<string>;
  changes: LayoutChange[];
}): void {
  for (const artifact of input.base) {
    if (
      input.target_by_ref.has(artifact.artifact_ref) ||
      input.classified_base.has(artifact.artifact_ref)
    ) continue;
    input.changes.push({
      kind: "artifact-removed",
      confirmation_class: confirmationClass("artifact-removed"),
      artifact_ref: artifact.artifact_ref,
      related_artifact_ref: null,
      section_identity_refs: sectionIdentities(artifact),
      before_collection: artifact.collection,
      after_collection: null,
      before_path: artifact.output_path,
      after_path: null,
    });
  }
  for (const artifact of input.target) {
    if (
      input.base_by_ref.has(artifact.artifact_ref) ||
      input.classified_target.has(artifact.artifact_ref)
    ) continue;
    input.changes.push({
      kind: "artifact-added",
      confirmation_class: confirmationClass("artifact-added"),
      artifact_ref: artifact.artifact_ref,
      related_artifact_ref: null,
      section_identity_refs: sectionIdentities(artifact),
      before_collection: null,
      after_collection: artifact.collection,
      before_path: null,
      after_path: artifact.output_path,
    });
  }
}

export function compareIndexerLayout(input: {
  base: unknown | null;
  target: unknown;
}): IndexerLayoutChangeReport {
  const target = validateProposalDigest(input.target);
  const base = input.base === null
    ? null
    : validateIndexerApprovedLayoutProjection(input.base);
  if (base !== null && (
    base.indexer_id !== target.indexer_id ||
    base.profile !== target.profile ||
    base.node_ref !== target.node.node_ref ||
    base.subject_key_schema_digest !== target.subject_key_schema_digest
  )) {
    throw new TypeError(
      "layout comparison cannot bypass profile or SubjectKey re-identification authority",
    );
  }
  const baseByRef = new Map((base?.artifacts ?? []).map((artifact) => [
    artifact.artifact_ref,
    artifact,
  ]));
  const targetByRef = new Map(target.artifacts.map((artifact) => [
    artifact.artifact_ref,
    artifact,
  ]));
  const reusedArtifactRefs = [...targetByRef.keys()].filter((artifactRef) =>
    baseByRef.has(artifactRef)
  ).sort(compareIndexerCanonicalText);
  const changes: Array<z.infer<typeof layoutChangeSchema>> = [];
  const classifiedBase = new Set<string>();
  const classifiedTarget = new Set<string>();
  const baseArtifacts = base?.artifacts ?? [];
  appendStableArtifactMoves({ base: baseArtifacts, target_by_ref: targetByRef, changes });
  appendSplits({
    target: target.artifacts,
    base_by_ref: baseByRef,
    target_by_ref: targetByRef,
    classified_target: classifiedTarget,
    changes,
  });
  appendMerges({
    base: baseArtifacts,
    target_by_ref: targetByRef,
    classified_base: classifiedBase,
    changes,
  });
  appendRenames({
    base: baseArtifacts,
    target: target.artifacts,
    base_by_ref: baseByRef,
    target_by_ref: targetByRef,
    classified_base: classifiedBase,
    classified_target: classifiedTarget,
    changes,
  });
  appendSectionMoves({
    base: baseArtifacts,
    target: target.artifacts,
    base_by_ref: baseByRef,
    target_by_ref: targetByRef,
    changes,
  });
  appendAddsAndRemovals({
    base: baseArtifacts,
    target: target.artifacts,
    base_by_ref: baseByRef,
    target_by_ref: targetByRef,
    classified_base: classifiedBase,
    classified_target: classifiedTarget,
    changes,
  });
  changes.sort((left, right) => compareIndexerCanonicalText(
    changeKey(left),
    changeKey(right),
  ));
  const requiresConfirmation = base !== null && changes.some((change) =>
    change.confirmation_class !== "compatible-addition"
  );
  const payload = layoutChangeReportPayloadSchema.parse({
    protocol: "context.indexer.layout-change-report/v1",
    base_projection_digest: base?.projection_digest ?? null,
    target_proposal_digest: target.proposal_digest,
    reused_artifact_refs: reusedArtifactRefs,
    changes,
    requires_confirmation: requiresConfirmation,
    gate: requiresConfirmation
      ? { id: "confirm-layout-change", authority: "human", delegation: "forbidden" }
      : null,
  });
  return indexerLayoutChangeReportSchema.parse({
    ...payload,
    report_digest: indexerProtocolDigest(payload),
  });
}

export function buildIndexerLayoutChangeConfirmation(input: {
  report: IndexerLayoutChangeReport;
  actor_ref: string;
}): IndexerLayoutChangeConfirmation {
  const report = validateIndexerLayoutChangeReport(input.report);
  if (!report.requires_confirmation || report.base_projection_digest === null) {
    throw new TypeError("layout change report does not require confirmation");
  }
  const payload = layoutChangeConfirmationPayloadSchema.parse({
    protocol: "context.indexer.layout-change-confirmation/v1",
    gate: "confirm-layout-change",
    report_digest: report.report_digest,
    base_projection_digest: report.base_projection_digest,
    target_proposal_digest: report.target_proposal_digest,
    decision: "approved",
    authority: "human",
    delegation: "none",
    actor_ref: input.actor_ref,
  });
  return indexerLayoutChangeConfirmationSchema.parse({
    ...payload,
    confirmation_digest: indexerProtocolDigest(payload),
  });
}

export function authorizeIndexerLayoutChange(input: {
  report: unknown;
  confirmation?: unknown;
}): IndexerLayoutChangeReport {
  const report = validateIndexerLayoutChangeReport(input.report);
  if (!report.requires_confirmation) {
    if (input.confirmation !== undefined) {
      throw new TypeError("non-destructive layout change must not consume a confirmation");
    }
    return report;
  }
  const confirmation = indexerLayoutChangeConfirmationSchema.parse(input.confirmation);
  const { confirmation_digest: _confirmationDigest, ...confirmationPayload } = confirmation;
  void _confirmationDigest;
  if (
    indexerProtocolDigest(confirmationPayload) !== confirmation.confirmation_digest ||
    confirmation.report_digest !== report.report_digest ||
    confirmation.base_projection_digest !== report.base_projection_digest ||
    confirmation.target_proposal_digest !== report.target_proposal_digest
  ) {
    throw new TypeError("layout confirmation is stale or forged");
  }
  return report;
}

export function validateIndexerLayoutChangeReport(
  value: unknown,
): IndexerLayoutChangeReport {
  const report = indexerLayoutChangeReportSchema.parse(value);
  const { report_digest: _digest, ...payload } = report;
  void _digest;
  if (indexerProtocolDigest(payload) !== report.report_digest) {
    throw new TypeError("layout change report digest is invalid");
  }
  if (report.changes.some((change) =>
    change.confirmation_class !== confirmationClass(change.kind)
  )) {
    throw new TypeError("layout change report has an invalid confirmation classification");
  }
  const requiresConfirmation = report.base_projection_digest !== null &&
    report.changes.some((change) =>
      change.confirmation_class !== "compatible-addition"
    );
  if (
    report.requires_confirmation !== requiresConfirmation ||
    (requiresConfirmation ? report.gate === null : report.gate !== null)
  ) {
    throw new TypeError("layout change report Gate state does not close its diff");
  }
  return report;
}

export function sameIndexerApprovedLayout(
  left: IndexerApprovedLayoutProjection,
  right: IndexerApprovedLayoutProjection,
): boolean {
  return canonicalIndexerJson(left) === canonicalIndexerJson(right);
}
