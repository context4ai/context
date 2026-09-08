import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalIndexerJson, indexerAuthorDependencyViewSchema,
  indexerSourceIdentityInventorySchema, type IndexerMainWorkset,
} from "@c4a/context";
import { currentLedger, currentSpec, type MainRunSpec, INDEXER_MAIN_RUN_STORE_ROOT } from "./indexerMainRunStoreRecords.js";

/** Work is scoped by sources, reader requirements and result contracts, not the
 * byte identity of the tool that happened to prepare it. Keep the original
 * request/result pair intact when reusing it; never relabel an old result as a
 * result produced by the newly installed Provider. Instructions are refreshed
 * independently by the current batch materializer.
 */
function continuationIdentity(spec: MainRunSpec): string {
  const workset: Record<string, unknown> = { ...spec.request.workset };
  for (const key of ["workset_digest", "primary_execution_fingerprint",
    "primary_resource_binding_digest", "strategy_set_digest",
    "requirement_set_digest", "question_target_inventory_digest"]) delete workset[key];
  const validation = { ...spec.validation };
  delete validation.authorized_strategies;
  const { primary_execution_projection: execution, environment_digest: _digest,
    ...environmentFields } = spec.request.run_environment;
  const environment: Record<string, unknown> = environmentFields;
  void _digest;
  if (spec.request.workset.stage === "author") {
    // Resume by the selected sources/subjects, not by how a parser described
    // them. File contents, membership, requirements and output contracts still
    // participate; line ranges and serialized Fact payload hashes do not.
    const view = indexerAuthorDependencyViewSchema.parse(validation.dependency_view);
    const spans = new Map(view.positive_nodes.flatMap((node) => node.kind === "source-span"
      ? [[node.node_ref, { evidence_ref: node.evidence_ref, source_ref: node.source_ref,
          module_ref: node.module_ref, path: node.locator.path, content_digest: node.content_digest,
          targets: node.targets }] as const] : []));
    const canonicalSort = (values: unknown[]) => values.sort((a, b) =>
      canonicalIndexerJson(a).localeCompare(canonicalIndexerJson(b)));
    validation.dependency_view = {
      source_ref: view.source_ref, module_ref: view.module_ref, logical_unit_ref: view.logical_unit_ref,
      positive_nodes: canonicalSort(view.positive_nodes.map((node) => {
        if (node.kind === "source-span") return { kind: node.kind, ...spans.get(node.node_ref)! };
        if (node.kind === "selected-fact") return {
          kind: node.kind, fact_ref: node.fact_ref, targets: node.targets,
          sources: canonicalSort(node.source_span_node_refs.map((ref) => spans.get(ref))),
        };
        return node;
      })),
      negative_nodes: view.negative_nodes,
    };
    delete workset.group_dependency_view_digest;
    if (workset.source_binding_digest === view.view_digest) delete workset.source_binding_digest;
    if (environment.source_dependency_fingerprint === view.view_digest) delete environment.source_dependency_fingerprint;
    delete environment.dependency_view_digest;
    if (validation.source_identity_inventory !== undefined) {
      const identity = indexerSourceIdentityInventorySchema.parse(validation.source_identity_inventory);
      validation.source_identity_inventory = {
        source_ref: identity.source_ref, module_ref: identity.module_ref,
        files: identity.files.map((file) => ({
          normalized_path: file.normalized_path, content_digest: file.content_digest,
          facts: file.facts.map(({ signature_digest: _signature, ...fact }) => {
            void _signature;
            return fact;
          }),
        })),
      };
    }
  }
  return canonicalIndexerJson({
    workset,
    validation,
    environment,
    program_digest: execution.program_digest,
    config_digest: execution.config_digest,
    cli_contract_digest: execution.cli_contract_digest,
    profile_contract_digest: execution.profile_contract_digest,
    final_authority_layer_ref: spec.request.composition_input.final_authority_layer_ref,
    fragments: spec.request.composition_input.accepted_fragments.map((fragment) => ({
      layer_ref: fragment.layer_ref,
      composer_ref: fragment.composer_ref,
      phase: fragment.phase,
      kind: fragment.kind,
      target_refs: fragment.target_refs,
      payload: fragment.payload,
    })),
    rejected_fragments: spec.request.composition_input.rejected_fragment_diagnostics,
  });
}

export async function reuseCurrentIndexerRuns(input: {
  projectRoot: string;
  specs: readonly MainRunSpec[];
}): Promise<MainRunSpec[]> {
  if (input.specs.length === 0) return [];
  const ledger = await currentLedger(input.projectRoot);
  if (ledger === undefined) return [...input.specs];
  const scopes = new Set(input.specs.map((spec) =>
    `${spec.request.workset.indexer_id}/${spec.request.workset.stage}`
  ));
  const byIdentity = new Map<string, MainRunSpec>();
  // Crossing stages during an explicit current-task adjustment can reuse the
  // earlier stage's accepted cache. This is existing temporary state, removed
  // at final cleanup; no result is relabeled or persisted across tasks.
  if (input.specs.some((spec) => !ledger.entries.some((entry) => entry.stage === spec.request.workset.stage))) {
    let names: string[] = [];
    try { names = await readdir(join(input.projectRoot, INDEXER_MAIN_RUN_STORE_ROOT, "accepted")); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    for (const name of names.sort()) {
      if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue;
      const spec = await currentSpec({ projectRoot: input.projectRoot, request_digest: `sha256:${name.slice(0, -5)}` });
      if (scopes.has(`${spec.request.workset.indexer_id}/${spec.request.workset.stage}`)) byIdentity.set(continuationIdentity(spec), spec);
    }
  }
  for (const entry of ledger.entries) {
    if (!scopes.has(`${entry.indexer_id}/${entry.stage}`)) continue;
    const spec = await currentSpec({
      projectRoot: input.projectRoot, request_digest: entry.execution_request_digest,
    });
    byIdentity.set(continuationIdentity(spec), spec);
  }
  return input.specs.map((spec) => byIdentity.get(continuationIdentity(spec)) ?? spec);
}

export function currentExecutionWorksetFields(input: {
  workset: IndexerMainWorkset;
  execution: { primary_execution_fingerprint: string; primary_resource_binding_digest: string };
}) {
  const { protocol: _protocol, operation: _operation, workset_digest: _digest, ...workset } = input.workset;
  void _protocol; void _operation; void _digest;
  return {
    ...workset,
    primary_execution_fingerprint: input.execution.primary_execution_fingerprint,
    primary_resource_binding_digest: input.execution.primary_resource_binding_digest,
  };
}
