import { describe, expect, test } from "bun:test";
import {
  buildIndexerCapabilityGroupEvidence,
  buildIndexerMainWorkset,
  canonicalIndexerNodeRef,
  indexerCapabilityGroupEvidenceDigest,
  indexerCapabilityGroupMemberIdsDigest,
  indexerInventoryMembersDigest,
  indexerCapabilityGroupRef,
  validateIndexerCapabilityGroupEvidence,
  type IndexerCapabilityGroupEvidence,
  type IndexerMainAuthorWorkset,
  type IndexerSubjectKey,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const MEMBERS = ["member:button", "member:hook/use-button", "member:type/button-props"];
const EVIDENCE = ["evidence:button", "evidence:hook", "evidence:props"];
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component",
  local_key: "button",
};

function workset(): IndexerMainAuthorWorkset {
  const value = buildIndexerMainWorkset({
    stage: "author",
    indexer_id: "component-library",
    requirement_ref: "requirement:public-knowledge",
    owner_cell_refs: ["owner-cell:public-knowledge#public-contract"],
    source_ref: "repo:sample@revision",
    module_ref: "module:sample",
    primary_registry_projection_digest: digest("1"),
    requirement_set_digest: digest("2"),
    primary_execution_fingerprint: digest("3"),
    profile_contract_digest: digest("4"),
    subject_key_schema_digest: digest("5"),
    source_scope_digest: digest("6"),
    parser_contract_digest: digest("7"),
    primary_resource_binding_digest: digest("8"),
    question_target_inventory_digest: digest("9"),
    partition_plan_binding_digest: digest("a"),
    group_key: "component:button",
    logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
    member_ids_digest: indexerCapabilityGroupMemberIdsDigest(MEMBERS),
    member_inventory_digest: indexerInventoryMembersDigest(MEMBERS.map((member_id) => ({
      member_id,
      member_kind: "component",
    }))),
    group_projection_digest: digest("b"),
    group_dependency_view_digest: digest("c"),
    allowed_artifact_policy_variants: ["standard"],
    artifact_policy_eligibility_digest: digest("d"),
  });
  if (value.stage !== "author") throw new Error("expected author workset");
  return value;
}

function evidence(
  current = workset(),
  groups: Parameters<typeof buildIndexerCapabilityGroupEvidence>[0]["capability_groups"] = [{
    capability_key: "button-control",
    member_evidence: MEMBERS.slice(0, 2).map((member_id, index) => ({
      member_id,
      evidence_refs: [EVIDENCE[index]!],
    })),
    section_evidence: [{
      artifact_id: "button-overview",
      section_key: "summary",
      evidence_refs: EVIDENCE.slice(0, 2),
    }],
  }],
): IndexerCapabilityGroupEvidence {
  return buildIndexerCapabilityGroupEvidence({
    author_workset_digest: current.workset_digest,
    group_projection_digest: current.group_projection_digest,
    logical_unit_ref: current.logical_unit_ref,
    member_ids: MEMBERS,
    capability_groups: groups,
  });
}

function validate(value: unknown, current = workset()) {
  return validateIndexerCapabilityGroupEvidence({
    value,
    workset: current,
    known_evidence_refs: EVIDENCE,
    section_evidence_inventory: [{
      artifact_id: "button-overview",
      section_key: "summary",
      evidence_refs: EVIDENCE,
    }],
  });
}

function rehash(value: IndexerCapabilityGroupEvidence): void {
  const payload = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "evidence_digest"),
  ) as Omit<IndexerCapabilityGroupEvidence, "evidence_digest">;
  value.evidence_digest = indexerCapabilityGroupEvidenceDigest(payload);
}

describe("capability-group member and Section evidence", () => {
  test("canonicalizes a complete member universe and validates group evidence", () => {
    const value = evidence();
    expect(validate(value)).toEqual(value);
    expect(value.member_ids).toEqual([...MEMBERS].sort());
    expect(value.capability_groups[0]!.capability_group_ref).toBe(
      indexerCapabilityGroupRef({
        logical_unit_ref: workset().logical_unit_ref,
        capability_key: "button-control",
      }),
    );
  });

  test("keeps capability identity stable when the explicit member set grows", () => {
    const original = evidence();
    const grown = evidence(workset(), [{
      capability_key: "button-control",
      member_evidence: MEMBERS.map((member_id, index) => ({
        member_id,
        evidence_refs: [EVIDENCE[index]!],
      })),
      section_evidence: [{
        artifact_id: "button-overview",
        section_key: "summary",
        evidence_refs: EVIDENCE,
      }],
    }]);
    expect(grown.capability_groups[0]!.capability_group_ref).toBe(
      original.capability_groups[0]!.capability_group_ref,
    );
    expect(grown.evidence_digest).not.toBe(original.evidence_digest);
  });

  test("rejects a digest-consistent non-canonical capability identity", () => {
    const forged = structuredClone(evidence());
    forged.capability_groups[0]!.capability_group_ref = "capability-group:forged";
    rehash(forged);
    expect(() => validate(forged)).toThrow(/not canonical|invalid digest/);
  });

  test("rejects unknown members and membership shared by multiple groups", () => {
    const unknown = evidence(workset(), [{
      capability_key: "unknown-member",
      member_evidence: [
        { member_id: MEMBERS[0]!, evidence_refs: [EVIDENCE[0]!] },
        { member_id: "member:unknown", evidence_refs: [EVIDENCE[1]!] },
      ],
      section_evidence: [{
        artifact_id: "button-overview",
        section_key: "summary",
        evidence_refs: EVIDENCE.slice(0, 2),
      }],
    }]);
    expect(() => validate(unknown)).toThrow(/unknown member/);

    const overlap = evidence(workset(), [{
      capability_key: "button-control",
      member_evidence: [
        { member_id: MEMBERS[0]!, evidence_refs: [EVIDENCE[0]!] },
        { member_id: MEMBERS[1]!, evidence_refs: [EVIDENCE[1]!] },
      ],
      section_evidence: [{
        artifact_id: "button-overview",
        section_key: "summary",
        evidence_refs: EVIDENCE.slice(0, 2),
      }],
    }, {
      capability_key: "button-contract",
      member_evidence: [
        { member_id: MEMBERS[1]!, evidence_refs: [EVIDENCE[1]!] },
        { member_id: MEMBERS[2]!, evidence_refs: [EVIDENCE[2]!] },
      ],
      section_evidence: [{
        artifact_id: "button-overview",
        section_key: "summary",
        evidence_refs: EVIDENCE.slice(1),
      }],
    }]);
    expect(() => validate(overlap)).toThrow(/multiple capability groups/);
  });

  test("requires every member evidence item to be visible in a real group Section", () => {
    const missingProjection = evidence(workset(), [{
      capability_key: "button-control",
      member_evidence: [
        { member_id: MEMBERS[0]!, evidence_refs: [EVIDENCE[0]!] },
        { member_id: MEMBERS[1]!, evidence_refs: [EVIDENCE[1]!] },
      ],
      section_evidence: [{
        artifact_id: "button-overview",
        section_key: "summary",
        evidence_refs: [EVIDENCE[0]!],
      }],
    }]);
    expect(() => validate(missingProjection)).toThrow(/not projected by a group Section/);

    const unknownSection = evidence(workset(), [{
      capability_key: "button-control",
      member_evidence: [
        { member_id: MEMBERS[0]!, evidence_refs: [EVIDENCE[0]!] },
        { member_id: MEMBERS[1]!, evidence_refs: [EVIDENCE[1]!] },
      ],
      section_evidence: [{
        artifact_id: "button-overview",
        section_key: "missing",
        evidence_refs: EVIDENCE.slice(0, 2),
      }],
    }]);
    expect(() => validate(unknownSection)).toThrow(/unknown Section/);
  });

  test("rejects workset member-set and projection drift", () => {
    const value = evidence();
    const changed = structuredClone(workset());
    changed.member_ids_digest = indexerCapabilityGroupMemberIdsDigest(MEMBERS.slice(0, 2));
    expect(() => validate(value, changed)).toThrow(/does not match its author workset/);
  });
});
