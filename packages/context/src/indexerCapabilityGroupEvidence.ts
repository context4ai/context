import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import type { IndexerMainAuthorWorkset } from "./indexerMainWorkset.js";

const memberEvidenceSchema = z.object({
  member_id: indexerCanonicalRefSchema,
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

const sectionEvidenceSchema = z.object({
  artifact_id: indexerIdSchema,
  section_key: indexerIdSchema,
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

const capabilityGroupSchema = z.object({
  capability_group_ref: indexerCanonicalRefSchema,
  capability_key: indexerIdSchema,
  member_evidence: z.array(memberEvidenceSchema).min(2),
  section_evidence: z.array(sectionEvidenceSchema).min(1),
}).strict();

export const indexerCapabilityGroupEvidenceSchema = z.object({
  protocol: z.literal("context.indexer.capability-group-evidence/v1"),
  author_workset_digest: indexerDigestSchema,
  group_projection_digest: indexerDigestSchema,
  logical_unit_ref: indexerCanonicalRefSchema,
  member_ids: z.array(indexerCanonicalRefSchema).min(1),
  member_ids_digest: indexerDigestSchema,
  capability_groups: z.array(capabilityGroupSchema),
  evidence_digest: indexerDigestSchema,
}).strict();

export type IndexerCapabilityGroupEvidence = z.infer<
  typeof indexerCapabilityGroupEvidenceSchema
>;

export interface IndexerCapabilitySectionEvidenceInventoryItem {
  artifact_id: string;
  section_key: string;
  evidence_refs: readonly string[];
}

export function indexerCapabilityGroupMemberIdsDigest(
  memberIds: readonly string[],
): string {
  return indexerProtocolDigest({
    member_ids: canonicalUnique(memberIds, "member_ids"),
  });
}

export function indexerCapabilityGroupRef(input: {
  logical_unit_ref: string;
  capability_key: string;
}): string {
  return `capability-group:${indexerProtocolDigest(input)}`;
}

export function indexerCapabilityGroupEvidenceDigest(
  value: Omit<IndexerCapabilityGroupEvidence, "evidence_digest">,
): string {
  return indexerProtocolDigest(value);
}

function canonicalUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must not contain duplicate identities`);
  }
  return sorted;
}

function sectionIdentity(input: { artifact_id: string; section_key: string }): string {
  return `${input.artifact_id}\u0000${input.section_key}`;
}

function canonicalGroup(
  group: Omit<IndexerCapabilityGroupEvidence["capability_groups"][number],
    "capability_group_ref">,
  logicalUnitRef: string,
): IndexerCapabilityGroupEvidence["capability_groups"][number] {
  const memberEvidence = [...group.member_evidence].map((member) => ({
    ...member,
    evidence_refs: canonicalUnique(
      member.evidence_refs,
      `${group.capability_key}.member_evidence.evidence_refs`,
    ),
  })).sort((left, right) =>
    compareIndexerCanonicalText(left.member_id, right.member_id)
  );
  canonicalUnique(
    memberEvidence.map((member) => member.member_id),
    `${group.capability_key}.member_evidence.member_id`,
  );
  const sectionEvidence = [...group.section_evidence].map((section) => ({
    ...section,
    evidence_refs: canonicalUnique(
      section.evidence_refs,
      `${group.capability_key}.section_evidence.evidence_refs`,
    ),
  })).sort((left, right) =>
    compareIndexerCanonicalText(sectionIdentity(left), sectionIdentity(right))
  );
  canonicalUnique(
    sectionEvidence.map(sectionIdentity),
    `${group.capability_key}.section_evidence`,
  );
  return {
    capability_group_ref: indexerCapabilityGroupRef({
      logical_unit_ref: logicalUnitRef,
      capability_key: group.capability_key,
    }),
    capability_key: group.capability_key,
    member_evidence: memberEvidence,
    section_evidence: sectionEvidence,
  };
}

export function buildIndexerCapabilityGroupEvidence(input: {
  author_workset_digest: string;
  group_projection_digest: string;
  logical_unit_ref: string;
  member_ids: readonly string[];
  capability_groups: readonly (
    Omit<IndexerCapabilityGroupEvidence["capability_groups"][number],
      "capability_group_ref">
  )[];
}): IndexerCapabilityGroupEvidence {
  const memberIds = canonicalUnique(input.member_ids, "member_ids");
  const capabilityGroups = input.capability_groups.map((group) =>
    canonicalGroup(group, input.logical_unit_ref)
  ).sort((left, right) =>
    compareIndexerCanonicalText(left.capability_group_ref, right.capability_group_ref)
  );
  canonicalUnique(
    capabilityGroups.map((group) => group.capability_group_ref),
    "capability_groups.capability_group_ref",
  );
  canonicalUnique(
    capabilityGroups.map((group) => group.capability_key),
    "capability_groups.capability_key",
  );
  const payload: Omit<IndexerCapabilityGroupEvidence, "evidence_digest"> = {
    protocol: "context.indexer.capability-group-evidence/v1",
    author_workset_digest: input.author_workset_digest,
    group_projection_digest: input.group_projection_digest,
    logical_unit_ref: input.logical_unit_ref,
    member_ids: memberIds,
    member_ids_digest: indexerCapabilityGroupMemberIdsDigest(memberIds),
    capability_groups: capabilityGroups,
  };
  return indexerCapabilityGroupEvidenceSchema.parse({
    ...payload,
    evidence_digest: indexerCapabilityGroupEvidenceDigest(payload),
  });
}

function validateGroupBindings(input: {
  group: IndexerCapabilityGroupEvidence["capability_groups"][number];
  logical_unit_ref: string;
  known_members: ReadonlySet<string>;
  known_evidence: ReadonlySet<string>;
  sections: ReadonlyMap<string, ReadonlySet<string>>;
  claimed_members: Set<string>;
}): void {
  const { group } = input;
  if (group.capability_group_ref !== indexerCapabilityGroupRef({
    logical_unit_ref: input.logical_unit_ref,
    capability_key: group.capability_key,
  })) {
    throw new TypeError(`capability group ${group.capability_key} has a non-canonical ref`);
  }
  const sectionEvidence = new Set<string>();
  for (const section of group.section_evidence) {
    const available = input.sections.get(sectionIdentity(section));
    if (available === undefined) {
      throw new TypeError(`capability group ${group.capability_key} references an unknown Section`);
    }
    for (const evidenceRef of section.evidence_refs) {
      if (!input.known_evidence.has(evidenceRef) || !available.has(evidenceRef)) {
        throw new TypeError(
          `capability group ${group.capability_key} uses evidence absent from its Section`,
        );
      }
      sectionEvidence.add(evidenceRef);
    }
  }
  for (const member of group.member_evidence) {
    if (!input.known_members.has(member.member_id)) {
      throw new TypeError(`capability group ${group.capability_key} uses an unknown member`);
    }
    if (input.claimed_members.has(member.member_id)) {
      throw new TypeError(`member ${member.member_id} belongs to multiple capability groups`);
    }
    input.claimed_members.add(member.member_id);
    for (const evidenceRef of member.evidence_refs) {
      if (!input.known_evidence.has(evidenceRef)) {
        throw new TypeError(`member ${member.member_id} references unknown evidence`);
      }
      if (!sectionEvidence.has(evidenceRef)) {
        throw new TypeError(
          `member ${member.member_id} evidence is not projected by a group Section`,
        );
      }
    }
  }
}

export function validateIndexerCapabilityGroupEvidence(input: {
  value: unknown;
  workset: IndexerMainAuthorWorkset;
  known_evidence_refs: readonly string[];
  section_evidence_inventory: readonly IndexerCapabilitySectionEvidenceInventoryItem[];
}): IndexerCapabilityGroupEvidence {
  const value = indexerCapabilityGroupEvidenceSchema.parse(input.value);
  const rebuilt = buildIndexerCapabilityGroupEvidence({
    author_workset_digest: value.author_workset_digest,
    group_projection_digest: value.group_projection_digest,
    logical_unit_ref: value.logical_unit_ref,
    member_ids: value.member_ids,
    capability_groups: value.capability_groups,
  });
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(value)) {
    throw new TypeError("capability group evidence is not canonical or has an invalid digest");
  }
  if (
    value.author_workset_digest !== input.workset.workset_digest ||
    value.group_projection_digest !== input.workset.group_projection_digest ||
    value.logical_unit_ref !== input.workset.logical_unit_ref ||
    value.member_ids_digest !== input.workset.member_ids_digest
  ) {
    throw new TypeError("capability group evidence does not match its author workset");
  }
  const knownEvidence = new Set(canonicalUnique(
    input.known_evidence_refs,
    "known_evidence_refs",
  ));
  const sections = new Map<string, ReadonlySet<string>>();
  for (const section of input.section_evidence_inventory) {
    const identity = sectionIdentity(section);
    if (sections.has(identity)) {
      throw new TypeError("Section evidence inventory contains duplicate identities");
    }
    sections.set(identity, new Set(canonicalUnique(
      section.evidence_refs,
      `${section.artifact_id}.${section.section_key}.evidence_refs`,
    )));
  }
  const claimedMembers = new Set<string>();
  const knownMembers = new Set(value.member_ids);
  for (const group of value.capability_groups) {
    validateGroupBindings({
      group,
      logical_unit_ref: value.logical_unit_ref,
      known_members: knownMembers,
      known_evidence: knownEvidence,
      sections,
      claimed_members: claimedMembers,
    });
  }
  return value;
}
