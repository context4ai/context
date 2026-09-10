import { IndexerInputScopeError } from "./indexerInputScopeRecovery.js";
import { posix } from "node:path";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  buildIndexerSourceIdentityInventory, indexerEvidenceAdapterFileRef,
  indexerProtocolDigest, validateIndexerParserFactView, loadSourcesRegistry,
} from "@c4a/context";
import { bundledIndexerProfileContract } from "./indexerBaseContracts.js";
import { assertPinnedSource, inspectProjectIndexerParserSourceAuthority, materializeProjectIndexerParserFiles } from "./indexerParserSourceMaterialization.js";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import type { IndexerParserAuthorizedFile } from "./indexerParserExecutionPlanning.js";
import type { ProjectIndexerParserFactsSourceBinding } from "./indexerMainSourceAdapter.js";
import type { IndexerConsumerInventoryShard } from "./indexerConsumerWorksetPlanner.js";
import type { IndexerParserSourceSelection } from "./indexerParserRuntimeIndex.js";

async function planningFiles(input: Parameters<typeof resolveIndexerPlanningInventory>[0]): Promise<IndexerParserAuthorizedFile[]> {
  const sources = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const repo = sources.repos.find(repo => repo.name === input.source_ref.slice(5) || repo.id === input.source_ref.slice(5));
  if (!repo) throw new TypeError("Planning source is not registered");
  await assertPinnedSource(join(input.projectRoot, repo.materializedAt), repo.ref);
  const authority = await inspectProjectIndexerParserSourceAuthority(input);
  const identity = indexerProtocolDigest({ authority, source: input.source_ref, module: input.module_ref,
    profile: input.profile_contract_digest });
  const path = join(input.projectRoot, ".tmp/context-runtime/planning-inventories", `${identity.slice(7)}.json`);
  try {
    const cached = JSON.parse(await readFile(path, "utf8"));
    if (cached.identity === identity && Array.isArray(cached.files) && cached.digest === indexerProtocolDigest(cached.files)) return cached.files;
  } catch { /* Missing or corrupt metadata is rebuilt, without a parser dependency. */ }
  const materialized = await materializeProjectIndexerParserFiles({ ...input,
    profile_contract: bundledIndexerProfileContract(), source_scope: { source_ref: input.source_ref, module_ref: input.module_ref } });
  try {
    await atomicWriteFile(path, JSON.stringify({ identity, digest: indexerProtocolDigest(materialized.files), files: materialized.files }));
  } catch {
    process.stderr.write("[context parser] inventory cache unavailable; continuing with the current file inventory\n");
  }
  return materialized.files;
}

/** File identity is sufficient for question targets and application planning.
 * Empty facts mean not yet parsed, never a fabricated parser execution receipt.
 */
export async function resolveIndexerPlanningInventory(input: {
  projectRoot: string; indexer_id: string; source_ref: string; module_ref: string | null;
  profile_contract_digest: string; selection?: IndexerParserSourceSelection;
}): Promise<ProjectIndexerParserFactsSourceBinding> {
  const materialized = await planningFiles(input);
  if (materialized.length === 0) throw new IndexerInputScopeError(input.indexer_id);
  const sourceInput = indexerProtocolDigest(materialized);
  const identity = buildIndexerSourceIdentityInventory({
    ...input, source_input_digest: sourceInput,
    files: materialized.map(file => ({ normalized_path: file.normalized_path,
      content_digest: file.content_digest, facts: [] })),
  });
  const scope = { source_ref: input.source_ref, module_refs: input.module_ref === null ? [] : [input.module_ref] };
  const selectedPaths = input.selection?.paths === undefined ? null : new Set(input.selection.paths);
  const selectedRefs = input.selection?.member_refs === undefined ? null : new Set(input.selection.member_refs);
  const files = materialized.map(file => ({
    file_ref: indexerEvidenceAdapterFileRef({ source_ref: file.source_ref,
      module_ref: file.module_ref, normalized_path: file.normalized_path }), source_ref: file.source_ref,
    module_ref: file.module_ref, normalized_path: file.normalized_path,
    disposition: "analyzed" as const, facts: [],
  })).filter(file => (selectedPaths === null && selectedRefs === null) ||
    selectedPaths?.has(file.normalized_path) || selectedRefs?.has(file.file_ref))
    .sort((a, b) => a.file_ref < b.file_ref ? -1 : a.file_ref > b.file_ref ? 1 : 0);
  const payload = {
    protocol: "context.indexer.parser-fact-view/v1" as const,
    authorized_scope: { ...scope, scope_digest: indexerProtocolDigest(scope) },
    inventory_digest: identity.inventory_digest,
    origin_result_digests: [identity.inventory_digest], files,
    fact_set_digest: indexerProtocolDigest(files.map(file => ({ file_ref: file.file_ref, facts: file.facts }))),
  };
  const view = validateIndexerParserFactView({ ...payload, view_digest: indexerProtocolDigest(payload) });
  return {
    adapter: "parser-facts", inventory_only: true,
    source_ref: input.source_ref, module_ref: input.module_ref,
    profile_contract_digest: input.profile_contract_digest,
    source_binding_digest: identity.inventory_digest, source_snapshot_digest: sourceInput,
    source_identity_inventory: identity, partition_input_digests: [identity.inventory_digest],
    partition_inventory: files.map(file => ({ member_id: file.file_ref, member_kind: "entry" })),
    parser_fact_view: view, parser_fact_index: new Map(),
  };
}

/** Physical reading batches only. Agent owns business boundaries and page plans. */
export function planningInventoryShards(binding: ProjectIndexerParserFactsSourceBinding): IndexerConsumerInventoryShard[] {
  const files = [...binding.parser_fact_view.files].sort((a, b) => a.normalized_path.localeCompare(b.normalized_path));
  const shards: IndexerConsumerInventoryShard[] = [];
  for (let offset = 0; offset < files.length; offset += 64) {
    const batch = files.slice(offset, offset + 64);
    shards.push({
      inventory: batch.map(file => ({ member_id: file.file_ref, member_kind: "entry" })),
      projection: { family_key: `source-inventory:${posix.dirname(batch[0]!.normalized_path)}:${offset / 64}`, unresolved: false,
        file_refs: batch.map(file => file.file_ref).sort(), fact_items: [] },
      question_carrier_score: 1,
    });
  }
  return shards;
}
