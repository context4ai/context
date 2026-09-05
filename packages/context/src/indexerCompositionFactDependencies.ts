import type { IndexerArtifactResult } from "./indexerArtifactResult.js";
import {
  indexerDependencyNodeRef,
  type IndexerAuthorDependencyView,
} from "./indexerDependencyView.js";
import { validateIndexerLayerCompositionInput } from "./indexerLayerComposition.js";
import type { IndexerMainAuthorWorkset } from "./indexerMainWorkset.js";
import { compareIndexerCanonicalText, indexerProtocolDigest } from "./indexerProtocolCommon.js";

// Extensions are bound to the execution request, after the base author workset
// exists. Resolve their dependencies from that accepted composition rather than
// feeding fragment digests back into the workset (which would create a cycle).
export function compositionFactDependencies(input: {
  composition_input: unknown;
  workset: IndexerMainAuthorWorkset;
  dependency_view: IndexerAuthorDependencyView;
  result: IndexerArtifactResult;
}) {
  const composition = validateIndexerLayerCompositionInput(input.composition_input);
  if (composition.workset_digest !== input.workset.workset_digest ||
      composition.final_authority_layer_ref !== input.result.provider_layer_ref) {
    throw new TypeError("extension composition belongs to another author run");
  }
  const selected = new Map(input.dependency_view.positive_nodes.flatMap((node) =>
    node.kind === "selected-fact" ? [[node.fact_ref, node] as const] : []
  ));
  const spans = new Map(input.dependency_view.positive_nodes.flatMap((node) =>
    node.kind === "source-span" ? [[node.node_ref, node] as const] : []
  ));
  return composition.accepted_fragments.flatMap((fragment) => {
    if (fragment.payload.protocol !== "context.indexer.fragment.fact-enrichment/v1") return [];
    return fragment.payload.facts.map((fact) => {
      if (fact.target_ref !== input.workset.logical_unit_ref) {
        throw new TypeError("extension fact belongs to another logical unit");
      }
      const sourceSpanRefs = [...new Set(fact.evidence_refs.flatMap((ref) => {
        const source = selected.get(ref.ref);
        if (source === undefined) {
          throw new TypeError(`extension fact references unavailable source fact ${ref.ref}`);
        }
        return source.source_span_node_refs;
      }))].sort(compareIndexerCanonicalText);
      const evidenceRefs = [...new Set(sourceSpanRefs.map((ref) => {
        const span = spans.get(ref);
        if (span === undefined) throw new TypeError("extension fact has no authorized source span");
        return span.evidence_ref;
      }))].sort(compareIndexerCanonicalText);
      const factRef = `layer-fact:${fragment.fragment_digest}/${fact.fact_id}`;
      const node = {
        kind: "selected-fact" as const,
        fact_ref: factRef,
        fact_digest: indexerProtocolDigest({
          fact_ref: factRef,
          fact_kind: fact.fact_id,
          subject_key: input.result.logical_unit.subject_key,
          value: fact.value,
          evidence_refs: evidenceRefs,
        }),
        source_span_node_refs: sourceSpanRefs,
        targets: [],
      };
      return { ...node, node_ref: indexerDependencyNodeRef({ polarity: "positive", node }) };
    });
  });
}
