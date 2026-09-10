import {
  buildIndexerAuthorDependencyView, buildIndexerAuthorizedWorksetViewSource, indexerDependencyNodeRef, indexerProtocolDigest,
  validateIndexerAuthorDependencyView, type IndexerAuthorDependencyView, type IndexerMainRunRequest,
} from "@c4a/context";
import type { readApprovedKnowledgeInput } from "./approvedKnowledgeInput.js";

export type ApprovedKnowledgeAuthorInput = Awaited<ReturnType<typeof readApprovedKnowledgeInput>>;

/** Supporting inputs contribute dependencies, never new inventory members. */
export function withApprovedKnowledgeDependencies(view: IndexerAuthorDependencyView, knowledge: ApprovedKnowledgeAuthorInput) {
  const positive = new Map(view.positive_nodes.map(node => [node.node_ref, node]));
  const sources = new Map(view.positive_nodes.flatMap(node => node.kind === "source-span" ? [[node.evidence_ref, node] as const] : []));
  for (const binding of knowledge.evidence_bindings) {
    const previous = sources.get(binding.evidence_ref);
    if (previous && (previous.source_ref !== binding.source_ref || previous.module_ref !== binding.module_ref ||
        previous.locator.path !== binding.locator.path || previous.content_digest !== binding.content_digest)) {
      throw new TypeError("Supporting knowledge conflicts with current source evidence");
    }
    if (previous) continue;
    const node = { kind: "source-span" as const, evidence_ref: binding.evidence_ref,
      source_ref: binding.source_ref, module_ref: binding.module_ref, locator: binding.locator,
      content_digest: binding.content_digest, targets: [{ level: "logical-unit" as const }] };
    const value = { ...node, node_ref: indexerDependencyNodeRef({ polarity: "positive", node }) };
    positive.set(value.node_ref, value); sources.set(value.evidence_ref, value);
  }
  for (const fact of knowledge.facts) {
    const node = { kind: "selected-fact" as const, fact_ref: fact.fact_ref, fact_digest: indexerProtocolDigest(fact),
      source_span_node_refs: fact.evidence_refs.map(ref => sources.get(ref)!.node_ref).sort(),
      targets: [{ level: "logical-unit" as const }] };
    const value = { ...node, node_ref: indexerDependencyNodeRef({ polarity: "positive", node }) };
    positive.set(value.node_ref, value);
  }
  for (const version of knowledge.versions) {
    const node = { kind: "approved-knowledge" as const, target_ref: version.artifact_ref,
      content_digest: indexerProtocolDigest(version), targets: [{ level: "logical-unit" as const }] };
    const value = { ...node, node_ref: indexerDependencyNodeRef({ polarity: "positive", node }) };
    positive.set(value.node_ref, value);
  }
  const withoutRef = <T extends { node_ref: string }>(node: T) => { const { node_ref, ...value } = node; void node_ref; return value; };
  return buildIndexerAuthorDependencyView({ ...view,
    positive_nodes: [...positive.values()].map(withoutRef),
    negative_nodes: view.negative_nodes.map(withoutRef),
  });
}

export function approvedKnowledgeWorksetSource(input: {
  request: IndexerMainRunRequest;
  dependency_view: unknown;
  knowledge: ApprovedKnowledgeAuthorInput;
}) {
  if (input.knowledge.status !== "ready") throw new TypeError("Required supporting knowledge is not ready; finish or revise its upstream article plan");
  const view = validateIndexerAuthorDependencyView(input.dependency_view);
  const selected = new Set(view.positive_nodes.flatMap(node => node.kind === "selected-fact" ? [node.fact_ref] : []));
  if (input.knowledge.facts.some(fact => !selected.has(fact.fact_ref))) throw new TypeError("Supporting knowledge is outside the current Author dependency view");
  return buildIndexerAuthorizedWorksetViewSource({ request: input.request, projection_kind: "approved-knowledge",
    input_digests: [view.view_digest, input.knowledge.dependency_fingerprint], items: [
      ...input.knowledge.facts.map(fact => ({ ref: fact.fact_ref, category: "supporting-fact",
        provenance: { protocol: "context.indexer.approved-knowledge/v1", digest: input.knowledge.dependency_fingerprint },
        value: { fact_ref: fact.fact_ref, kind: fact.fact_kind, payload: fact.value } })),
      ...input.knowledge.reading_sections.map(section => ({ ref: `approved-reading:${indexerProtocolDigest(section)}`,
        category: "approved-interpretation", provenance: { protocol: "context.indexer.approved-knowledge/v1", digest: section.approved_content_digest }, value: section })),
    ] });
}
