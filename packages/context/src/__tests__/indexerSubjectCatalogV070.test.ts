import { describe, expect, test } from "bun:test";
import {
  buildIndexerSubjectCatalog,
  buildIndexerMainWorkset,
  buildIndexerTargetResolutionViews,
  canonicalIndexerNodeRef,
  indexerTargetQueryRef,
  validateIndexerSubjectCatalog,
  type IndexerSubjectKey,
  type IndexerTargetResolutionView,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const PRIMARY: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample",
  kind: "component",
  local_key: "button",
};
const ABSENT: IndexerSubjectKey = {
  ...PRIMARY,
  local_key: "dialog",
};
const CONFLICT: IndexerSubjectKey = {
  ...PRIMARY,
  local_key: "legacy-card",
};

function authorWorkset(view: IndexerTargetResolutionView) {
  return buildIndexerMainWorkset({
    stage: "author",
    indexer_id: "component-library",
    requirement_ref: "requirement:knowledge",
    owner_cell_refs: ["owner-cell:knowledge#public-contract"],
    source_ref: "repo:sample@revision",
    module_ref: "module:sample",
    primary_registry_projection_digest: digest("1"),
    requirement_set_digest: digest("2"),
    primary_execution_fingerprint: digest("3"),
    profile_contract_digest: digest("4"),
    subject_key_schema_digest: digest("a"),
    source_scope_digest: digest("5"),
    source_binding_digest: digest("6"),
    primary_resource_binding_digest: digest("7"),
    question_target_inventory_digest: digest("8"),
    partition_plan_binding_digest: digest("9"),
    group_key: "component:button",
    logical_unit_ref: canonicalIndexerNodeRef(PRIMARY),
    member_ids_digest: digest("b"),
    member_inventory_digest: digest("c"),
    group_projection_digest: digest("d"),
    group_dependency_view_digest: digest("e"),
    target_resolution_view: view,
    allowed_artifact_policy_variants: ["standard"],
    artifact_policy_eligibility_digest: digest("f"),
  });
}

describe("Indexer subject catalog and exact target resolution", () => {
  test("merges approved Nodes and validated partition subjects deterministically", () => {
    const catalog = buildIndexerSubjectCatalog({
      requirement_ref: "requirement:knowledge",
      subject_key_schema_digest: digest("a"),
      approved_subjects: [{
        node_ref: canonicalIndexerNodeRef(PRIMARY),
        subject_key: PRIMARY,
      }],
      partition_subjects: [{
        partition_workset_digest: digest("b"),
        partition_plan_digest: digest("c"),
        group_key: "component:button",
        node_ref: canonicalIndexerNodeRef(PRIMARY),
        subject_key: PRIMARY,
      }],
    });
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]?.origin_refs).toHaveLength(2);
    expect(validateIndexerSubjectCatalog(catalog)).toEqual(catalog);
  });

  test("builds minimal resolved and absent views from exact SubjectKeys", () => {
    const catalog = buildIndexerSubjectCatalog({
      requirement_ref: "requirement:knowledge",
      subject_key_schema_digest: digest("a"),
      approved_subjects: [{
        node_ref: canonicalIndexerNodeRef(PRIMARY),
        subject_key: PRIMARY,
      }],
      partition_subjects: [],
    });
    const result = buildIndexerTargetResolutionViews({
      catalog,
      queries: [{
        group_ref: "partition-group:resolved",
        subject_intent: "enrich-or-independent",
        subject_key: PRIMARY,
      }, {
        group_ref: "partition-group:absent",
        subject_intent: "enrich-or-independent",
        subject_key: ABSENT,
      }],
    });
    expect(result.views[0]?.view.entries[0]?.state).toBe("absent");
    expect(result.views[1]?.view.entries[0]?.state).toBe("resolved");
    expect(result.view_set.items).toHaveLength(2);
    expect(result.views[1]?.view.entries[0]?.query_ref).toBe(indexerTargetQueryRef({
      subject_intent: "enrich-or-independent",
      subject_key: PRIMARY,
      subject_key_schema_digest: digest("a"),
    }));
  });

  test("surfaces an approved key split as ambiguous without title matching", () => {
    const catalog = buildIndexerSubjectCatalog({
      requirement_ref: "requirement:knowledge",
      subject_key_schema_digest: digest("a"),
      approved_subjects: [{
        node_ref: "node:legacy/card-a",
        subject_key: CONFLICT,
      }, {
        node_ref: "node:legacy/card-b",
        subject_key: CONFLICT,
      }],
      partition_subjects: [],
    });
    const result = buildIndexerTargetResolutionViews({
      catalog,
      queries: [{
        group_ref: "partition-group:ambiguous",
        subject_intent: "enrich-or-independent",
        subject_key: CONFLICT,
      }],
    });
    expect(result.views[0]?.view.entries[0]).toEqual({
      query_ref: expect.stringMatching(/^sha256:/),
      state: "ambiguous",
      conflicting_node_refs: ["node:legacy/card-a", "node:legacy/card-b"],
    });
  });

  test("keeps an exact target view and author workset stable across unrelated catalog changes", () => {
    const base = buildIndexerSubjectCatalog({
      requirement_ref: "requirement:knowledge",
      subject_key_schema_digest: digest("a"),
      approved_subjects: [{
        node_ref: canonicalIndexerNodeRef(PRIMARY),
        subject_key: PRIMARY,
      }],
      partition_subjects: [],
    });
    const unrelated = buildIndexerSubjectCatalog({
      requirement_ref: "requirement:knowledge",
      subject_key_schema_digest: digest("a"),
      approved_subjects: [{
        node_ref: canonicalIndexerNodeRef(PRIMARY),
        subject_key: PRIMARY,
      }, {
        node_ref: canonicalIndexerNodeRef(ABSENT),
        subject_key: ABSENT,
      }],
      partition_subjects: [],
    });
    expect(unrelated.catalog_digest).not.toBe(base.catalog_digest);
    const query = [{
      group_ref: "partition-group:resolved",
      subject_intent: "enrich-or-independent" as const,
      subject_key: PRIMARY,
    }];
    const baseResolution = buildIndexerTargetResolutionViews({ catalog: base, queries: query });
    const unrelatedResolution = buildIndexerTargetResolutionViews({
      catalog: unrelated,
      queries: query,
    });
    expect(unrelatedResolution.views).toEqual(baseResolution.views);
    expect(unrelatedResolution.view_set.catalog_digest).not.toBe(
      baseResolution.view_set.catalog_digest,
    );
    expect(authorWorkset(unrelatedResolution.views[0]!.view)).toEqual(
      authorWorkset(baseResolution.views[0]!.view),
    );
  });

  test("rejects one approved Node bound to multiple SubjectKeys", () => {
    expect(() => buildIndexerSubjectCatalog({
      requirement_ref: "requirement:knowledge",
      subject_key_schema_digest: digest("a"),
      approved_subjects: [{
        node_ref: "node:legacy/shared",
        subject_key: PRIMARY,
      }, {
        node_ref: "node:legacy/shared",
        subject_key: ABSENT,
      }],
      partition_subjects: [],
    })).toThrow(/multiple SubjectKeys/);
  });
});
