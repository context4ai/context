import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
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
    await produceFixtureArticles(root, [{
      path: "architecture/answer.md", question: "What does the public entry export?",
      sources: [DOCUMENT_REVISION_SOURCE_REF],
      markdown: '---\ntitle: Exported answer\ndescription: Public entry contract.\n---\n\n<!-- context:section id="answer" -->\nThe entry exports answer with value 42.\n<!-- /context:section -->\n',
      references: { sections: [{ id: "answer", references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF,
        locator: { path: "src/index.ts", start_line: 1, end_line: 1 } }] }] },
    }]);
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
    // Formal references remain sufficient without any prior production state.
    await rm(join(root, ".tmp"), { recursive: true, force: true });
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
