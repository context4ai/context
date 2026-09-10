import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  buildIndexerApprovedKnowledge, indexerArtifactResultSchema, indexerEvidenceBindingSchema, indexerLayoutArtifactRef,
  indexerProtocolDigest, validateIndexerApprovedKnowledge,
  type IndexerApprovedKnowledge, type IndexerProjectFileTarget, type IndexerArticlePlan,
} from "@c4a/context";
import type { CandidateRecord } from "./candidateLedger.js";
import { compactApprovedKnowledgeMarkdown, ensureApprovedKnowledgePresentation } from "./approvedKnowledgeMetadata.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { readDeliverableAuthorRecords } from "./indexerDeliveryHistory.js";
import type { ApprovedKnowledgeAuthorInput } from "./approvedKnowledgeAuthorView.js";
import { refreshApprovedKnowledgeRevisionSupport, assertApprovedKnowledgeRevisionCurrent } from "./approvedKnowledgeRevision.js";
import { loadCurrentIndexerRegistry } from "./currentIndexerRegistry.js";

const STRUCTURE_PATH = "knowledge/structure.yaml";

export function approvedKnowledgeContentDigest(markdown: string): string {
  return indexerProtocolDigest(compactApprovedKnowledgeMarkdown(ensureApprovedKnowledgePresentation(markdown)));
}

/** Version of the exact captured file set, not a claimed Git commit or an
 * approval timestamp. Readers compare the same paths with current captures. */
export function approvedKnowledgeSourceVersions(bindings: IndexerApprovedKnowledge["evidence_bindings"]) {
  const sources = new Map<string, { source_ref: string; module_ref: string | null; files: Map<string, string> }>();
  for (const binding of bindings) {
    const key = JSON.stringify([binding.source_ref, binding.module_ref]);
    const source = sources.get(key) ?? { source_ref: binding.source_ref, module_ref: binding.module_ref, files: new Map<string, string>() };
    const previous = source.files.get(binding.locator.path);
    if (previous !== undefined && previous !== binding.content_digest) throw new TypeError("Approved evidence contains conflicting file versions");
    source.files.set(binding.locator.path, binding.content_digest);
    sources.set(key, source);
  }
  return [...sources.values()].map(source => ({ source_ref: source.source_ref, module_ref: source.module_ref,
    version: indexerProtocolDigest([...source.files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) }));
}

export function approvedKnowledgeSnapshotsFromStructure(structure: Record<string, unknown> | null): IndexerApprovedKnowledge[] {
  if (structure?.approved_knowledge === undefined) return [];
  if (!Array.isArray(structure.approved_knowledge)) throw new TypeError("Approved knowledge evidence index must be an array");
  const snapshots = structure.approved_knowledge.map(validateIndexerApprovedKnowledge);
  if (new Set(snapshots.map(snapshot => snapshot.artifact_ref)).size !== snapshots.length) throw new TypeError("Approved knowledge evidence index repeats an article");
  return snapshots;
}

/** Called inside the existing Review write lock. Evidence is committed in the
 * same transaction as approved Markdown; rejection does not create a snapshot. */
export async function prepareApprovedKnowledgeSnapshotTarget(input: {
  projectRoot: string;
  pages: readonly { id: string; relPath: string; content: string }[];
  candidates: readonly CandidateRecord[];
}): Promise<IndexerProjectFileTarget | undefined> {
  if (!input.pages.length) return undefined;
  let before: string | undefined;
  try { before = await readFile(join(input.projectRoot, STRUCTURE_PATH), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const structure = before === undefined ? {} : YAML.parse(before) as Record<string, unknown>;
  if (!structure || typeof structure !== "object" || Array.isArray(structure)) throw new TypeError("Invalid knowledge structure");
  const snapshots = new Map(approvedKnowledgeSnapshotsFromStructure(structure).map(snapshot => [snapshot.artifact_ref, snapshot]));
  const candidates = new Map(input.candidates.map(candidate => [candidate.candidate_id, candidate]));
  const records = input.pages.some(page => !candidates.get(page.id)?.approved_revision)
    ? await readDeliverableAuthorRecords(input.projectRoot) : [];
  const results = records.map(record => indexerArtifactResultSchema.parse(record.artifact_result));
  for (const page of input.pages) {
    const candidate = candidates.get(page.id)!;
    const binding = candidate.indexer_candidate;
    const previous = snapshots.get(binding.artifact_ref) ?? [...snapshots.values()].find(snapshot => snapshot.path ===
      (candidate.approved_revision?.previous_path ?? candidate.path));
    snapshots.delete(binding.artifact_ref);
    if (candidate.approved_revision) {
      const previousPath = candidate.approved_revision.previous_path ?? candidate.path;
      for (const snapshot of snapshots.values()) if (snapshot.path === previousPath) snapshots.delete(snapshot.artifact_ref);
      // A prose edit does not recapture code. Preserve only previously bound
      // facts and surviving section identities at their original source
      // versions; consumption still checks those versions against captures.
      if (previous) {
        if (candidate.approved_revision.knowledge_input?.rebinding) {
          await assertApprovedKnowledgeRevisionCurrent(input.projectRoot, previous.path,
            (await loadCurrentIndexerRegistry(input.projectRoot)).registry, candidate.approved_revision.knowledge_input);
        }
        const refreshed = candidate.approved_revision.knowledge_input
          ? refreshApprovedKnowledgeRevisionSupport(previous, candidate.approved_revision.knowledge_input) : previous;
        const sections = binding.sections.flatMap(section => {
          const old = refreshed.sections.find(old => old.section_key === section.section_key || old.section_ref === section.section_ref);
          return old ? [{ ...old, markdown: section.markdown }] : [];
        });
        if (sections.length) {
          const { snapshot_digest, ...payload } = refreshed; void snapshot_digest;
          const factRefs = new Set(sections.flatMap(section => section.fact_refs));
          const evidenceRefs = new Set(sections.flatMap(section => section.evidence_refs));
          const evidence = refreshed.evidence_bindings.filter(binding => evidenceRefs.has(binding.evidence_ref));
          snapshots.set(previous.artifact_ref, buildIndexerApprovedKnowledge({ ...payload, path: candidate.path,
            approved_content_digest: approvedKnowledgeContentDigest(page.content), sections,
            facts: refreshed.facts.filter(fact => factRefs.has(fact.fact_ref)), evidence_bindings: evidence,
            source_versions: approvedKnowledgeSourceVersions(evidence),
          }));
        }
      }
      continue;
    }
    const matches = results.filter(result => result.artifacts.some(artifact =>
      indexerLayoutArtifactRef(result.logical_unit.logical_unit_ref, artifact) === binding.artifact_ref));
    if (matches.length !== 1) continue; // Composer/legacy pages have no primary fact snapshot.
    const result = matches[0]!;
    const pagePlan = records[results.indexOf(result)]!.validation.page_plan as { articles?: IndexerArticlePlan[] } | undefined;
    const article = result.artifacts.find(artifact => indexerLayoutArtifactRef(result.logical_unit.logical_unit_ref, artifact) === binding.artifact_ref)!;
    const knowledge = records[results.indexOf(result)]!.validation.knowledge_input as ApprovedKnowledgeAuthorInput | undefined;
    const dependencies = pagePlan?.articles?.find(planned => planned.key === article.artifact_id)?.knowledge_dependencies ?? [];
    const evidence = binding.evidence_bindings.map(value => indexerEvidenceBindingSchema.parse(value));
    if (!evidence.length) continue;
    const sections = binding.sections.filter(section => section.evidence_refs.length > 0).map(section => {
      const allowed = new Set(section.evidence_refs);
      return { section_ref: section.section_ref, section_key: section.section_key, markdown: section.markdown, evidence_refs: section.evidence_refs,
        fact_refs: result.facts.filter(fact => fact.evidence_refs.length > 0 && fact.evidence_refs.every(ref => allowed.has(ref))).map(fact => fact.fact_ref) };
    });
    if (!sections.length) continue;
    const refs = new Set(sections.flatMap(section => section.fact_refs));
    const snapshot = buildIndexerApprovedKnowledge({ protocol: "context.indexer.approved-knowledge/v1",
      artifact_ref: binding.artifact_ref, subject_key: result.logical_unit.subject_key,
      primary_indexer_id: records[results.indexOf(result)]!.request.workset.indexer_id,
      path: page.relPath.replace(/^knowledge\//u, ""), approved_content_digest: approvedKnowledgeContentDigest(page.content),
      source_versions: approvedKnowledgeSourceVersions(evidence), sections,
      facts: result.facts.filter(fact => refs.has(fact.fact_ref)), evidence_bindings: evidence,
      dependencies,
      ...(knowledge === undefined ? {} : { dependency_versions: knowledge.versions.filter(version => dependencies.some(dependency => dependency.artifact_ref === version.artifact_ref)) }),
    });
    snapshots.set(snapshot.artifact_ref, snapshot);
  }
  if (!snapshots.size && structure.approved_knowledge === undefined) return undefined;
  const content = YAML.stringify({ ...structure, approved_knowledge: [...snapshots.values()].sort((a, b) => a.artifact_ref < b.artifact_ref ? -1 : a.artifact_ref > b.artifact_ref ? 1 : 0) });
  if (content === before) return undefined;
  return { path: STRUCTURE_PATH, operation: "write", base_digest: before === undefined ? null : durableContentDigest(before),
    target_digest: durableContentDigest(content), content };
}
