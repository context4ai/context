import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  indexerKnowledgeDependencyFingerprint, indexerProtocolDigest, projectIndexerApprovedKnowledge,
  type IndexerKnowledgeDependency, type IndexerSubjectKey,
} from "@c4a/context";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { approvedKnowledgeContentDigest, approvedKnowledgeSnapshotsFromStructure, approvedKnowledgeSourceVersions } from "./approvedKnowledgeSnapshots.js";
import { projectIndexerReadTargetAllows, type ProjectIndexerReadTarget } from "./indexerReadScopeAuthorization.js";
import type { ProjectIndexerMainSourceBinding } from "./indexerMainSourceAdapter.js";
import { staleApprovedKnowledgeRefs } from "./approvedKnowledgeDependencyWarnings.js";

/** Use already captured Host materials. This operation never broadens the read
 * scope or clones/fetches a repository merely because an article mentions it. */
export async function readApprovedKnowledgeInput(input: {
  projectRoot: string;
  dependencies: readonly IndexerKnowledgeDependency[];
  subject_key: IndexerSubjectKey;
  authorized_targets: readonly ProjectIndexerReadTarget[];
  bindings: readonly Pick<ProjectIndexerMainSourceBinding, "source_ref" | "module_ref" | "source_identity_inventory">[];
  evidence_kinds: ReadonlySet<string>;
}) {
  if (new Set(input.dependencies.map(dependency => dependency.artifact_ref)).size !== input.dependencies.length) throw new TypeError("Supporting knowledge repeats an article dependency");
  const snapshots = approvedKnowledgeSnapshotsFromStructure((await readKnowledgeStructure(input.projectRoot)).parsed);
  const selected = new Map(snapshots.map(snapshot => [snapshot.artifact_ref, snapshot]));
  const needed = new Set(input.dependencies.map(dependency => dependency.artifact_ref));
  for (const ref of needed) for (const dependency of selected.get(ref)?.dependencies ?? []) needed.add(dependency.artifact_ref);
  const approvedVersions = new Map(snapshots.map(snapshot => [snapshot.artifact_ref, snapshot.approved_content_digest]));
  for (const ref of needed) {
    const snapshot = selected.get(ref);
    if (!snapshot) continue;
    try { approvedVersions.set(ref, approvedKnowledgeContentDigest(await readFile(join(input.projectRoot, "knowledge", snapshot.path), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; approvedVersions.delete(ref); }
  }
  for (const ref of staleApprovedKnowledgeRefs(snapshots, approvedVersions)) approvedVersions.delete(ref);
  const projections: Array<ReturnType<typeof projectIndexerApprovedKnowledge>> = [];
  for (const dependency of input.dependencies) {
    const snapshot = selected.get(dependency.artifact_ref);
    const allowedVersions = [];
    for (const source of snapshot?.source_versions ?? []) {
      if (!projectIndexerReadTargetAllows({ targets: input.authorized_targets, source_ref: source.source_ref, module_ref: source.module_ref })) continue;
      const bindings = input.bindings.filter(binding => binding.source_ref === source.source_ref && binding.module_ref === source.module_ref);
      const files = new Map<string, string>();
      for (const binding of bindings) for (const file of binding.source_identity_inventory.files) {
        const previous = files.get(file.normalized_path);
        if (previous !== undefined && previous !== file.content_digest) throw new TypeError("Current captures disagree on a supporting source version");
        files.set(file.normalized_path, file.content_digest);
      }
      const evidence = snapshot!.evidence_bindings.filter(binding => binding.source_ref === source.source_ref && binding.module_ref === source.module_ref);
      const available = evidence.every(binding => files.has(binding.locator.path));
      const version = available ? approvedKnowledgeSourceVersions(evidence.map(binding => ({ ...binding,
        content_digest: files.get(binding.locator.path)! })))[0]!.version : indexerProtocolDigest({ unavailable: source });
      allowedVersions.push({ ...source, version });
    }
    projections.push(projectIndexerApprovedKnowledge({ dependencies: [dependency], snapshots: snapshot ? [snapshot] : [],
      subject_key: input.subject_key, authorized_sources: allowedVersions, approved_versions: approvedVersions,
      evidence_kinds: input.evidence_kinds }));
  }
  const pending = projections.flatMap(projection => projection.pending);
  const versions = projections.flatMap(projection => projection.versions);
  const evidence = new Map<string, ReturnType<typeof projectIndexerApprovedKnowledge>["evidence_bindings"][number]>();
  for (const binding of projections.flatMap(projection => projection.evidence_bindings)) {
    const previous = evidence.get(binding.evidence_ref);
    if (previous && previous.binding_digest !== binding.binding_digest) throw new TypeError("Supporting articles disagree on their source evidence");
    evidence.set(binding.evidence_ref, binding);
  }
  return { status: pending.some(item => item.required) ? "waiting" as const : "ready" as const,
    pending, versions, dependency_fingerprint: indexerKnowledgeDependencyFingerprint(versions),
    facts: projections.flatMap(projection => projection.facts),
    reading_sections: projections.flatMap(projection => projection.reading_sections),
    evidence_bindings: [...evidence.values()] };
}

export async function assertApprovedKnowledgeInputCurrent(projectRoot: string, knowledge: Awaited<ReturnType<typeof readApprovedKnowledgeInput>>): Promise<void> {
  if (knowledge.status !== "ready") throw new TypeError("Required supporting knowledge is pending; finish the upstream articles or adjust the current Partition plan");
  const snapshots = new Map(approvedKnowledgeSnapshotsFromStructure((await readKnowledgeStructure(projectRoot)).parsed).map(snapshot => [snapshot.artifact_ref, snapshot]));
  for (const version of knowledge.versions) {
    const snapshot = snapshots.get(version.artifact_ref);
    let digest: string | undefined;
    if (snapshot) {
      try { digest = approvedKnowledgeContentDigest(await readFile(join(projectRoot, "knowledge", snapshot.path), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const sections = knowledge.reading_sections.filter(section => section.artifact_ref === version.artifact_ref).map(section => section.section_ref).sort();
    if (!snapshot || snapshot.approved_content_digest !== version.approved_content_digest || digest !== version.approved_content_digest ||
        indexerProtocolDigest({ snapshot: snapshot.snapshot_digest, sections }) !== version.projection_digest) {
      throw new TypeError(`Supporting article ${version.artifact_ref} changed or was removed; refresh the current Author plan before submitting`);
    }
  }
}

export function assertApprovedKnowledgeSourcesCurrent(knowledge: Awaited<ReturnType<typeof readApprovedKnowledgeInput>>,
  bindings: readonly Pick<ProjectIndexerMainSourceBinding, "source_ref" | "module_ref" | "source_identity_inventory">[]): void {
  for (const evidence of knowledge.evidence_bindings) {
    const files = bindings.filter(binding => binding.source_ref === evidence.source_ref && binding.module_ref === evidence.module_ref)
      .flatMap(binding => binding.source_identity_inventory.files).filter(file => file.normalized_path === evidence.locator.path);
    if (!files.length || files.some(file => file.content_digest !== evidence.content_digest)) {
      throw new TypeError(`Supporting source ${evidence.source_ref}/${evidence.locator.path} changed or is unavailable; refresh the current Author plan`);
    }
  }
}
