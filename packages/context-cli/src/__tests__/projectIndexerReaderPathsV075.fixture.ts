import {
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
  const logicalUnitRef = indexerProtocolDigest({ source_ref: base.source_ref, group_key: localKey });
  const { proposal_digest: _digest, ...original } = base;
  void _digest;
  const payload = {
    ...original,
    artifact_result_digest: indexerProtocolDigest({ localKey, options }),
    artifacts: base.artifacts.map((artifact, index) => {
      const ref = indexerLayoutArtifactRef(logicalUnitRef, artifact);
      return {
        ...artifact,
        artifact_ref: ref,
        output_path: index === 0
          ? options.path ?? "knowledge/codeindex/anonymous-package/shared-guide.md"
          : `knowledge/codeindex/anonymous-package/${artifact.artifact_id}.md`,
        sections: artifact.sections.map((section) => {
          const identity = indexerLayoutSectionIdentityRef({
            artifact_ref: ref,
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
    articles: proposals.flatMap((proposal) => proposal.artifacts.map((artifact) => ({
      article_id: artifact.artifact_ref,
      path: artifact.output_path.replace(/^knowledge\//u, ""),
      collection: artifact.collection,
      visibility: "public",
      sections: artifact.sections.map((section) => ({ id: section.section_key, references: section.references })),
    }))),
  };
}
