import {
  canonicalIndexerNodeRef,
  indexerLayoutArtifactRef,
  indexerLayoutSectionIdentityRef,
  indexerLayoutSectionRef,
  indexerProtocolDigest,
  type IndexerLayoutProposal,
} from "@c4a/context";
import { indexerLayoutEvolutionFixture } from
  "../../../context/src/__tests__/indexerLayoutEvolutionV070.fixture.js";

export function readerLayoutProposal(
  localKey: string,
  options: { path?: string; multiple?: boolean } = {},
): IndexerLayoutProposal {
  const base = options.multiple
    ? indexerLayoutEvolutionFixture.added
    : indexerLayoutEvolutionFixture.baseline;
  const subject = { ...base.node.subject_key, local_key: localKey };
  const nodeRef = canonicalIndexerNodeRef(subject);
  const { proposal_digest: _digest, ...original } = base;
  void _digest;
  const payload = {
    ...original,
    node: { node_ref: nodeRef, subject_key: subject },
    artifact_result_digest: indexerProtocolDigest({ localKey, options }),
    artifacts: base.artifacts.map((artifact, index) => {
      const ref = indexerLayoutArtifactRef(nodeRef, artifact);
      return {
        ...artifact,
        node_ref: nodeRef,
        artifact_ref: ref,
        internal_view_ref: `view:artifact:${indexerProtocolDigest({
          protocol: "context.indexer.internal-view-identity/v1",
          artifact_ref: ref,
          collection: artifact.collection,
        })}`,
        output_path: index === 0
          ? options.path ?? "knowledge/codeindex/anonymous-package/shared-guide.md"
          : `knowledge/codeindex/anonymous-package/${artifact.artifact_id}.md`,
        sections: artifact.sections.map((section) => {
          const identity = indexerLayoutSectionIdentityRef({
            node_ref: nodeRef,
            owner_indexer_id: section.owner_indexer_id,
            artifact_kind: artifact.artifact_kind,
            section_key: section.section_key,
          });
          return {
            ...section,
            section_identity_ref: identity,
            section_ref: indexerLayoutSectionRef(ref, identity),
          };
        }),
      };
    }),
  };
  return { ...payload, proposal_digest: indexerProtocolDigest(payload) };
}

export function approvedReaderStructure(proposals: readonly IndexerLayoutProposal[]) {
  return {
    views: proposals.flatMap((proposal) => proposal.artifacts.map((artifact) => ({
      node_ref: proposal.node.node_ref,
      view_ref: artifact.internal_view_ref,
      path: artifact.output_path.replace(/^knowledge\//u, ""),
      collection: artifact.collection,
      title: proposal.node.subject_key.local_key,
    }))),
  };
}
