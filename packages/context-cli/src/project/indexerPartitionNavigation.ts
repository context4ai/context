import { reuseCommandFileRead } from "./commandReadCache.js";
import { join, resolve } from "node:path";
import { buildIndexerAuthorizedWorksetViewSource, indexerProtocolDigest, loadSourcesRegistry } from "@c4a/context";
import { currentLedger, currentSpec, runSpecPath, INDEXER_MAIN_RUN_CURRENT_PATH, type MainRunSpec } from "./indexerMainRunStoreRecords.js";
import type { ProjectIndexerParserFactsSourceBinding } from "./indexerMainSourceAdapter.js";

/** Names and counts across the selected requirement; no speculative page plan
 * or automatic exclusion. Full inventory remains owned by individual tasks. */
export async function buildPartitionNavigation(root: string, spec: MainRunSpec) {
  const ledger = await currentLedger(root);
  const entries = ledger?.entries.filter(entry => entry.stage === "partition") ?? [];
  const tasks = await reuseCommandFileRead({ key: `partition-navigation:${spec.request.workset.requirement_ref}`,
    paths: [INDEXER_MAIN_RUN_CURRENT_PATH, ...entries.map(entry => runSpecPath(entry.execution_request_digest))].map(path => join(root, path)),
    read: () => Promise.all(entries.map(async entry => {
    const task = await currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest });
    if (task.request.workset.requirement_ref !== spec.request.workset.requirement_ref) return undefined;
    const projection = task.validation.partition_projection as { family_key?: string; unresolved?: boolean; file_refs?: string[] } | undefined;
    return { indexer: task.request.workset.indexer_id, source: task.request.workset.source_ref, module: task.request.workset.module_ref,
      family: projection?.family_key ?? null, unresolved: projection?.unresolved ?? false, subject: task.request.workset.stage === "partition" ? task.request.workset.partition_subject_key : null,
      members: (task.validation.canonical_inventory_members as unknown[] | undefined)?.length ?? 0,
      file_count: projection?.file_refs?.length ?? 0 };
  })),
  });
  const overview = tasks.filter(task => task !== undefined);
  const digest = indexerProtocolDigest(overview);
  return buildIndexerAuthorizedWorksetViewSource({ request: spec.request, projection_kind: "partition-navigation",
    input_digests: [digest], items: [{ ref: "partition-navigation:current", category: "partition-navigation",
      provenance: { protocol: "context.indexer.partition-navigation/v1", digest },
      value: { tasks: overview, guidance: "Inspect the whole scope before declaring a theme ready. Task counts are not page counts; other tasks may contribute to the same subject. Read detailed facts or bounded source files where the overview cannot resolve ownership." } }] });
}

export async function buildPartitionSourceAccess(input: {
  projectRoot: string; spec_request: MainRunSpec["request"];
  binding: ProjectIndexerParserFactsSourceBinding; paths: string[];
}) {
  const registry = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const name = input.binding.source_ref.slice("repo:".length);
  const repo = registry.repos.find(source => source.id === name || source.name === name);
  if (!repo) throw new TypeError("Partition source repository is not registered");
  const value = { source_ref: input.binding.source_ref, module_ref: input.binding.module_ref,
    captured_root: resolve(input.projectRoot, repo.materializedAt), paths: input.paths,
    guidance: "Read these captured files as needed. Additional exploration stays within the registered module and requirement read scope. Exploration does not expand this task's inventory ownership." };
  const digest = indexerProtocolDigest(value);
  return buildIndexerAuthorizedWorksetViewSource({ request: input.spec_request, projection_kind: "partition-source-access",
    input_digests: [digest], items: [{ ref: `source-access:${input.binding.source_ref}`, category: "source-access",
      provenance: { protocol: "context.indexer.partition-source-access/v1", digest }, value }] });
}
