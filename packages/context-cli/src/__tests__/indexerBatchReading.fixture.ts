import {
  buildIndexerMainWorkset, buildIndexerAuthorDependencyView, indexerDependencyNodeRef,
  indexerProtocolDigest, type IndexerAuthorizedWorksetView,
} from "@c4a/context";

const digest = indexerProtocolDigest;

/** Four pages from one tiny component package, with common configuration. */
export function authorReadingFixture(index: number, sharedFacts = 80) {
  const sourceRef = "repo:component-fixture";
  const workset = buildIndexerMainWorkset({
    stage: "author", indexer_id: "components", requirement_ref: "requirement:components",
    owner_cell_refs: ["owner-cell:components#public-api"], source_ref: sourceRef, module_ref: null,
    primary_registry_projection_digest: digest("registry"), requirement_set_digest: digest("requirements"),
    primary_execution_fingerprint: digest("execution"), profile_contract_digest: digest("contract"),
    subject_key_schema_digest: digest("schema"), source_scope_digest: digest("scope"),
    source_binding_digest: digest("source"), primary_resource_binding_digest: digest("resources"),
    question_target_inventory_digest: digest("questions"), partition_plan_binding_digest: digest("plan"),
    group_key: `component-${index}`, logical_unit_ref: `node:component-${index}`,
    member_ids_digest: digest({ members: index }), member_inventory_digest: digest({ inventory: index }),
    group_projection_digest: digest({ group: index }), group_dependency_view_digest: digest({ dependency: index }),
    allowed_artifact_policy_variants: ["standard"], artifact_policy_eligibility_digest: digest("eligibility"),
  });
  const source = {
    kind: "source-span" as const, evidence_ref: `evidence:component-${index}`, source_ref: sourceRef, module_ref: null,
    locator: { path: `src/component-${index}.ts`, start_line: 1, end_line: 1 },
    content_digest: digest({ source: index }), targets: [],
  };
  const factValues = Array.from({ length: sharedFacts }, (_, i) => ({
    fact_ref: `fact:shared-${i}`, kind: "config-value", payload_digest: digest(i),
    locator: { normalized_path: "package.json", source_ref: sourceRef, signature_digest: digest(i) },
    payload: { name: `option-${i}`, description: "Shared package contract. ".repeat(45),
      signature_digest: "A real semantic field must survive" },
  }));
  const dependency = buildIndexerAuthorDependencyView({
    source_ref: sourceRef, module_ref: null, logical_unit_ref: `node:component-${index}`,
    positive_nodes: [{ kind: "logical-unit", logical_unit_ref: workset.logical_unit_ref,
      group_projection_digest: workset.group_projection_digest, targets: [{ level: "logical-unit" }] },
    source, ...factValues.map((value) => ({
      kind: "selected-fact" as const, fact_ref: value.fact_ref, fact_digest: value.payload_digest,
      source_span_node_refs: [indexerDependencyNodeRef({ polarity: "positive", node: source })], targets: [],
    }))], negative_nodes: [{ kind: "group-input-set", scope_ref: workset.logical_unit_ref,
      set_digest: workset.member_inventory_digest, targets: [{ level: "logical-unit" }] }],
  });
  const item = (ref: string, category: string, value: unknown) => ({
    ref, category, value, item_digest: digest(value), provenance: { protocol: "fixture", digest: digest({ projection: index }) },
  });
  const text = `export const component${index} = ${index};\n`;
  const view = {
    protocol: "context.indexer.authorized-workset-view/v1", stage: "author", operation: "main-index",
    source_ref: sourceRef, module_ref: null, workset_digest: workset.workset_digest,
    execution_request_digest: digest(index), projection_input_digests: [], view_digest: digest(index),
    items: [
      item(`requirement:${index}`, "index-requirement", { reader_goals: [`Use component ${index}`] }),
      item(`authority:${index}`, "author-authority", { allowed_question_targets: [] }),
      ...factValues.map((value) => item(value.fact_ref, "fact", value)),
      ...dependency.positive_nodes.map((node) => item(node.node_ref, "dependency", node)),
      item(`source-text:component-${index}`, "source-text", { path: source.locator.path, source_ref: sourceRef, module_ref: null,
        spans: [{ start_line: 1, end_line: 1, text, source_span_refs: [indexerDependencyNodeRef({ polarity: "positive", node: source })] }] }),
      item(`extension:${index}`, "extension-note", { behavior: `Special behavior ${index}`, nested: { id: digest(index) } }),
    ],
  } as unknown as IndexerAuthorizedWorksetView;
  return { view, workset, task_key: `task-${String(index + 1).padStart(3, "0")}`, text, factValues };
}
