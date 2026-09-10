import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { buildIndexerPostAuthorFragmentRequest, indexerProtocolDigest,
  indexerPostAuthorWorksetSetDigest, type IndexerPostAuthorWorkset } from "@c4a/context";
import {
  INDEXER_POST_AUTHOR_RUN_STORE_ROOT,
  normalizePostAuthorRunSpec,
  readPostAuthorCurrentState,
  readPostAuthorJsonMaybe,
  type PostAuthorRunSpec,
} from "./indexerPostAuthorStorePersistence.js";

async function jsonFiles(root: string, directory: string): Promise<string[]> {
  try {
    return (await readdir(join(root, INDEXER_POST_AUTHOR_RUN_STORE_ROOT, directory)))
      .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Compare actual work, excluding bundle bytes only for caller-proven instruction layers. */
function continuationIdentity(spec: PostAuthorRunSpec, instructionLayers: ReadonlySet<string>) {
  const layer = <T extends {
    target_layer_ref: string; target_layer_integrity: string; target_bundle_digest: string;
  }>(value: T) => {
    const { target_layer_integrity, target_bundle_digest, ...identity } = value;
    return instructionLayers.has(value.target_layer_ref) ? identity : {
      ...identity, target_layer_integrity, target_bundle_digest,
    };
  };
  return indexerProtocolDigest({
    requirement_set_digest: spec.requirement_set_digest,
    validator_contract_digest: spec.validator_contract_digest,
    accepted_input_view_digest: spec.accepted_input_view_digest,
    state: spec.plan.state,
    author_workset_digest: spec.plan.workset_set.author_workset_digest,
    primary_result_digest: spec.plan.workset_set.primary_result_digest,
    primary_result_view: spec.plan.primary_result_view,
    effective_composers: spec.effective_composer_set.entries.map(layer),
    worksets: spec.plan.worksets.map(({ workset_digest: digest, ...workset }) => {
      void digest;
      return layer(workset);
    }),
  });
}

function mergeAuthorities(base: PostAuthorRunSpec, origins: Map<string, PostAuthorRunSpec>) {
  if (base.plan.state === "not-required") return base;
  const effectivePayload = { protocol: base.effective_composer_set.protocol,
    entries: base.effective_composer_set.entries.map((entry) =>
      origins.get(entry.composer_ref)?.effective_composer_set.entries.find((item) =>
        item.composer_ref === entry.composer_ref) ?? entry) };
  const effective = { ...effectivePayload, effective_composer_set_digest: indexerProtocolDigest(effectivePayload) };
  const worksets = base.plan.worksets.map((workset) =>
    origins.get(workset.composer_ref)?.plan.worksets.find((item) =>
      item.composer_ref === workset.composer_ref) ?? workset);
  const { workset_set_digest: digest, ...oldSet } = base.plan.workset_set;
  void digest;
  const set = { ...oldSet, effective_composer_set_digest: effective.effective_composer_set_digest,
    items: worksets.map((workset) => ({ workset_digest: workset.workset_digest,
      composer_ref: workset.composer_ref, composer_selection_entry_digest: workset.composer_selection_entry_digest })) };
  return normalizePostAuthorRunSpec({ ...base, effective_composer_set: effective,
    plan: { ...base.plan, worksets, workset_set: { ...set, workset_set_digest: indexerPostAuthorWorksetSetDigest(set) } } });
}

/** Read-only selection of an original request authority; store recovery validates its receipts. */
export function createPostAuthorContinuationResolver(projectRoot: string) {
  let acceptedFiles: Promise<Set<string>> | undefined;
  let historicalSpecs: Promise<PostAuthorRunSpec[]> | undefined;
  const accepted = () => acceptedFiles ??= jsonFiles(projectRoot, "accepted")
    .then((files) => new Set(files));
  const history = () => historicalSpecs ??= (async () => {
    const files = await jsonFiles(projectRoot, "specs");
    return Promise.all(files.map(async (file) => {
      const raw = await readPostAuthorJsonMaybe(projectRoot,
        join(INDEXER_POST_AUTHOR_RUN_STORE_ROOT, "specs", file)) as PostAuthorRunSpec;
      const spec = normalizePostAuthorRunSpec(raw);
      if (spec.spec_digest !== raw.spec_digest || `${spec.spec_digest.slice(7)}.json` !== file) {
        throw new TypeError("post-author historical spec failed integrity validation");
      }
      return spec;
    }));
  })();
  const hasReceipt = (spec: PostAuthorRunSpec, workset: IndexerPostAuthorWorkset, files: ReadonlySet<string>) =>
    spec.plan.state === "pending" && files.has(
      `${buildIndexerPostAuthorFragmentRequest({ workset,
        primary_result_view: spec.plan.primary_result_view! }).request_digest.slice(7)}.json`,
    );
  return async (requested: PostAuthorRunSpec, instructionLayers: ReadonlySet<string>) => {
    if (requested.plan.state === "not-required" || instructionLayers.size === 0) return requested;
    const previous = await readPostAuthorCurrentState(projectRoot,
      requested.plan.workset_set.author_workset_digest);
    const identity = continuationIdentity(requested, instructionLayers);
    const compatible = (spec: PostAuthorRunSpec) =>
      continuationIdentity(spec, instructionLayers) === identity;
    const files = await accepted();
    if (files.size === 0) return requested;
    const base = previous && compatible(previous.spec) ? previous.spec : requested;
    const origins = new Map<string, PostAuthorRunSpec>();
    for (const workset of base.plan.worksets) {
      if (hasReceipt(base, workset, files)) origins.set(workset.composer_ref, base);
    }
    if (origins.size === base.plan.worksets.length) return base;
    for (const spec of await history()) {
      if (!compatible(spec)) continue;
      for (const workset of spec.plan.worksets) {
        if (!origins.has(workset.composer_ref) && hasReceipt(spec, workset, files)) {
          origins.set(workset.composer_ref, spec);
        }
      }
    }
    return origins.size === 0 ? requested : mergeAuthorities(base, origins);
  };
}
