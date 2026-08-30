import { describe, expect, test } from "bun:test";
import {
  buildIndexerInventoryDispositionSet,
  buildIndexerMainWorkset,
  indexerInventoryMemberIdsDigest,
  indexerInventoryMembersDigest,
  validateIndexerInventoryDispositionSet,
  type IndexerInventoryDisposition,
  type IndexerInventoryMember,
  type IndexerMainAuthorWorkset,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const EVIDENCE_REF = "evidence:inventory-source";
const FACT_REF = "fact:route-catalog";
const CAPABILITY_GROUP_REF = "capability-group:entry-family";
const MATERIAL_PROPOSAL_REF = "proposal:example-material";
const INVENTORY: IndexerInventoryMember[] = [
  { member_id: "member:component", member_kind: "component" },
  { member_id: "member:entry", member_kind: "entry" },
  { member_id: "member:example", member_kind: "example" },
  { member_id: "member:method", member_kind: "method" },
  { member_id: "member:project", member_kind: "project" },
  { member_id: "member:route", member_kind: "route" },
  { member_id: "member:service", member_kind: "service" },
  { member_id: "member:protocol-method", member_kind: "protocol-method" },
  { member_id: "member:handler", member_kind: "handler" },
  { member_id: "member:event-branch", member_kind: "event-branch" },
  { member_id: "member:timer-branch", member_kind: "timer-branch" },
  { member_id: "member:downstream-callsite", member_kind: "downstream-callsite" },
  { member_id: "member:store", member_kind: "store" },
  { member_id: "member:state-transition", member_kind: "state-transition" },
];

function workset(): IndexerMainAuthorWorkset {
  const value = buildIndexerMainWorkset({
    stage: "author",
    indexer_id: "code-indexer",
    requirement_ref: "requirement:technical-knowledge",
    owner_cell_refs: ["owner-cell:technical-knowledge#architecture"],
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
    group_key: "module:sample",
    logical_unit_ref: "node:sample",
    member_ids_digest: indexerInventoryMemberIdsDigest(INVENTORY),
    member_inventory_digest: indexerInventoryMembersDigest(INVENTORY),
    group_projection_digest: digest("b"),
    group_dependency_view_digest: digest("c"),
    allowed_artifact_policy_variants: ["standard"],
    artifact_policy_eligibility_digest: digest("d"),
  });
  if (value.stage !== "author") throw new Error("expected author workset");
  return value;
}

function dispositions(): IndexerInventoryDisposition[] {
  return [{
    member_id: "member:project",
    member_kind: "project",
    inventory_disposition: "owned",
    projection_disposition: "detailed",
    section_evidence: [{
      artifact_id: "module-guide",
      section_key: "overview",
      evidence_refs: [EVIDENCE_REF],
    }],
  }, {
    member_id: "member:entry",
    member_kind: "entry",
    inventory_disposition: "owned",
    projection_disposition: "capability-group",
    capability_group_ref: CAPABILITY_GROUP_REF,
  }, {
    member_id: "member:route",
    member_kind: "route",
    inventory_disposition: "owned",
    projection_disposition: "catalog-only",
    fact_refs: [FACT_REF],
  }, {
    member_id: "member:component",
    member_kind: "component",
    inventory_disposition: "owned",
    projection_disposition: "boundary-only",
    evidence_refs: [EVIDENCE_REF],
  }, {
    member_id: "member:service",
    member_kind: "service",
    inventory_disposition: "excluded-with-reason",
    reason_code: "outside-reader-scope",
    evidence_refs: [EVIDENCE_REF],
  }, {
    member_id: "member:method",
    member_kind: "method",
    inventory_disposition: "unsupported",
    missing_capabilities: ["method-body-parser"],
  }, {
    member_id: "member:example",
    member_kind: "example",
    inventory_disposition: "request-material",
    material_question_proposal_ref: MATERIAL_PROPOSAL_REF,
  }, {
    member_id: "member:protocol-method",
    member_kind: "protocol-method",
    inventory_disposition: "owned",
    projection_disposition: "catalog-only",
    fact_refs: [FACT_REF],
  }, {
    member_id: "member:handler",
    member_kind: "handler",
    inventory_disposition: "owned",
    projection_disposition: "catalog-only",
    fact_refs: [FACT_REF],
  }, {
    member_id: "member:event-branch",
    member_kind: "event-branch",
    inventory_disposition: "owned",
    projection_disposition: "catalog-only",
    fact_refs: [FACT_REF],
  }, {
    member_id: "member:timer-branch",
    member_kind: "timer-branch",
    inventory_disposition: "owned",
    projection_disposition: "catalog-only",
    fact_refs: [FACT_REF],
  }, {
    member_id: "member:downstream-callsite",
    member_kind: "downstream-callsite",
    inventory_disposition: "owned",
    projection_disposition: "catalog-only",
    fact_refs: [FACT_REF],
  }, {
    member_id: "member:store",
    member_kind: "store",
    inventory_disposition: "owned",
    projection_disposition: "catalog-only",
    fact_refs: [FACT_REF],
  }, {
    member_id: "member:state-transition",
    member_kind: "state-transition",
    inventory_disposition: "owned",
    projection_disposition: "catalog-only",
    fact_refs: [FACT_REF],
  }];
}

function build(values: readonly IndexerInventoryDisposition[] = dispositions()) {
  const current = workset();
  return {
    current,
    value: buildIndexerInventoryDispositionSet({
      author_workset_digest: current.workset_digest,
      group_projection_digest: current.group_projection_digest,
      logical_unit_ref: current.logical_unit_ref,
      dispositions: values,
    }),
  };
}

function validate(
  values: readonly IndexerInventoryDisposition[] = dispositions(),
  overrides: Partial<Parameters<typeof validateIndexerInventoryDispositionSet>[0]> = {},
) {
  const { current, value } = build(values);
  return validateIndexerInventoryDispositionSet({
    value,
    workset: current,
    known_evidence_refs: [EVIDENCE_REF],
    known_fact_refs: [FACT_REF],
    section_evidence_inventory: [{
      artifact_id: "module-guide",
      section_key: "overview",
      evidence_refs: [EVIDENCE_REF],
    }],
    capability_group_memberships: [{
      capability_group_ref: CAPABILITY_GROUP_REF,
      member_ids: ["member:entry"],
    }],
    material_gap_proposal_refs: [MATERIAL_PROPOSAL_REF],
    ...overrides,
  });
}

describe("inventory disposition protocol", () => {
  test("closes every common and backend member kind with one strict baseline and projection decision", () => {
    const { value } = build([...dispositions()].reverse());
    expect(validateIndexerInventoryDispositionSet({
      value,
      workset: workset(),
      known_evidence_refs: [EVIDENCE_REF],
      known_fact_refs: [FACT_REF],
      section_evidence_inventory: [{
        artifact_id: "module-guide",
        section_key: "overview",
        evidence_refs: [EVIDENCE_REF],
      }],
      capability_group_memberships: [{
        capability_group_ref: CAPABILITY_GROUP_REF,
        member_ids: ["member:entry"],
      }],
      material_gap_proposal_refs: [MATERIAL_PROPOSAL_REF],
    })).toEqual(value);
    expect(value.dispositions.map((item) => item.member_kind).sort()).toEqual([
      "component",
      "downstream-callsite",
      "entry",
      "event-branch",
      "example",
      "handler",
      "method",
      "project",
      "protocol-method",
      "route",
      "service",
      "state-transition",
      "store",
      "timer-branch",
    ]);
  });

  test("rejects incomplete closure and a Provider-relabelled member kind", () => {
    expect(() => validate(dispositions().slice(1))).toThrow(/author workset/);
    const relabelled = dispositions();
    relabelled[0] = { ...relabelled[0]!, member_kind: "entry" };
    expect(() => validate(relabelled)).toThrow(/author workset/);
  });

  test("binds every projection to current Section, group, Fact, evidence, or material gap", () => {
    expect(() => validate(dispositions(), {
      section_evidence_inventory: [],
    })).toThrow(/unknown Section/);
    expect(() => validate(dispositions(), {
      capability_group_memberships: [{
        capability_group_ref: CAPABILITY_GROUP_REF,
        member_ids: ["member:project"],
      }],
    })).toThrow(/absent from its capability group/);
    expect(() => validate(dispositions(), { known_fact_refs: [] }))
      .toThrow(/unknown catalog Fact/);
    expect(() => validate(dispositions(), { known_evidence_refs: [] }))
      .toThrow(/evidence absent|unknown boundary evidence|unknown evidence/);
    expect(() => validate(dispositions(), { material_gap_proposal_refs: [] }))
      .toThrow(/lacks a blocking material gap/);
  });

  test("rejects aliases and fields that do not belong to the selected decision", () => {
    const invalidProjection = structuredClone(dispositions()) as Array<Record<string, unknown>>;
    invalidProjection[0]!.projection_disposition = "explained";
    expect(() => build(invalidProjection as unknown as IndexerInventoryDisposition[]))
      .toThrow();

    const inventedProjection = structuredClone(dispositions()) as Array<Record<string, unknown>>;
    inventedProjection[5]!.projection_disposition = "catalog-only";
    expect(() => build(inventedProjection as unknown as IndexerInventoryDisposition[]))
      .toThrow();
  });
});
