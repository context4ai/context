import type { IndexerInspectorResult, IndexerMaterializedLayerFragment } from "@c4a/context";

export interface CurrentIndexerInspectorMaterialization {
  inspector_request: unknown;
  inspector_result: unknown;
}

export interface CurrentIndexerExtensionFacts {
  inspector_materializations: CurrentIndexerInspectorMaterialization[];
  fragments: IndexerMaterializedLayerFragment[];
}

export function buildCurrentIndexerExtensionFactPayload(input: {
  target_ref: string;
  fact_payloads: IndexerInspectorResult["fact_payloads"];
  source_facts: ReadonlyMap<string, { payload_digest: string }>;
}) {
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const facts = [...input.fact_payloads]
    .sort((left, right) => compare(left.fact_ref, right.fact_ref))
    .map((item, index) => ({
      target_ref: input.target_ref,
      fact_id: `enrichment-${item.payload.profile}-${index + 1}`,
      value: {
        profile: item.payload.profile,
        profile_variants: item.payload.profile_variants,
        source_fact_refs: item.payload.source_fact_refs,
        template_variables: item.payload.template_variables,
        status: item.payload.status,
        ...(item.payload.reason_code === undefined ? {} : { reason_code: item.payload.reason_code }),
      },
      evidence_refs: item.payload.source_fact_refs.map((ref) => {
        const fact = input.source_facts.get(ref);
        if (fact === undefined) {
          throw new TypeError(`extension enrichment references unknown source fact ${ref}`);
        }
        return { ref, kind: "code" as const, source_digest: fact.payload_digest };
      }).sort((left, right) => compare(left.ref, right.ref)),
    }));
  // Inspector fact order is not fragment item order: profile names and numeric
  // suffixes can reorder the resulting identities. Canonicalize the final shape
  // before hashing, using the same code-unit ordering as the SDK validator.
  facts.sort((left, right) => compare(left.fact_id, right.fact_id));
  return { protocol: "context.indexer.fragment.fact-enrichment/v1" as const, facts };
}
