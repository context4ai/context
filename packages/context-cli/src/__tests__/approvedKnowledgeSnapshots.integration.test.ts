import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { loadIndexerRegistry } from "@c4a/context";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { approvedKnowledgeContentDigest, approvedKnowledgeSnapshotsFromStructure } from "../project/approvedKnowledgeSnapshots.js";
import { readApprovedKnowledgeInput } from "../project/approvedKnowledgeInput.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { recoverDurableMultiFileTransactions } from "../project/durableMultiFileTransaction.js";
import { resolveApprovedKnowledgeSources } from "../project/approvedKnowledgeSources.js";
import { partitionApprovedArticleCatalog } from "../project/indexerPartitionNavigation.js";

test.each([false, true])("Review and close retain approved source evidence across cache cleanup (interrupted: %s)", async interrupted => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    await completePartitionStage(root);
    const structure = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "approved" });
    await completeAuthorStage(root, { includeFacts: true });
    const candidates = await readCandidateRecords(root);
    const readSnapshots = async () => approvedKnowledgeSnapshotsFromStructure(YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8")));
    if (interrupted) {
      const ids = candidates.map(candidate => candidate.candidate_id).sort();
      await expect(applyReviewDecisions({ projectRoot: root,
        payload: { scope: { kind: "all", count: ids.length, visible_candidate_ids: ids,
          ids_sha256: candidateIdsHash(ids), candidates_sha256: candidateSetHash(candidates) },
          decisions: candidates.map(candidate => ({ candidate_id: candidate.candidate_id, status: "approved" })) },
        inject_failure: point => { if (point === `after-target-rename:knowledge/${candidates[0]!.path}`) throw new Error("interrupted approval"); },
      })).rejects.toThrow("interrupted approval");
      await recoverDurableMultiFileTransactions(root);
      expect(await readCandidateRecords(root)).toEqual([]);
    } else await approveCandidates(root, candidates);
    const before = await readSnapshots();
    expect(before).toHaveLength(1);
    expect(before[0]!.facts.length).toBeGreaterThan(0);
    await closeProjectWorkspace(root);
    const after = await readSnapshots();
    expect(after).toEqual(before);
    const snapshot = after[0]!;
    const markdown = await readFile(join(root, "knowledge", snapshot.path), "utf8");
    expect(approvedKnowledgeContentDigest(markdown)).toBe(snapshot.approved_content_digest);
    // No temporary receipt or parser directory is needed to read approved facts.
    await rm(join(root, ".tmp/context-runtime/indexer"), { recursive: true, force: true });
    const authorizedTargets = snapshot.source_versions.map(source => ({ source_ref: source.source_ref, module_refs: source.module_ref ? [source.module_ref] : [] }));
    expect(partitionApprovedArticleCatalog([snapshot], [])).toEqual([]);
    expect(partitionApprovedArticleCatalog([snapshot], [{ source_ref: snapshot.source_versions[0]!.source_ref, module_refs: ["module:other"] }])).toEqual([]);
    const catalog = partitionApprovedArticleCatalog([snapshot], authorizedTargets);
    expect(catalog).toMatchObject([{ artifact_ref: snapshot.artifact_ref, path: snapshot.path,
      sections: snapshot.sections.map(section => ({ section_ref: section.section_ref })) }]);
    expect(JSON.stringify(catalog)).not.toContain('"facts"');
    expect(JSON.stringify(catalog)).not.toContain('"markdown"');
    const { registry } = await loadIndexerRegistry(root);
    const sourceInput = { projectRoot: root, registry, snapshots: [snapshot], current: [], authorized_targets: authorizedTargets };
    expect(await resolveApprovedKnowledgeSources({ ...sourceInput, authorized_targets: [] })).toEqual([]);
    const sources = await resolveApprovedKnowledgeSources(sourceInput);
    expect(sources.length).toBeGreaterThan(0);
    const bindings = sources.map(source => source.binding);
    const projectionInput = { projectRoot: root, dependencies: [{ artifact_ref: snapshot.artifact_ref, required: true, section_refs: [] }], bindings,
      authorized_targets: authorizedTargets,
      evidence_kinds: new Set(snapshot.evidence_bindings.map(binding => binding.kind)), subject_key: { ...snapshot.subject_key, local_key: "journey" } };
    const projected = await readApprovedKnowledgeInput(projectionInput);
    expect(projected.status).toBe("ready");
    expect(projected.facts.length).toBeGreaterThan(0);
    expect(projected.reading_sections.every(section => section.evidence_role === "approved-interpretation")).toBe(true);
    expect(markdown).not.toContain("approved-knowledge/v1");
    expect(await readApprovedKnowledgeInput({ ...projectionInput, bindings: [] })).toMatchObject({ status: "waiting", pending: [{ reason: "source-version-changed" }] });
    await expect(readApprovedKnowledgeInput({ ...projectionInput, authorized_targets: [] })).rejects.toThrow("read scope");
    await rm(join(root, "knowledge", snapshot.path));
    expect(await readApprovedKnowledgeInput(projectionInput)).toMatchObject({ status: "waiting", pending: [{ reason: "approval-changed" }] });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
