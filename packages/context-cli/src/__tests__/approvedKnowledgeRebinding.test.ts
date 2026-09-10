import { refreshApprovedKnowledgeRevisionSupport } from "../project/approvedKnowledgeRevision.js";
import { expect, test } from "bun:test";
import { buildIndexerApprovedKnowledge, indexerProtocolDigest, indexerEvidenceBindingDigest, projectIndexerApprovedKnowledge,
  indexerKnowledgeDependencyFingerprint, type IndexerApprovedKnowledge } from "@c4a/context";
import { rebindApprovedKnowledgeSupport, withApprovedKnowledgeSupportSources } from "../project/approvedKnowledgeRebinding.js";
import { approvedKnowledgeSourceVersions } from "../project/approvedKnowledgeSnapshots.js";

function snapshot(name: string): IndexerApprovedKnowledge {
  const subject = { protocol: "context.subject-key/v1" as const, namespace: "example", kind: "service", local_key: name };
  const binding = { evidence_ref: `evidence:${name}`, kind: "code" as const, source_ref: "repo:example", module_ref: "module:service",
    locator: { path: `src/${name}.ts`, start_line: 1, end_line: 2 }, content_digest: indexerProtocolDigest(name), coverage_tier: "ast-catalog" as const };
  const evidence = [{ ...binding, binding_digest: indexerEvidenceBindingDigest(binding) }];
  return buildIndexerApprovedKnowledge({ protocol: "context.indexer.approved-knowledge/v1", artifact_ref: `artifact:${name}`,
    subject_key: subject, path: `codeindex/${name}.md`, approved_content_digest: indexerProtocolDigest(name),
    source_versions: approvedKnowledgeSourceVersions(evidence), evidence_bindings: evidence, dependencies: [],
    sections: [{ section_ref: `section:${name}`, section_key: "entry", markdown: `${name} source entry`, fact_refs: [`fact:${name}`], evidence_refs: [binding.evidence_ref] }],
    facts: [{ fact_ref: `fact:${name}`, fact_kind: "code-symbol", subject_key: subject, value: { name }, evidence_refs: [binding.evidence_ref] }] });
}

test("split and merge replace support explicitly and do not retain retired interpretation facts", () => {
  const original = snapshot("consumer");
  let previous = original;
  for (const names of [["before"], ["split-left", "split-right"], ["merged"]]) {
    const parents = names.map(snapshot);
    const dependencies = parents.map(parent => ({ artifact_ref: parent.artifact_ref, required: true, section_refs: [] }));
    // Each parent has a different captured file-set version; project separately
    // so the test models their independently authorized source scopes.
    const parts = parents.map(parent => projectIndexerApprovedKnowledge({ dependencies: [dependencies.find(dependency => dependency.artifact_ref === parent.artifact_ref)!], snapshots: [parent],
      subject_key: original.subject_key, authorized_sources: parent.source_versions,
      approved_versions: new Map([[parent.artifact_ref, parent.approved_content_digest]]), evidence_kinds: new Set(["code"]) }));
    const facts = parts.flatMap(part => part.facts), evidence = parts.flatMap(part => part.evidence_bindings), versions = parts.flatMap(part => part.versions);
    const input = { status: "ready" as const, pending: [], facts, evidence_bindings: evidence, versions,
      dependency_fingerprint: indexerKnowledgeDependencyFingerprint(versions), reading_sections: parts.flatMap(part => part.reading_sections),
      rebinding: { dependencies, sections: [{ section_key: "entry", fact_refs: [original.facts[0]!.fact_ref, ...facts.map(fact => fact.fact_ref)],
        evidence_refs: [original.evidence_bindings[0]!.evidence_ref, ...evidence.map(binding => binding.evidence_ref)] }] } };
    const rebound = rebindApprovedKnowledgeSupport(previous, input);
    const { snapshot_digest: _digest, ...payload } = rebound; void _digest;
    previous = buildIndexerApprovedKnowledge({ ...payload, source_versions: approvedKnowledgeSourceVersions(rebound.evidence_bindings) });
    expect(previous.dependencies).toEqual(dependencies);
    expect(previous.facts.map(fact => fact.fact_ref).sort()).toEqual([original.facts[0]!.fact_ref, ...facts.map(fact => fact.fact_ref)].sort());
    expect(previous.sections[0]!.markdown).toBe(original.sections[0]!.markdown);
  }
  const input = { status: "ready" as const, pending: [], facts: [], evidence_bindings: [], versions: [], reading_sections: [],
    dependency_fingerprint: indexerKnowledgeDependencyFingerprint([]), rebinding: { dependencies: [], sections: [{ section_key: "entry",
      fact_refs: [original.facts[0]!.fact_ref], evidence_refs: [original.evidence_bindings[0]!.evidence_ref] }] } };
  const removed = rebindApprovedKnowledgeSupport(previous, input);
  expect(removed.dependencies).toEqual([]);
  expect(removed.facts).toEqual(original.facts);
  expect(removed.evidence_bindings).toEqual(original.evidence_bindings);
});

test("a document section can retain direct source text without inventing a parser fact", () => {
  const old = snapshot("document");
  const { snapshot_digest: _digest, ...payload } = old; void _digest;
  const previous = buildIndexerApprovedKnowledge({ ...payload, facts: [], sections: old.sections.map(section => ({ ...section, fact_refs: [] })) });
  const result = rebindApprovedKnowledgeSupport(previous, { status: "ready", pending: [], facts: [], evidence_bindings: [], versions: [], reading_sections: [],
    dependency_fingerprint: indexerKnowledgeDependencyFingerprint([]), rebinding: { dependencies: [], sections: [{ section_key: "entry", fact_refs: [],
      evidence_refs: previous.evidence_bindings.map(binding => binding.evidence_ref) }] } });
  expect(result.facts).toEqual([]);
  expect(result.evidence_bindings).toEqual(previous.evidence_bindings);
});


test("queued support refresh preserves page identity and exposes newly authorized sources", () => {
  const target = { path: "codeindex/consumer.md", view_ref: "view:consumer", source_refs: ["repo:original"],
    markdown: "---\ntitle: Consumer\nsources: [repo:original]\n---\nBody remains unchanged.\n" };
  const evidence = snapshot("new-support").evidence_bindings;
  const result = withApprovedKnowledgeSupportSources(target, { status: "ready", pending: [], facts: [], evidence_bindings: evidence,
    versions: [], reading_sections: [], dependency_fingerprint: indexerKnowledgeDependencyFingerprint([]), rebinding: { dependencies: [] } });
  expect(result.path).toBe(target.path);
  expect(result.view_ref).toBe(target.view_ref);
  expect(result.source_refs).toEqual(["repo:original", "repo:example"]);
  expect(result.markdown).toContain("repo:example");
  expect(result.markdown.endsWith("Body remains unchanged.\n")).toBe(true);
  expect(target.source_refs).toEqual(["repo:original"]);
});


test("support refresh retains distinct ranges in one source file", () => {
  const old = snapshot("ranges");
  const first = old.evidence_bindings[0]!;
  const second = { ...first, evidence_ref: "evidence:second", locator: { ...first.locator, start_line: 10, end_line: 12 } };
  const previous = { ...old, evidence_bindings: [first, second], sections: [old.sections[0]!, { ...old.sections[0]!, section_key: "second", evidence_refs: [second.evidence_ref] }] };
  const replacement = [first, second].map((binding, index) => ({ ...binding, evidence_ref: `evidence:new-${index}` }));
  const result = refreshApprovedKnowledgeRevisionSupport(previous, { status: "ready", pending: [], facts: [], evidence_bindings: replacement,
    versions: [], reading_sections: [], dependency_fingerprint: indexerKnowledgeDependencyFingerprint([]) });
  expect(result.sections.map(section => section.evidence_refs)).toEqual([["evidence:new-0"], ["evidence:new-1"]]);
  expect(result.evidence_bindings.map(binding => binding.locator)).toEqual([first.locator, second.locator]);
});
