import { z } from "zod";
import { indexerArtifactFactSchema, type IndexerArtifactFact } from "./indexerContentLayers.js";
import { indexerEvidenceBindingSchema } from "./indexerArtifactResult.js";
import { indexerSubjectKeySchema, type IndexerSubjectKey } from "./indexerSubjectIdentity.js";
import { indexerCanonicalRefSchema, indexerDigestSchema, indexerProtocolDigest, portableIndexerPathSchema } from "./indexerProtocolCommon.js";
import { indexerKnowledgeDependencySchema, indexerKnowledgeDependencyVersionSchema, type IndexerKnowledgeDependency, type IndexerKnowledgeDependencyVersion } from "./indexerKnowledgeDependency.js";

export const indexerApprovedKnowledgeSchema = z.object({
  protocol: z.literal("context.indexer.approved-knowledge/v1"),
  artifact_ref: indexerCanonicalRefSchema,
  subject_key: indexerSubjectKeySchema,
  primary_indexer_id: z.string().min(1).optional(),
  path: portableIndexerPathSchema,
  approved_content_digest: indexerDigestSchema,
  source_versions: z.array(z.object({
    source_ref: indexerCanonicalRefSchema,
    module_ref: indexerCanonicalRefSchema.nullable(),
    version: z.string().min(1),
  }).strict()).min(1),
  sections: z.array(z.object({
    section_ref: indexerCanonicalRefSchema,
    section_key: z.string().min(1).optional(),
    markdown: z.string().min(1),
    fact_refs: z.array(indexerCanonicalRefSchema),
    evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
  }).strict()).min(1),
  facts: z.array(indexerArtifactFactSchema),
  evidence_bindings: z.array(indexerEvidenceBindingSchema),
  dependencies: z.array(indexerKnowledgeDependencySchema),
  dependency_versions: z.array(indexerKnowledgeDependencyVersionSchema).optional(),
  snapshot_digest: indexerDigestSchema,
}).strict();

export type IndexerApprovedKnowledge = z.infer<typeof indexerApprovedKnowledgeSchema>;

const sourceKey = (source: { source_ref: string; module_ref: string | null }) =>
  JSON.stringify([source.source_ref, source.module_ref]);

export function validateIndexerApprovedKnowledge(value: unknown): IndexerApprovedKnowledge {
  const snapshot = indexerApprovedKnowledgeSchema.parse(value);
  const { snapshot_digest, ...payload } = snapshot;
  if (indexerProtocolDigest(payload) !== snapshot_digest) throw new TypeError("Approved knowledge snapshot integrity changed");
  const facts = new Map(snapshot.facts.map(fact => [fact.fact_ref, fact]));
  const evidence = new Map(snapshot.evidence_bindings.map(binding => [binding.evidence_ref, binding]));
  const sources = new Set(snapshot.source_versions.map(sourceKey));
  const versions = snapshot.dependency_versions ?? [];
  if (new Set(versions.map(version => version.artifact_ref)).size !== versions.length ||
      versions.some(version => !snapshot.dependencies.some(dependency => dependency.artifact_ref === version.artifact_ref))) {
    throw new TypeError("Approved knowledge has duplicate or undeclared dependency versions");
  }
  if (facts.size !== snapshot.facts.length || evidence.size !== snapshot.evidence_bindings.length ||
      sources.size !== snapshot.source_versions.length || new Set(snapshot.sections.map(section => section.section_ref)).size !== snapshot.sections.length) {
    throw new TypeError("Approved knowledge snapshot repeats an identity");
  }
  for (const binding of evidence.values()) {
    if (!sources.has(sourceKey(binding))) throw new TypeError("Approved knowledge evidence has no source version");
    const { binding_digest, ...content } = binding;
    if (indexerProtocolDigest(content) !== binding_digest) throw new TypeError("Approved knowledge evidence binding changed");
  }
  for (const fact of facts.values()) {
    if (fact.evidence_refs.some(ref => !evidence.has(ref))) throw new TypeError("Approved knowledge fact has unknown source evidence");
  }
  for (const section of snapshot.sections) {
    if (section.evidence_refs.some(ref => !evidence.has(ref))) throw new TypeError("Approved knowledge section has unknown source evidence");
    for (const ref of section.fact_refs) {
      const fact = facts.get(ref);
      if (!fact || fact.evidence_refs.some(evidenceRef => !section.evidence_refs.includes(evidenceRef))) {
        throw new TypeError("Approved knowledge section fact is outside its evidence binding");
      }
    }
  }
  return snapshot;
}

export function buildIndexerApprovedKnowledge(
  payload: Omit<IndexerApprovedKnowledge, "snapshot_digest">,
): IndexerApprovedKnowledge {
  return validateIndexerApprovedKnowledge({ ...payload, snapshot_digest: indexerProtocolDigest(payload) });
}

export interface PendingKnowledgeDependency {
  artifact_ref: string;
  reason: "not-approved" | "approval-changed" | "section-unavailable" | "source-version-changed" | "dependency-cycle" | "same-group-dependency";
  required: boolean;
}

/** Projection is an authority boundary. It never turns approved prose into a
 * source fact and never assigns the source members to the consuming subject. */
export function projectIndexerApprovedKnowledge(input: {
  dependencies: readonly IndexerKnowledgeDependency[];
  snapshots: readonly IndexerApprovedKnowledge[];
  approved_versions: ReadonlyMap<string, string>;
  authorized_sources: readonly { source_ref: string; module_ref: string | null; version: string }[];
  evidence_kinds: ReadonlySet<string>;
  subject_key: IndexerSubjectKey;
}) {
  const available = new Map(input.snapshots.map(snapshot => [snapshot.artifact_ref, snapshot]));
  if (available.size !== input.snapshots.length) throw new TypeError("Approved knowledge projection repeats an article");
  const scope = new Map(input.authorized_sources.map(source => [sourceKey(source), source.version]));
  if (scope.size !== input.authorized_sources.length || new Set(input.dependencies.map(dependency => dependency.artifact_ref)).size !== input.dependencies.length) {
    throw new TypeError("Approved knowledge projection repeats a source or dependency identity");
  }
  const pending: PendingKnowledgeDependency[] = [];
  const versions: IndexerKnowledgeDependencyVersion[] = [];
  const facts: IndexerArtifactFact[] = [];
  const readingSections: Array<{ artifact_ref: string; section_ref: string; approved_content_digest: string;
    evidence_role: "approved-interpretation"; markdown: string; evidence_refs: string[] }> = [];
  const evidence = new Map<string, IndexerApprovedKnowledge["evidence_bindings"][number]>();
  for (const value of input.dependencies) {
    const dependency = indexerKnowledgeDependencySchema.parse(value);
    const defer = (reason: PendingKnowledgeDependency["reason"]) => pending.push({ artifact_ref: dependency.artifact_ref, required: dependency.required, reason });
    const raw = available.get(dependency.artifact_ref);
    if (!raw) { defer("not-approved"); continue; }
    const snapshot = validateIndexerApprovedKnowledge(raw);
    if (input.approved_versions.get(snapshot.artifact_ref) !== snapshot.approved_content_digest) { defer("approval-changed"); continue; }
    const sections = dependency.section_refs.length ? snapshot.sections.filter(section => dependency.section_refs.includes(section.section_ref)) : snapshot.sections;
    if (sections.length !== (dependency.section_refs.length || snapshot.sections.length)) { defer("section-unavailable"); continue; }
    const factRefs = new Set(sections.flatMap(section => section.fact_refs));
    const evidenceRefs = new Set(sections.flatMap(section => section.evidence_refs));
    const bindings = snapshot.evidence_bindings.filter(binding => evidenceRefs.has(binding.evidence_ref));
    const selectedSourceKeys = new Set(bindings.map(sourceKey));
    const sourceVersions = snapshot.source_versions.filter(source => selectedSourceKeys.has(sourceKey(source)));
    if (sourceVersions.some(source => !scope.has(sourceKey(source)))) {
      throw new TypeError(`Approved knowledge is outside the current read scope: ${snapshot.artifact_ref}`);
    }
    if (sourceVersions.some(source => scope.get(sourceKey(source)) !== source.version)) { defer("source-version-changed"); continue; }
    if (bindings.some(binding => !input.evidence_kinds.has(binding.kind))) throw new TypeError("Provider cannot consume the approved knowledge evidence kind");
    for (const binding of bindings) {
      const previous = evidence.get(binding.evidence_ref);
      if (previous && previous.binding_digest !== binding.binding_digest) throw new TypeError("Approved knowledge sources have conflicting evidence identities");
      evidence.set(binding.evidence_ref, binding);
    }
    const projectionDigest = indexerProtocolDigest({ snapshot: snapshot.snapshot_digest, sections: sections.map(section => section.section_ref).sort() });
    versions.push({ artifact_ref: snapshot.artifact_ref, approved_content_digest: snapshot.approved_content_digest, projection_digest: projectionDigest });
    for (const section of sections) readingSections.push({ artifact_ref: snapshot.artifact_ref, section_ref: section.section_ref,
      approved_content_digest: snapshot.approved_content_digest, evidence_role: "approved-interpretation", markdown: section.markdown, evidence_refs: section.evidence_refs });
    for (const fact of snapshot.facts.filter(fact => factRefs.has(fact.fact_ref))) {
      const value = { approved_artifact_ref: snapshot.artifact_ref, approved_content_digest: snapshot.approved_content_digest,
        original_fact_ref: fact.fact_ref, original_subject: fact.subject_key, source_versions: sourceVersions, value: fact.value };
      facts.push({ fact_ref: `fact:approved-${indexerProtocolDigest(value).slice(7)}`, fact_kind: "approved-knowledge-fact",
        subject_key: input.subject_key, value, evidence_refs: fact.evidence_refs });
    }
  }
  return { status: pending.some(item => item.required) ? "waiting" as const : "ready" as const,
    pending, versions, facts, reading_sections: readingSections, evidence_bindings: [...evidence.values()] };
}
