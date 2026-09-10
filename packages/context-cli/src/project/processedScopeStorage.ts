import { loadCurrentIndexerRegistry as loadIndexerRegistry } from "./currentIndexerRegistry.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { loadSourcesRegistry, mergeProcessedScopes, processedScopesSchema,
  readProcessedScopes, indexerProtocolDigest, type IndexRequirement, type ProcessedScope } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { parseDocumentSnapshotForSource } from "./documentBatchManifest.js";
import { assertPinnedSource } from "./indexerParserSourceMaterialization.js";

export async function currentScopeSourceVersion(projectRoot: string, sourceRef: string): Promise<string> {
  const sources = await loadSourcesRegistry({ rootDir: projectRoot });
  const split = sourceRef.indexOf(":");
  const type = sourceRef.slice(0, split);
  const name = sourceRef.slice(split + 1);
  if (type === "note" || type === "sessions") {
    const { readManagedDocumentSnapshot } = await import("./managedDocumentSnapshot.js");
    return (await readManagedDocumentSnapshot(projectRoot, type, name)).manifest.snapshot_hash;
  }
  if (type === "repo") {
    const entries = sources.repos.filter((entry) => entry.id === name || entry.name === name);
    if (entries.length !== 1) throw new TypeError(`Source must identify one registered repository: ${sourceRef}`);
    const version = entries[0]!.ref;
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(version)) throw new TypeError("Processing requires a fixed commit, not a moving ref");
    await assertPinnedSource(join(projectRoot, entries[0]!.materializedAt), version);
    return version;
  }
  const entries = (type === "file" ? sources.files : type === "lark" ? sources.larks : [])
    .filter((entry) => entry.id === name || entry.name === name);
  if (entries.length !== 1) throw new TypeError(`Source must identify one registered document: ${sourceRef}`);
  const entry = entries[0]!;
  const manifest = entry.snapshot?.manifest ?? `${entry.materializedAt}/manifest.json`;
  return parseDocumentSnapshotForSource(JSON.parse(await readFile(join(projectRoot, manifest), "utf8")), entry.name).snapshot_hash;
}

/** Pin already acquired local inputs. This function does not fetch upstream. */
export async function captureProcessedScopes(projectRoot: string, requested: readonly ProcessedScope[]): Promise<ProcessedScope[]> {
  const scopes = processedScopesSchema.parse(requested);
  const { registry } = await loadIndexerRegistry(projectRoot);
  const versions = new Map<string, Promise<string>>();
  for (const scope of scopes) {
    const requirement = registry.requirements.find((item) => item.id === scope.requirement_ref);
    const target = requirement && [...requirement.target_scope.targets, ...requirement.evidence_source_scope.targets]
      .find((item) => item.source_ref === scope.source_ref);
    if (!target || (target.module_refs.length > 0 &&
        (!scope.module_refs || scope.module_refs.some((module) => !target.module_refs.includes(module))))) {
      throw new TypeError("Processing scope is outside its confirmed requirement source/module boundary");
    }
    const { projectIndexerReadTargets, projectIndexerReadTargetAllows } = await import("./indexerReadScopeAuthorization.js");
    const owners = registry.indexers.filter((indexer) => indexer.requirement_bindings.some((binding) => binding.requirement_ref === scope.requirement_ref));
    if (!owners.some((indexer) => {
      const targets = projectIndexerReadTargets({ registry, indexer_id: indexer.id });
      return (scope.module_refs ?? [null]).every((module_ref) => projectIndexerReadTargetAllows({ targets, source_ref: scope.source_ref, module_ref }));
    })) throw new TypeError("Processing source is outside the selected Indexer's explicit read_scope; confirm that existing scope before reading supporting material.");
    if (!versions.has(scope.source_ref)) versions.set(scope.source_ref, currentScopeSourceVersion(projectRoot, scope.source_ref));
    if (await versions.get(scope.source_ref) !== scope.processed_version) {
      throw new TypeError("Processing target differs from the acquired source version; import the fixed target before starting this update");
    }
  }
  return scopes;
}

/** Caller holds the workspace lock and has finished every page and required
 * build in these scopes, or explicitly concluded that the scopes need no edits. */
export async function commitProcessedScopes(projectRoot: string, scopes: readonly ProcessedScope[]): Promise<void> {
  if (scopes.length === 0) return;
  await captureProcessedScopes(projectRoot, scopes);
  const structure = await readKnowledgeStructure(projectRoot);
  if (structure.parsed === null) throw new TypeError("A closed knowledge structure is required before recording processed scopes");
  const processed = mergeProcessedScopes(readProcessedScopes(structure.parsed), scopes);
  await atomicWriteFile(join(projectRoot, structure.path), YAML.stringify({ ...structure.parsed, processed_scopes: processed }));
}

/** Clear only proofs whose purpose/boundary changed, before committing that
 * configuration. A failed configuration write may leave an unknown baseline,
 * never a false claim that the new purpose was processed under an old one. */
export async function invalidateChangedProcessedRequirements(projectRoot: string,
  previous: readonly IndexRequirement[], current: readonly IndexRequirement[]): Promise<void> {
  const targets = new Map(current.map((requirement) => [requirement.id, indexerProtocolDigest(requirement)]));
  const changed = new Set(previous.filter((requirement) => targets.get(requirement.id) !== indexerProtocolDigest(requirement)).map((requirement) => requirement.id));
  if (changed.size === 0) return;
  const structure = await readKnowledgeStructure(projectRoot);
  if (!structure.parsed) return;
  const scopes = readProcessedScopes(structure.parsed);
  const retained = scopes.filter((scope) => !changed.has(scope.requirement_ref));
  if (retained.length === scopes.length) return;
  await atomicWriteFile(join(projectRoot, structure.path), YAML.stringify({ ...structure.parsed, processed_scopes: retained }));
}
