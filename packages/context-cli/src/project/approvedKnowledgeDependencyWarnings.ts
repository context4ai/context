import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { impactedIndexerKnowledgeArticles, indexerProtocolDigest, type IndexerApprovedKnowledge } from "@c4a/context";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { approvedKnowledgeContentDigest, approvedKnowledgeSnapshotsFromStructure } from "./approvedKnowledgeSnapshots.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";

export function staleApprovedKnowledgeRefs(snapshots: readonly IndexerApprovedKnowledge[], current: ReadonlyMap<string, string>) {
  const byRef = new Map(snapshots.map(snapshot => [snapshot.artifact_ref, snapshot]));
  const changed = new Set<string>();
  for (const snapshot of snapshots.filter(snapshot => snapshot.dependencies.length)) {
    if (current.get(snapshot.artifact_ref) !== snapshot.approved_content_digest) changed.add(snapshot.artifact_ref);
    for (const dependency of snapshot.dependencies) {
      const version = snapshot.dependency_versions?.find(version => version.artifact_ref === dependency.artifact_ref);
      if (!dependency.required && !version) continue;
      const parent = byRef.get(dependency.artifact_ref);
      const sections = parent && (dependency.section_refs.length ? dependency.section_refs : parent.sections.map(section => section.section_ref));
      if (!version || !parent || current.get(parent.artifact_ref) !== version.approved_content_digest ||
          parent.approved_content_digest !== version.approved_content_digest ||
          indexerProtocolDigest({ snapshot: parent.snapshot_digest, sections: [...sections!].sort() }) !== version.projection_digest) changed.add(snapshot.artifact_ref);
    }
  }
  return new Set([...changed, ...impactedIndexerKnowledgeArticles(snapshots.map(snapshot => ({
    artifact_ref: snapshot.artifact_ref, dependencies: snapshot.dependencies,
  })), changed)]);
}

/** Structural version diagnostics, not a content-quality gate. Existing
 * approved pages remain readable while the Agent follows the revision flow. */
export async function approvedKnowledgeDependencyWarnings(projectRoot: string, structureOverride?: Record<string, unknown>): Promise<ProjectVerifyIssue[]> {
  const snapshots = approvedKnowledgeSnapshotsFromStructure(structureOverride ?? (await readKnowledgeStructure(projectRoot)).parsed);
  const readers = snapshots.filter(snapshot => snapshot.dependencies.length);
  if (!readers.length) return [];
  const byRef = new Map(snapshots.map(snapshot => [snapshot.artifact_ref, snapshot]));
  const needed = new Set(readers.flatMap(snapshot => [snapshot.artifact_ref, ...snapshot.dependencies.map(dependency => dependency.artifact_ref)]));
  const current = new Map<string, string>();
  for (const ref of needed) {
    const snapshot = byRef.get(ref);
    if (!snapshot) continue;
    try { current.set(ref, approvedKnowledgeContentDigest(await readFile(join(projectRoot, "knowledge", snapshot.path), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const stale = staleApprovedKnowledgeRefs(snapshots, current);
  return snapshots.filter(snapshot => stale.has(snapshot.artifact_ref)).map(snapshot => ({ severity: "warning", code: "approved-knowledge-dependency-stale",
    path: snapshot.path, message: "This article's approved supporting version changed or disappeared. Treat its synthesis as needing review. Use context revise for this path to inspect current supporting knowledge, then complete Review, close and build. If support is missing, update or restore the upstream entry first; unchanged approved pages remain available." }));
}
