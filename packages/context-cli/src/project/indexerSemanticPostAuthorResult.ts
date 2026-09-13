import {
  indexerArtifactResultSchema,
  indexerArtifactReferences,
  articleFragmentReferences,
  indexerLayerFragmentDigest,
  indexerProtocolDigest,
  validateIndexerPostAuthorFragmentRequest,
  type IndexerLayerFragment,
  type IndexerPostAuthorSemanticInput,
} from "@c4a/context";
import { renderMarkdownSection } from "./markdownPageTitle.js";


function slug(value: string): string {
  const normalized = value.normalize("NFC").toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized.length === 0 ? "content" : normalized;
}

function aliasMap(entries: readonly { canonical: string; aliases: readonly string[] }[]) {
  const result = new Map<string, string>();
  for (const entry of entries) {
    for (const alias of [entry.canonical, ...entry.aliases]) {
      const previous = result.get(alias);
      if (previous !== undefined && previous !== entry.canonical) {
        throw new TypeError(`ambiguous post-author alias ${alias}`);
      }
      result.set(alias, entry.canonical);
    }
  }
  return result;
}

export function buildIndexerPostAuthorResultFromSemantic(input: {
  request: unknown;
  primary_artifact_result: unknown;
  semantic: IndexerPostAuthorSemanticInput;
  allowed_artifact_kinds: readonly string[];
  artifact_policy_variant: string;
}) {
  const request = validateIndexerPostAuthorFragmentRequest(input.request);
  const primary = indexerArtifactResultSchema.parse(input.primary_artifact_result);
  if (input.semantic.outcome === "failed") {
    throw new TypeError(input.semantic.diagnostics.map((item) => item.message).join("; "));
  }
  const targets = aliasMap(request.allowed_target_refs.map((target, index) => ({
    canonical: target,
    aliases: [`target:${index + 1}`],
  })));
  const primaryReferences = primary.artifacts.flatMap(indexerArtifactReferences);
  const referencesFor = (values: IndexerPostAuthorSemanticInput["proposals"][number]["sections"][number]["references"]) =>
    articleFragmentReferences(values.map(value => {
      const reference = primaryReferences.find(ref => ref.source_ref === value.source_ref &&
        ref.locator.path === value.locator.path && ref.locator.start_line === value.locator.start_line &&
        ref.locator.end_line === value.locator.end_line);
      if (!reference) throw new TypeError("Post-author source region is absent from the accepted primary articles");
      return reference;
    }));
  const primarySection = primary.artifacts.flatMap((artifact) =>
    artifact.representation === "sections" ? artifact.sections : []
  )[0];
  const proposals = input.semantic.proposals.map((proposal) => {
    if (!input.allowed_artifact_kinds.includes(proposal.artifact_kind)) {
      throw new TypeError(`post-author Artifact kind is not allowed: ${proposal.artifact_kind}`);
    }
    const target = targets.get(proposal.target);
    if (target === undefined) throw new TypeError(`post-author target is not authorized: ${proposal.target}`);
    const sections = proposal.sections.map((section, index) => ({
      section_key: slug(section.key),
      owner_indexer_id: primary.indexer_id,
      document_kind: primarySection?.document_kind ?? "code-reference",
      reader_goal: primarySection?.reader_goal ?? "understand-capability",
      artifact_kind: proposal.artifact_kind,
      blocks: [{
        block_id: `${slug(section.key)}-prose`,
        layer: "semantic-prose" as const,
        markdown: renderMarkdownSection({
          markdown: section.markdown,
          heading: section.heading,
          ...(index === 0 ? { pageTitle: proposal.title, summary: proposal.summary } : {}),
        }),
        references: referencesFor(section.references),
      }],
    }));
    return {
      composer_ref: request.composer_ref,
      target_node_ref: target,
      artifact: {
        artifact_id: slug(proposal.title),
        artifact_kind: proposal.artifact_kind,
        artifact_policy_variant: input.artifact_policy_variant,
        representation: "sections" as const,
        sections,
      },
    };
  });
  const fragments: IndexerLayerFragment[] = proposals.length === 0
    ? []
    : (() => {
        const payload: Omit<IndexerLayerFragment, "fragment_digest"> = {
          protocol: "context.indexer.layer-fragment/v1",
          workset_digest: request.workset.workset_digest,
          layer_ref: request.target_layer_ref,
          layer_integrity: request.target_layer_integrity,
          composer_ref: request.composer_ref,
          phase: "post-author",
          kind: "derived-artifact-proposal",
          target_refs: [...new Set(proposals.map((proposal) => proposal.target_node_ref))].sort(),
          payload: {
            protocol: "context.indexer.fragment.derived-artifact-proposal/v1",
            proposals,
          },
        };
        return [{ ...payload, fragment_digest: indexerLayerFragmentDigest(payload) }];
      })();
  const payload = {
    protocol: "context.indexer.layer-fragment-result/v1" as const,
    request_digest: request.request_digest,
    composer_ref: request.composer_ref,
    consumed_primary_result_view_digest: request.primary_result_view.view_digest,
    fragments,
  };
  return { ...payload, result_digest: indexerProtocolDigest(payload) };
}
