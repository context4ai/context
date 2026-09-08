import { join } from "node:path";
import { canonicalIndexerJson, indexerProtocolDigest, loadIndexerRegistry } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { INDEXER_CURRENT_FINALIZATION_PATH } from "./indexerComposerFinalization.js";
import { inspectProjectIndexerParserSourceAuthority } from "./indexerParserSourceMaterialization.js";
import { projectIndexerReadTargets } from "./indexerReadScopeAuthorization.js";
import { selectedIndexerExclusions } from "./indexerScopeExclusions.js";

export interface IndexerInputScopeRecovery {
  indexer_id: string;
  registry_digest: string;
  source_registry_digest: string;
  file: "src/indexers.yaml";
  action: string;
}

export class IndexerInputScopeError extends Error {
  constructor(readonly indexerId: string) {
    super(`Indexer ${indexerId} has no supported repository files left in its current read scope and exclusions.`);
    this.name = "IndexerInputScopeError";
  }
}

/** Empty authorized input is a scope decision, not a missing installation.
 * Keep it on the existing recovery Route until that input actually changes. */
export async function recordIndexerInputScopeRecovery(projectRoot: string, error: IndexerInputScopeError): Promise<void> {
  const loaded = await loadIndexerRegistry(projectRoot);
  const source = await inspectProjectIndexerParserSourceAuthority({ projectRoot, indexer_id: error.indexerId });
  const targets = projectIndexerReadTargets({ registry: loaded.registry, indexer_id: error.indexerId });
  const exclusions = selectedIndexerExclusions(loaded.registry, error.indexerId).flatMap((requirement) =>
    requirement.exclusions.map((item) => `${requirement.id}/${item.id}: ${(item.paths ?? ["entire selected scope"]).join(", ")}`));
  const configuration: IndexerInputScopeRecovery = {
    indexer_id: error.indexerId,
    registry_digest: loaded.registryDigest,
    source_registry_digest: source.source_registry_digest,
    file: "src/indexers.yaml",
    action: `Review the selected scope for ${error.indexerId}: ${targets.map((target) => `${target.source_ref} (${target.module_refs.join(", ") || "whole source"})`).join("; ")}. ` +
      `Current exclusions: ${exclusions.join("; ") || "none"}. No supported repository files remain. ` +
      "Confirm the intended input before editing the existing read_scope or requirement exclusions. Do not broaden the scope automatically or install a parser to recover excluded files. If this source has no work in the current goal, remove that inactive requirement/Indexer using the existing configuration workflow. Then refresh Context status.",
  };
  const state = { state: "blocked", diagnostic: error.message, scope_recovery: configuration };
  await atomicWriteFile(join(projectRoot, INDEXER_CURRENT_FINALIZATION_PATH), canonicalIndexerJson({ ...state, revision: indexerProtocolDigest(state) }));
}

export async function indexerInputScopeRecoveryIsCurrent(projectRoot: string, recovery: IndexerInputScopeRecovery): Promise<boolean> {
  const loaded = await loadIndexerRegistry(projectRoot);
  if (loaded.registryDigest !== recovery.registry_digest) return false;
  const authority = await inspectProjectIndexerParserSourceAuthority({ projectRoot, indexer_id: recovery.indexer_id });
  return authority.source_registry_digest === recovery.source_registry_digest;
}
