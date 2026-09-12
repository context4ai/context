import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { approvedKnowledgeSnapshotsFromStructure } from "../project/approvedKnowledgeSnapshots.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { recoverDurableMultiFileTransactions } from "../project/durableMultiFileTransaction.js";
import { partitionApprovedArticleCatalog } from "../project/indexerPartitionNavigation.js";
import { approvedKnowledgeDependencyWarnings } from "../project/approvedKnowledgeDependencyWarnings.js";

test.each([false, true])("Review and close retain approved source evidence across cache cleanup (interrupted: %s)", async interrupted => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    await completePartitionStage(root);
    const structure = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "approved" });
    await completeAuthorStage(root);
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
    expect(before[0]!.sections.flatMap(section => section.references).length).toBeGreaterThan(0);
    expect(before[0]).not.toHaveProperty("facts");
    expect(before[0]).not.toHaveProperty("evidence_bindings");
    await closeProjectWorkspace(root);
    const after = await readSnapshots();
    expect(after).toEqual(before);
    const snapshot = after[0]!;
    const markdown = await readFile(join(root, "knowledge", snapshot.path), "utf8");
    expect(markdown).not.toContain("evidence_ref");
    expect(markdown).not.toContain("article_id:");
    expect(markdown).toContain('<!-- context:section id="');
    // The committed article index remains sufficient after temporary Parser
    // receipts are gone. Region baselines are only needed for later relocation.
    await rm(join(root, ".tmp/context-runtime/indexer"), { recursive: true, force: true });
    const references = snapshot.sections.flatMap(section => section.references);
    const authorizedTargets = [...new Set(references.map(reference => reference.source_ref))]
      .map(source_ref => ({ source_ref, module_refs: [] }));
    expect(partitionApprovedArticleCatalog([snapshot], [])).toEqual([]);
    const catalog = partitionApprovedArticleCatalog([snapshot], authorizedTargets);
    expect(catalog).toMatchObject([{ article_id: snapshot.article_id, path: snapshot.path,
      sections: snapshot.sections.map(section => ({ id: section.id })) }]);
    expect(JSON.stringify(catalog)).not.toContain('"facts"');
    expect(JSON.stringify(catalog)).not.toContain('"markdown"');
    expect(await approvedKnowledgeDependencyWarnings(root)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
