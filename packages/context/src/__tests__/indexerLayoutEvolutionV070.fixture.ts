import {
  buildIndexerLayoutProposalSet,
  buildIndexerSharedArtifactFingerprint,
  canonicalIndexerNodeRef,
  indexerLayoutArtifactRef,
  indexerLayoutSectionIdentityRef,
  indexerLayoutSectionRef,
  indexerProtocolDigest,
  type IndexerLayoutProposal,
} from "../index.js";

type Collection = "codeindex" | "architecture";

interface SectionSpec {
  key: string;
  content: string;
}

interface ArtifactSpec {
  id: string;
  kind: string;
  collection?: Collection;
  path?: string;
  purpose?: "required" | "discretionary" | "semantic-split";
  splitOf?: string;
  sections: readonly SectionSpec[];
}

const subject = {
  protocol: "context.subject-key/v1" as const,
  namespace: "anonymous-package",
  kind: "guide",
  local_key: "layout-evolution",
};

const nodeRef = canonicalIndexerNodeRef(subject);
const nodeDigest = nodeRef.replace(/^node:subject:sha256:/u, "");
const digest = (value: string) => indexerProtocolDigest({ value });
const sharedArtifactFingerprint = buildIndexerSharedArtifactFingerprint({
  indexer_id: "markdown-indexer",
  program_digest: null,
  instructions_digest: digest("instructions"),
  template_set_digest: digest("templates"),
});

function proposal(specs: readonly ArtifactSpec[]): IndexerLayoutProposal {
  const byId = new Map(specs.map((spec) => [
    spec.id,
    indexerLayoutArtifactRef(nodeRef, {
      artifact_id: spec.id,
      artifact_kind: spec.kind,
    }),
  ]));
  const artifacts = specs.map((spec) => {
    const artifactRef = byId.get(spec.id)!;
    const collection = spec.collection ?? "codeindex";
    const purpose = spec.purpose ?? "required";
    const splitOfArtifactRef = purpose === "semantic-split"
      ? byId.get(spec.splitOf!) ?? null
      : null;
    return {
      artifact_ref: artifactRef,
      node_ref: nodeRef,
      artifact_id: spec.id,
      artifact_kind: spec.kind,
      internal_view_ref: `view:artifact:${digest(`${spec.id}:${collection}`)}`,
      collection,
      output_path: spec.path ??
        `knowledge/${collection}/${nodeDigest}/${spec.id}.md`,
      shared_artifact_fingerprint_digest:
        sharedArtifactFingerprint.fingerprint_digest,
      purpose,
      split_of_artifact_ref: splitOfArtifactRef,
      split_boundary: purpose === "semantic-split"
        ? { axis: "section-key", start_key: "details", end_key: "details" }
        : null,
      sections: spec.sections.map((section) => {
        const sectionIdentityRef = indexerLayoutSectionIdentityRef({
          node_ref: nodeRef,
          owner_indexer_id: "markdown-indexer",
          artifact_kind: spec.kind,
          section_key: section.key,
        });
        return {
          section_ref: indexerLayoutSectionRef(artifactRef, sectionIdentityRef),
          section_identity_ref: sectionIdentityRef,
          section_key: section.key,
          owner_indexer_id: "markdown-indexer",
          document_kind: "guide",
          reader_goal: "understand-capability",
          artifact_kind: spec.kind,
          state: "structured" as const,
          content_digest: digest(section.content),
          evidence_refs: [`evidence:${section.key}`],
          material_question_proposal_ref: null,
          collection_resolution_digest: digest(`${collection}:${spec.kind}`),
        };
      }),
    };
  });
  const payload: Omit<IndexerLayoutProposal, "proposal_digest"> = {
    protocol: "context.indexer.layout-proposal/v1",
    indexer_id: "markdown-indexer",
    source_ref: "file:anonymous-guide",
    profile: "technical-guide",
    profile_contract_digest: digest("profile-contract"),
    subject_key_schema_set_digest: digest("subject-key-schema-set"),
    subject_key_schema_digest: digest("subject-key-schema"),
    artifact_result_digest: digest(`result:${canonicalSpecs(specs)}`),
    post_author_composition_fingerprint: null,
    shared_artifact_fingerprint: sharedArtifactFingerprint,
    node: { node_ref: nodeRef, subject_key: subject },
    artifacts,
  };
  return { ...payload, proposal_digest: indexerProtocolDigest(payload) };
}

function canonicalSpecs(specs: readonly ArtifactSpec[]): string {
  return JSON.stringify(specs);
}

const baselineSpecs: ArtifactSpec[] = [{
  id: "guide",
  kind: "overview",
  sections: [
    { key: "summary", content: "summary-v1" },
    { key: "details", content: "details-v1" },
  ],
}];

const splitSpecs: ArtifactSpec[] = [{
  id: "guide",
  kind: "overview",
  sections: [{ key: "summary", content: "summary-v1" }],
}, {
  id: "guide-continuation",
  kind: "overview",
  purpose: "semantic-split",
  splitOf: "guide",
  sections: [{ key: "details", content: "details-v1" }],
}];

export const indexerLayoutEvolutionFixture = {
  baseline: proposal(baselineSpecs),
  incremental: proposal([{
    ...baselineSpecs[0]!,
    sections: [
      { key: "summary", content: "summary-v2" },
      { key: "details", content: "details-v1" },
    ],
  }]),
  split: proposal(splitSpecs),
  renamed: proposal([{
    id: "guide-renamed",
    kind: "overview",
    sections: baselineSpecs[0]!.sections,
  }]),
  collectionMoved: proposal([{
    ...baselineSpecs[0]!,
    collection: "architecture",
  }]),
  pathMoved: proposal([{
    ...baselineSpecs[0]!,
    path: `knowledge/codeindex/${nodeDigest}/relocated-guide.md`,
  }]),
  added: proposal([...baselineSpecs, {
    id: "examples",
    kind: "examples",
    purpose: "discretionary",
    sections: [{ key: "examples", content: "examples-v1" }],
  }]),
  collision: proposal([...baselineSpecs, {
    id: "duplicate-guide",
    kind: "overview",
    sections: [{ key: "summary", content: "duplicate-summary" }],
  }]),
  outputCollision: proposal([...baselineSpecs, {
    id: "colliding-path",
    kind: "examples",
    path: `knowledge/codeindex/${nodeDigest}/guide.md`,
    sections: [{ key: "examples", content: "examples-v1" }],
  }]),
};

export function layoutSet(proposalValue: IndexerLayoutProposal) {
  return buildIndexerLayoutProposalSet([proposalValue]);
}
