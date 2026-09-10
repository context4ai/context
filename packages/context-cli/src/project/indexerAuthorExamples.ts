import {
  buildIndexerExampleInventory, indexerProtocolDigest,
  type IndexerArtifactFact, type IndexerSubjectKey,
} from "@c4a/context";
import { resolveIndexerAuthorSourceItems, type buildIndexerAuthorSourceItems } from "./indexerAuthorSourceItems.js";

export interface AuthorExampleCandidate {
  scenario_key: string;
  source_item: string;
}

/** The Agent identifies examples from delivered source text. The CLI only
 * binds that selection to its authorized source, version and current subject.
 * A filename or framework convention alone never creates an example. */
export function buildAuthorExampleFacts(input: {
  candidates: readonly AuthorExampleCandidate[];
  sourceIndex: ReturnType<typeof buildIndexerAuthorSourceItems>;
  source_scope_digest: string;
  logical_unit_ref: string;
  subject_key: IndexerSubjectKey;
}): IndexerArtifactFact[] {
  if (!input.candidates.length) return [];
  const observations = input.candidates.map(candidate => {
    const refs = resolveIndexerAuthorSourceItems(input.sourceIndex, [candidate.source_item], "example source_item");
    const bindings = refs.map(ref => input.sourceIndex.bindings.get(ref)!);
    const first = bindings[0];
    if (!first || !first.locator.path || bindings.some(binding =>
      binding.source_ref !== first.source_ref || binding.module_ref !== first.module_ref ||
      binding.locator.path !== first.locator.path || binding.content_digest !== first.content_digest)) {
      throw new TypeError("An example source_item must resolve to one authorized file revision; select an unambiguous Source material item.");
    }
    return {
      public_target_ref: input.logical_unit_ref,
      scenario_key: candidate.scenario_key,
      source_ref: first.source_ref,
      module_ref: first.module_ref,
      full_relative_path: first.locator.path,
      content_digest: first.content_digest,
      evidence_refs: refs,
    };
  });
  const inventory = buildIndexerExampleInventory({ source_scope_digest: input.source_scope_digest, observations });
  return inventory.observations.map(observation => ({
    fact_ref: `fact:example-${indexerProtocolDigest(observation).slice(7)}`,
    fact_kind: "example-candidate",
    subject_key: input.subject_key,
    value: { ...observation, inventory_digest: inventory.inventory_digest },
    evidence_refs: observation.evidence_refs,
  }));
}
