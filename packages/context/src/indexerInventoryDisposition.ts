import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import type { IndexerMainAuthorWorkset } from "./indexerMainWorkset.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

export const INDEXER_INVENTORY_MEMBER_KINDS = [
  "project",
  "entry",
  "route",
  "component",
  "service",
  "method",
  "example",
  "protocol-method",
  "handler",
  "event-branch",
  "timer-branch",
  "downstream-callsite",
  "store",
  "state-transition",
] as const;

export type IndexerInventoryMemberKind =
  typeof INDEXER_INVENTORY_MEMBER_KINDS[number];

export const indexerInventoryMemberSchema = z.object({
  member_id: indexerCanonicalRefSchema,
  member_kind: z.enum(INDEXER_INVENTORY_MEMBER_KINDS),
}).strict();

export type IndexerInventoryMember = z.infer<typeof indexerInventoryMemberSchema>;

const sectionEvidenceSchema = z.object({
  artifact_id: indexerIdSchema,
  section_key: indexerIdSchema,
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

const inventoryDispositionSchema = z.union([
  z.object({
    member_id: indexerCanonicalRefSchema,
    member_kind: z.enum(INDEXER_INVENTORY_MEMBER_KINDS),
    inventory_disposition: z.literal("owned"),
    projection_disposition: z.literal("detailed"),
    section_evidence: z.array(sectionEvidenceSchema).min(1),
  }).strict(),
  z.object({
    member_id: indexerCanonicalRefSchema,
    member_kind: z.enum(INDEXER_INVENTORY_MEMBER_KINDS),
    inventory_disposition: z.literal("owned"),
    projection_disposition: z.literal("capability-group"),
    capability_group_ref: indexerCanonicalRefSchema,
  }).strict(),
  z.object({
    member_id: indexerCanonicalRefSchema,
    member_kind: z.enum(INDEXER_INVENTORY_MEMBER_KINDS),
    inventory_disposition: z.literal("owned"),
    projection_disposition: z.literal("catalog-only"),
    fact_refs: z.array(indexerCanonicalRefSchema).min(1),
  }).strict(),
  z.object({
    member_id: indexerCanonicalRefSchema,
    member_kind: z.enum(INDEXER_INVENTORY_MEMBER_KINDS),
    inventory_disposition: z.literal("owned"),
    projection_disposition: z.literal("boundary-only"),
    evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
  }).strict(),
  z.object({
    member_id: indexerCanonicalRefSchema,
    member_kind: z.enum(INDEXER_INVENTORY_MEMBER_KINDS),
    inventory_disposition: z.literal("excluded-with-reason"),
    reason_code: indexerIdSchema,
    evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
  }).strict(),
  z.object({
    member_id: indexerCanonicalRefSchema,
    member_kind: z.enum(INDEXER_INVENTORY_MEMBER_KINDS),
    inventory_disposition: z.literal("unsupported"),
    missing_capabilities: z.array(indexerIdSchema).min(1),
  }).strict(),
  z.object({
    member_id: indexerCanonicalRefSchema,
    member_kind: z.enum(INDEXER_INVENTORY_MEMBER_KINDS),
    inventory_disposition: z.literal("request-material"),
    material_question_proposal_ref: indexerCanonicalRefSchema,
  }).strict(),
]);

export const indexerInventoryDispositionSetSchema = z.object({
  protocol: z.literal("context.indexer.inventory-disposition-set/v1"),
  author_workset_digest: indexerDigestSchema,
  group_projection_digest: indexerDigestSchema,
  logical_unit_ref: indexerCanonicalRefSchema,
  member_ids_digest: indexerDigestSchema,
  member_inventory_digest: indexerDigestSchema,
  dispositions: z.array(inventoryDispositionSchema).min(1),
  disposition_digest: indexerDigestSchema,
}).strict();

export type IndexerInventoryDisposition = z.infer<typeof inventoryDispositionSchema>;
export type IndexerInventoryDispositionSet = z.infer<
  typeof indexerInventoryDispositionSetSchema
>;

export interface IndexerDispositionSectionEvidenceInventoryItem {
  artifact_id: string;
  section_key: string;
  evidence_refs: readonly string[];
}

export interface IndexerDispositionCapabilityGroupMembership {
  capability_group_ref: string;
  member_ids: readonly string[];
}

function canonicalUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must not contain duplicate identities`);
  }
  return sorted;
}

export function canonicalIndexerInventoryMembers(
  values: readonly IndexerInventoryMember[],
): IndexerInventoryMember[] {
  const members = values.map((value) => indexerInventoryMemberSchema.parse(value))
    .sort((left, right) => compareIndexerCanonicalText(left.member_id, right.member_id));
  canonicalUnique(members.map((member) => member.member_id), "inventory members");
  return members;
}

export function indexerInventoryMemberIdsDigest(
  values: readonly IndexerInventoryMember[],
): string {
  return indexerProtocolDigest({
    member_ids: canonicalIndexerInventoryMembers(values).map((member) => member.member_id),
  });
}

export function indexerInventoryMembersDigest(
  values: readonly IndexerInventoryMember[],
): string {
  return indexerProtocolDigest({
    members: canonicalIndexerInventoryMembers(values),
  });
}

function sectionIdentity(value: { artifact_id: string; section_key: string }): string {
  return `${value.artifact_id}\u0000${value.section_key}`;
}

function canonicalDisposition(
  value: IndexerInventoryDisposition,
): IndexerInventoryDisposition {
  const parsed = inventoryDispositionSchema.parse(value);
  if (parsed.inventory_disposition === "owned") {
    if (parsed.projection_disposition === "detailed") {
      const sectionEvidence = parsed.section_evidence.map((section) => ({
        ...section,
        evidence_refs: canonicalUnique(
          section.evidence_refs,
          `${parsed.member_id}.section_evidence.evidence_refs`,
        ),
      })).sort((left, right) => compareIndexerCanonicalText(
        sectionIdentity(left),
        sectionIdentity(right),
      ));
      canonicalUnique(
        sectionEvidence.map(sectionIdentity),
        `${parsed.member_id}.section_evidence`,
      );
      return { ...parsed, section_evidence: sectionEvidence };
    }
    if (parsed.projection_disposition === "catalog-only") {
      return {
        ...parsed,
        fact_refs: canonicalUnique(parsed.fact_refs, `${parsed.member_id}.fact_refs`),
      };
    }
    if (parsed.projection_disposition === "boundary-only") {
      return {
        ...parsed,
        evidence_refs: canonicalUnique(
          parsed.evidence_refs,
          `${parsed.member_id}.evidence_refs`,
        ),
      };
    }
    return parsed;
  }
  if (parsed.inventory_disposition === "excluded-with-reason") {
    return {
      ...parsed,
      evidence_refs: canonicalUnique(
        parsed.evidence_refs,
        `${parsed.member_id}.evidence_refs`,
      ),
    };
  }
  if (parsed.inventory_disposition === "unsupported") {
    return {
      ...parsed,
      missing_capabilities: canonicalUnique(
        parsed.missing_capabilities,
        `${parsed.member_id}.missing_capabilities`,
      ),
    };
  }
  return parsed;
}

export function indexerInventoryDispositionSetDigest(
  value: Omit<IndexerInventoryDispositionSet, "disposition_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerInventoryDispositionSet(input: {
  author_workset_digest: string;
  group_projection_digest: string;
  logical_unit_ref: string;
  dispositions: readonly IndexerInventoryDisposition[];
}): IndexerInventoryDispositionSet {
  const dispositions = input.dispositions.map(canonicalDisposition)
    .sort((left, right) => compareIndexerCanonicalText(left.member_id, right.member_id));
  const members = canonicalIndexerInventoryMembers(dispositions.map((disposition) => ({
    member_id: disposition.member_id,
    member_kind: disposition.member_kind,
  })));
  if (members.length === 0) {
    throw new TypeError("inventory disposition set requires at least one member");
  }
  const payload: Omit<IndexerInventoryDispositionSet, "disposition_digest"> = {
    protocol: "context.indexer.inventory-disposition-set/v1",
    author_workset_digest: indexerDigestSchema.parse(input.author_workset_digest),
    group_projection_digest: indexerDigestSchema.parse(input.group_projection_digest),
    logical_unit_ref: indexerCanonicalRefSchema.parse(input.logical_unit_ref),
    member_ids_digest: indexerInventoryMemberIdsDigest(members),
    member_inventory_digest: indexerInventoryMembersDigest(members),
    dispositions,
  };
  return indexerInventoryDispositionSetSchema.parse({
    ...payload,
    disposition_digest: indexerInventoryDispositionSetDigest(payload),
  });
}

function knownSet(values: readonly string[], field: string): ReadonlySet<string> {
  return new Set(canonicalUnique(values, field));
}

function validateDetailedProjection(input: {
  disposition: Extract<IndexerInventoryDisposition, {
    inventory_disposition: "owned";
    projection_disposition: "detailed";
  }>;
  known_evidence: ReadonlySet<string>;
  sections: ReadonlyMap<string, ReadonlySet<string>>;
}): void {
  for (const section of input.disposition.section_evidence) {
    const available = input.sections.get(sectionIdentity(section));
    if (available === undefined) {
      throw new TypeError(
        `inventory member ${input.disposition.member_id} references an unknown Section`,
      );
    }
    for (const evidenceRef of section.evidence_refs) {
      if (!input.known_evidence.has(evidenceRef) || !available.has(evidenceRef)) {
        throw new TypeError(
          `inventory member ${input.disposition.member_id} uses evidence absent from its Section`,
        );
      }
    }
  }
}

export function validateIndexerInventoryDispositionSet(input: {
  value: unknown;
  workset: IndexerMainAuthorWorkset;
  known_evidence_refs: readonly string[];
  known_fact_refs: readonly string[];
  section_evidence_inventory: readonly IndexerDispositionSectionEvidenceInventoryItem[];
  capability_group_memberships: readonly IndexerDispositionCapabilityGroupMembership[];
  material_gap_proposal_refs: readonly string[];
}): IndexerInventoryDispositionSet {
  const value = indexerInventoryDispositionSetSchema.parse(input.value);
  const rebuilt = buildIndexerInventoryDispositionSet({
    author_workset_digest: value.author_workset_digest,
    group_projection_digest: value.group_projection_digest,
    logical_unit_ref: value.logical_unit_ref,
    dispositions: value.dispositions,
  });
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(value)) {
    throw new TypeError("inventory disposition set is non-canonical or invalid");
  }
  if (
    value.author_workset_digest !== input.workset.workset_digest ||
    value.group_projection_digest !== input.workset.group_projection_digest ||
    value.logical_unit_ref !== input.workset.logical_unit_ref ||
    value.member_ids_digest !== input.workset.member_ids_digest ||
    value.member_inventory_digest !== input.workset.member_inventory_digest
  ) {
    throw new TypeError("inventory disposition set does not match its author workset");
  }

  const knownEvidence = knownSet(input.known_evidence_refs, "known evidence refs");
  const knownFacts = knownSet(input.known_fact_refs, "known fact refs");
  const materialGaps = knownSet(
    input.material_gap_proposal_refs,
    "material gap proposal refs",
  );
  const sections = new Map<string, ReadonlySet<string>>();
  for (const section of input.section_evidence_inventory) {
    const identity = sectionIdentity(section);
    if (sections.has(identity)) {
      throw new TypeError("Section evidence inventory contains duplicate identities");
    }
    sections.set(identity, knownSet(
      section.evidence_refs,
      `${section.artifact_id}.${section.section_key}.evidence_refs`,
    ));
  }
  const capabilityGroups = new Map<string, ReadonlySet<string>>();
  for (const group of input.capability_group_memberships) {
    if (capabilityGroups.has(group.capability_group_ref)) {
      throw new TypeError("capability group membership contains duplicate identities");
    }
    capabilityGroups.set(
      group.capability_group_ref,
      knownSet(group.member_ids, `${group.capability_group_ref}.member_ids`),
    );
  }

  for (const disposition of value.dispositions) {
    if (disposition.inventory_disposition === "owned") {
      if (disposition.projection_disposition === "detailed") {
        validateDetailedProjection({
          disposition,
          known_evidence: knownEvidence,
          sections,
        });
      } else if (disposition.projection_disposition === "capability-group") {
        if (!capabilityGroups.get(disposition.capability_group_ref)?.has(
          disposition.member_id,
        )) {
          throw new TypeError(
            `inventory member ${disposition.member_id} is absent from its capability group`,
          );
        }
      } else if (disposition.projection_disposition === "catalog-only") {
        if (disposition.fact_refs.some((factRef) => !knownFacts.has(factRef))) {
          throw new TypeError(
            `inventory member ${disposition.member_id} references an unknown catalog Fact`,
          );
        }
      } else if (
        disposition.evidence_refs.some((evidenceRef) => !knownEvidence.has(evidenceRef))
      ) {
        throw new TypeError(
          `inventory member ${disposition.member_id} references unknown boundary evidence`,
        );
      }
    } else if (
      disposition.inventory_disposition === "excluded-with-reason" &&
      disposition.evidence_refs.some((evidenceRef) => !knownEvidence.has(evidenceRef))
    ) {
      throw new TypeError(
        `inventory member ${disposition.member_id} exclusion uses unknown evidence`,
      );
    } else if (
      disposition.inventory_disposition === "request-material" &&
      !materialGaps.has(disposition.material_question_proposal_ref)
    ) {
      throw new TypeError(
        `inventory member ${disposition.member_id} request-material lacks a blocking material gap`,
      );
    }
  }
  return value;
}
