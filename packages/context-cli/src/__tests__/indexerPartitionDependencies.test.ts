import { expect, test } from "bun:test";
import { partitionDependencyDigest } from "../project/indexerPartitionDependencies.js";
import { continuationIdentity } from "../project/indexerRunContinuation.js";
import { assertProjectIndexerMainSourceBinding, type ProjectIndexerMainSourceBinding } from "../project/indexerMainSourceAdapter.js";
import type { MainRunSpec } from "../project/indexerMainRunStoreRecords.js";

function source(peer = "old", content = "same", payload = "same") {
  const facts = [
    { fact_ref: "fact:a", payload, locator: { normalized_path: "a.ts" } },
    { fact_ref: "fact:b", payload: peer, locator: { normalized_path: "b.ts" } },
  ];
  return {
    adapter: "parser-facts", source_ref: "repo:test", module_ref: "module:app",
    source_binding_digest: peer, source_snapshot_digest: peer,
    source_identity_inventory: { files: [
      { normalized_path: "a.ts", content_digest: content },
      { normalized_path: "b.ts", content_digest: peer },
    ] },
    parser_fact_view: { files: [
      { file_ref: "file:a", normalized_path: "a.ts", disposition: "analyzed", facts: [facts[0]] },
      { file_ref: "file:b", normalized_path: "b.ts", disposition: "analyzed", facts: [facts[1]] },
    ] },
    parser_fact_index: new Map(facts.map(fact => [fact.fact_ref, { fact }])),
  } as unknown as ProjectIndexerMainSourceBinding;
}
const projection = { family_key: "a", unresolved: false, file_refs: ["file:a"],
  fact_items: [{ fact_ref: "fact:a", role: "consumer-anchor" as const }] };

test("partition reuse ignores unrelated module changes but retains selected source and fact changes", () => {
  const digest = partitionDependencyDigest(source(), projection);
  expect(digest).toBeDefined();
  expect(partitionDependencyDigest(source("new"), projection)).toBe(digest);
  expect(partitionDependencyDigest(source("old", "changed"), projection)).not.toBe(digest);
  expect(partitionDependencyDigest(source("old", "same", "changed"), projection)).not.toBe(digest);
  expect(partitionDependencyDigest(source(), { ...projection, unresolved: true })).toBe(digest);
  expect(partitionDependencyDigest(source(), { ...projection, file_refs: ["missing"] })).toBeUndefined();
});

function spec(moduleDigest: string, shard?: string) {
  return { request: {
    workset: { stage: "partition", source_binding_digest: moduleDigest, partition_input_digests: [moduleDigest], partition_inventory_digest: "members", source_scope_digest: "scope" },
    run_environment: { source_snapshot_digest: moduleDigest, source_dependency_fingerprint: moduleDigest, source_precedence_digest: moduleDigest,
      primary_execution_projection: { program_digest: "program", config_digest: "config", cli_contract_digest: "contract", profile_contract_digest: "profile" } },
    composition_input: { final_authority_layer_ref: "primary", accepted_fragments: [], rejected_fragment_diagnostics: [] },
  }, validation: { ...(shard ? { partition_dependency_digest: shard } : {}), required_question_target_refs: [] } } as unknown as MainRunSpec;
}

test("only proven shard dependencies allow continuation; legacy/global bindings remain conservative", () => {
  expect(continuationIdentity(spec("before", "shard"))).toBe(continuationIdentity(spec("after", "shard")));
  expect(continuationIdentity(spec("before", "shard"))).not.toBe(continuationIdentity(spec("after", "changed-shard")));
  expect(continuationIdentity(spec("before"))).not.toBe(continuationIdentity(spec("after")));
  const changed = spec("before", "shard");
  changed.validation.required_question_target_refs = ["new-question"];
  expect(continuationIdentity(changed)).not.toBe(continuationIdentity(spec("before", "shard")));
});


test("submission accepts exact shard dependencies after a peer change and rejects changed selected material", () => {
  const binding = source();
  const digest = partitionDependencyDigest(binding, projection)!;
  const workset = { stage: "partition", source_ref: binding.source_ref, module_ref: binding.module_ref,
    profile_contract_digest: binding.profile_contract_digest, source_binding_digest: digest,
    partition_input_digests: [digest] };
  expect(() => assertProjectIndexerMainSourceBinding({ workset, binding: source("peer changed"), partition_projection: projection })).not.toThrow();
  expect(() => assertProjectIndexerMainSourceBinding({ workset, binding: source("same", "changed"), partition_projection: projection })).toThrow("stale source adapter binding");
  expect(() => assertProjectIndexerMainSourceBinding({ workset, binding })).toThrow("stale source adapter binding");
  expect(() => assertProjectIndexerMainSourceBinding({ workset: { ...workset, partition_input_digests: [] }, binding, partition_projection: projection })).toThrow("omits source adapter input digests");
});


test("accepted global-bound partitions require proven selected material equivalence", () => {
  const binding = source("current"), unresolved = { ...projection, unresolved: true };
  const baseline = partitionDependencyDigest(source("historical"), unresolved)!;
  const workset = { stage: "partition", source_ref: binding.source_ref, module_ref: binding.module_ref,
    profile_contract_digest: binding.profile_contract_digest, source_binding_digest: "historical",
    partition_input_digests: ["historical-input"] };
  expect(() => assertProjectIndexerMainSourceBinding({ workset, binding, partition_projection: unresolved,
    accepted_partition_material_digest: baseline })).not.toThrow();
  expect(() => assertProjectIndexerMainSourceBinding({ workset, binding: source("current", "changed"),
    partition_projection: unresolved, accepted_partition_material_digest: baseline })).toThrow("stale source adapter binding");
  try { assertProjectIndexerMainSourceBinding({ workset, binding, partition_projection: unresolved }); }
  catch (error) { expect(error).toMatchObject({ code: 2, detail: {
    reason_code: "indexer-source-binding-stale", source_ref: "repo:test",
    next_action: { command: "context status --format json" },
  } }); return; }
  throw new Error("unproven baseline must not authorize rebinding");
});
