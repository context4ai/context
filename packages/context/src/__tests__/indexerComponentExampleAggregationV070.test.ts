import { describe, expect, test } from "bun:test";
import {
  assertIndexerExampleIdentityAuditPassed,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerExampleIdentityAudit,
  buildIndexerExampleInventory,
  buildIndexerMainWorkset,
  canonicalIndexerNodeRef,
  indexerCapabilityGroupMemberIdsDigest,
  indexerEvidenceAdapterFactRef,
  indexerInventoryMembersDigest,
  validateIndexerCapabilityGroupEvidence,
  type IndexerMainAuthorWorkset,
  type IndexerSubjectKey,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function component(namespace: string): IndexerSubjectKey {
  return {
    protocol: "context.subject-key/v1",
    namespace,
    kind: "component",
    local_key: "Button",
  };
}

function overloadFact(input: {
  source_ref: string;
  module_ref: string;
  signature_digest: string;
}): string {
  return indexerEvidenceAdapterFactRef({
    source_ref: input.source_ref,
    module_ref: input.module_ref,
    normalized_path: "src/Button.tsx",
    qualified_item_path: "export:Button.method:open",
    kind: "public-method",
    signature_digest: input.signature_digest,
  });
}

function authorWorkset(input: {
  logical_unit_ref: string;
  member_ids: string[];
}): IndexerMainAuthorWorkset {
  const value = buildIndexerMainWorkset({
    stage: "author",
    indexer_id: "component-library",
    requirement_ref: "requirement:public-contract",
    owner_cell_refs: ["owner-cell:public-contract#components"],
    source_ref: "repo:sample@revision",
    module_ref: "module:components-a",
    primary_registry_projection_digest: digest("1"),
    requirement_set_digest: digest("2"),
    primary_execution_fingerprint: digest("3"),
    profile_contract_digest: digest("4"),
    subject_key_schema_digest: digest("5"),
    source_scope_digest: digest("6"),
    source_binding_digest: digest("7"),
    primary_resource_binding_digest: digest("8"),
    question_target_inventory_digest: digest("9"),
    partition_plan_binding_digest: digest("a"),
    group_key: "component:Button",
    logical_unit_ref: input.logical_unit_ref,
    member_ids_digest: indexerCapabilityGroupMemberIdsDigest(input.member_ids),
    member_inventory_digest: indexerInventoryMembersDigest(
      input.member_ids.map((member_id) => ({ member_id, member_kind: "method" })),
    ),
    group_projection_digest: digest("b"),
    group_dependency_view_digest: digest("c"),
    allowed_artifact_policy_variants: ["standard"],
    artifact_policy_eligibility_digest: digest("d"),
  });
  if (value.stage !== "author") throw new Error("expected author workset");
  return value;
}

describe("component and example identity aggregation", () => {
  test("separates module namespaces while aggregating overloads and full-path examples", () => {
    const buttonA = canonicalIndexerNodeRef(component("sample/components-a"));
    const buttonB = canonicalIndexerNodeRef(component("sample/components-b"));
    expect(buttonA).not.toBe(buttonB);

    const overloads = [
      overloadFact({
        source_ref: "repo:sample@revision",
        module_ref: "module:components-a",
        signature_digest: digest("e"),
      }),
      overloadFact({
        source_ref: "repo:sample@revision",
        module_ref: "module:components-a",
        signature_digest: digest("f"),
      }),
    ];
    expect(new Set(overloads).size).toBe(2);

    const workset = authorWorkset({ logical_unit_ref: buttonA, member_ids: overloads });
    const evidenceRefs = ["evidence:open-string", "evidence:open-number"];
    const aggregation = buildIndexerCapabilityGroupEvidence({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: buttonA,
      member_ids: overloads,
      capability_groups: [{
        capability_key: "open",
        member_evidence: overloads.map((member_id, index) => ({
          member_id,
          evidence_refs: [evidenceRefs[index]!],
        })),
        section_evidence: [{
          artifact_id: "button-guide",
          section_key: "open",
          evidence_refs: evidenceRefs,
        }],
      }],
    });
    expect(validateIndexerCapabilityGroupEvidence({
      value: aggregation,
      workset,
      known_evidence_refs: evidenceRefs,
      section_evidence_inventory: [{
        artifact_id: "button-guide",
        section_key: "open",
        evidence_refs: evidenceRefs,
      }],
    })).toEqual(aggregation);
    expect(aggregation.capability_groups).toHaveLength(1);
    expect(aggregation.capability_groups[0]!.member_evidence).toHaveLength(2);

    const examples = buildIndexerExampleInventory({
      source_scope_digest: digest("a"),
      observations: [{
        public_target_ref: buttonA,
        scenario_key: "basic-usage",
        source_ref: "repo:sample@revision",
        module_ref: "module:components-a",
        full_relative_path: "stories/basic.tsx",
        content_digest: digest("1"),
        evidence_refs: ["evidence:story-a"],
      }, {
        public_target_ref: buttonA,
        scenario_key: "basic-usage",
        source_ref: "repo:sample@revision",
        module_ref: "module:components-a",
        full_relative_path: "sandboxes/basic.tsx",
        content_digest: digest("2"),
        evidence_refs: ["evidence:sandbox-a"],
      }, {
        public_target_ref: buttonB,
        scenario_key: "basic-usage",
        source_ref: "repo:sample@revision",
        module_ref: "module:components-b",
        full_relative_path: "stories/basic.tsx",
        content_digest: digest("3"),
        evidence_refs: ["evidence:story-b"],
      }],
    });
    const audit = buildIndexerExampleIdentityAudit(examples);
    expect(audit).toMatchObject({
      observation_count: 3,
      unique_example_count: 3,
      collision_count: 0,
      pass: true,
    });
    expect(assertIndexerExampleIdentityAuditPassed({
      value: audit,
      inventory: examples,
    })).toEqual(audit);
  });
});
