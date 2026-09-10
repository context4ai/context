import type { IndexerArtifactResult } from "./indexerArtifactResult.js";
import { indexerDependencyNodeRef, type IndexerAuthorDependencyView } from "./indexerDependencyView.js";
import { indexerExampleInventorySchema, validateIndexerExampleInventory } from "./indexerExampleIdentity.js";
import type { IndexerMainAuthorWorkset } from "./indexerMainWorkset.js";
import { canonicalIndexerJson, compareIndexerCanonicalText, indexerProtocolDigest } from "./indexerProtocolCommon.js";

/** An Agent can identify a scenario in supplied source. This only attests its
 * source coordinates and identity; it does not verify the example's behavior. */
export function exampleFactDependencies(input: {
  workset: IndexerMainAuthorWorkset;
  dependency_view: IndexerAuthorDependencyView;
  result: IndexerArtifactResult;
}) {
  const examples = input.result.facts.filter(fact => fact.fact_kind === "example-candidate");
  if (!examples.length) return [];
  const observationSchema = indexerExampleInventorySchema.shape.observations.element;
  const observations = examples.map(fact => {
    if (fact.value === null || typeof fact.value !== "object" || Array.isArray(fact.value)) {
      throw new TypeError("Example selection must identify an authorized source observation");
    }
    const { inventory_digest, ...value } = fact.value as Record<string, unknown>;
    return { fact, inventory_digest, observation: observationSchema.parse(value) };
  });
  const inventory = validateIndexerExampleInventory({ value: {
    protocol: "context.indexer.example-inventory/v1", source_scope_digest: input.workset.source_scope_digest,
    observations: observations.map(item => item.observation).sort((a, b) => compareIndexerCanonicalText(a.observation_ref, b.observation_ref)),
    inventory_digest: observations[0]!.inventory_digest,
  }, expected_source_scope_digest: input.workset.source_scope_digest });
  const spans = new Map(input.dependency_view.positive_nodes.flatMap(node => node.kind === "source-span" ? [[node.evidence_ref, node] as const] : []));
  return observations.map(({ fact, observation, inventory_digest }) => {
    if (inventory_digest !== inventory.inventory_digest || observation.public_target_ref !== input.workset.logical_unit_ref ||
        fact.fact_ref !== `fact:example-${indexerProtocolDigest(observation).slice(7)}` ||
        canonicalIndexerJson(fact.subject_key) !== canonicalIndexerJson(input.result.logical_unit.subject_key) ||
        canonicalIndexerJson([...fact.evidence_refs].sort(compareIndexerCanonicalText)) !== canonicalIndexerJson(observation.evidence_refs)) {
      throw new TypeError("Example selection identity does not match its current task");
    }
    const sourceRefs = observation.evidence_refs.map(ref => {
      const span = spans.get(ref);
      if (!span || span.source_ref !== observation.source_ref || span.module_ref !== observation.module_ref ||
          span.locator.path !== observation.full_relative_path || span.content_digest !== observation.content_digest) {
        throw new TypeError("Example selection source is outside the current dependency view or has changed");
      }
      return span.node_ref;
    }).sort(compareIndexerCanonicalText);
    const node = { kind: "selected-fact" as const, fact_ref: fact.fact_ref,
      fact_digest: indexerProtocolDigest(fact), source_span_node_refs: sourceRefs, targets: [] };
    return { ...node, node_ref: indexerDependencyNodeRef({ polarity: "positive", node }) };
  });
}
