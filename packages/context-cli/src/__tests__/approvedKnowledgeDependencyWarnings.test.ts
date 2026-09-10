import { expect, test } from "bun:test";
import { buildIndexerApprovedKnowledge, indexerEvidenceBindingDigest, indexerProtocolDigest, type IndexerApprovedKnowledge } from "@c4a/context";
import { staleApprovedKnowledgeRefs } from "../project/approvedKnowledgeDependencyWarnings.js";

function article(id: string, parent?: IndexerApprovedKnowledge) {
  const digest = indexerProtocolDigest(id);
  const evidence = { evidence_ref: `evidence:${id}`, kind: "code" as const, source_ref: "repo:example", module_ref: "module:service",
    locator: { path: `src/${id}.ts`, start_line: 1, end_line: 1 }, content_digest: digest, coverage_tier: "ast-catalog" as const };
  return buildIndexerApprovedKnowledge({ protocol: "context.indexer.approved-knowledge/v1", artifact_ref: `artifact:${id}`,
    subject_key: { protocol: "context.subject-key/v1", namespace: "example", kind: "service", local_key: id },
    path: `codeindex/${id}.md`, approved_content_digest: digest,
    source_versions: [{ source_ref: evidence.source_ref, module_ref: evidence.module_ref, version: digest }],
    evidence_bindings: [{ ...evidence, binding_digest: indexerEvidenceBindingDigest(evidence) }], facts: [],
    sections: [{ section_ref: `section:${id}`, markdown: "A source-bound entry.", evidence_refs: [evidence.evidence_ref], fact_refs: [] }],
    dependencies: parent ? [{ artifact_ref: parent.artifact_ref, required: true, section_refs: [] }] : [],
    dependency_versions: parent ? [{ artifact_ref: parent.artifact_ref, approved_content_digest: parent.approved_content_digest,
      projection_digest: indexerProtocolDigest({ snapshot: parent.snapshot_digest, sections: parent.sections.map(section => section.section_ref).sort() }) }] : [],
  });
}

test("support projection changes invalidate downstream articles even if approved Markdown is unchanged", () => {
  const upstream = article("entry"), overview = article("overview", upstream), journey = article("journey", overview);
  const current = new Map([upstream, overview, journey].map(snapshot => [snapshot.artifact_ref, snapshot.approved_content_digest]));
  expect([...staleApprovedKnowledgeRefs([upstream, overview, journey], current)]).toEqual([]);
  const { snapshot_digest: _, ...payload } = upstream; void _;
  const changed = buildIndexerApprovedKnowledge({ ...payload, sections: payload.sections.map(section => ({ ...section, markdown: "An updated source-bound interpretation." })) });
  expect(staleApprovedKnowledgeRefs([changed, overview, journey], current)).toEqual(new Set([overview.artifact_ref, journey.artifact_ref]));
  expect(staleApprovedKnowledgeRefs([overview, journey], current)).toEqual(new Set([overview.artifact_ref, journey.artifact_ref]));
});

test("omitted optional support is not a stale required promise", () => {
  const base = article("entry"), { snapshot_digest: _, ...payload } = base; void _;
  const optional = buildIndexerApprovedKnowledge({ ...payload, dependencies: [{ artifact_ref: "artifact:absent", required: false, section_refs: [] }] });
  expect([...staleApprovedKnowledgeRefs([optional], new Map([[optional.artifact_ref, optional.approved_content_digest]]))]).toEqual([]);
});
