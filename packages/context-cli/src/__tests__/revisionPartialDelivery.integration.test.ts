import { expect, test } from "bun:test";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildFixturePackages } from "./workspaceVersionDelivery.fixture.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { prepareApprovedRevision, readApprovedRevision, completeApprovedRevision } from "../project/approvedRevision.js";
import { approvedContextSectionsInMarkdown } from "../project/verifyContextSections.js";
import { selectPartialDelivery, assertPartialDeliveryCurrent } from "../project/partialDelivery.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { runCurrentIndexerLifecycle } from "../project/indexerLifecycleRun.js";
import { collectProjectStatus } from "../project/status.js";
import { readRevisionDelivery } from "../project/revisionDelivery.js";

test("partial revision delivery reads the current revision, not retired compile and run ledgers", async () => {
  const root = await createDocumentRevisionWorkspace();
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entry = join(root, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "revision-delivery", template: { path: "src/package-templates/kb", vars: {} } })]'));
    await produceFixtureArticles(root, ["one", "two"].map(name => ({ path: `architecture/${name}.md`, question: `Explain ${name}`,
      sources: [DOCUMENT_REVISION_SOURCE_REF], markdown: `---\ntitle: ${name}\ndescription: Exported answer.\n---\n\n<!-- context:section id="usage" -->\nThe answer is 42.\n<!-- /context:section -->\n`,
      references: { sections: [{ id: "usage", references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF, locator: { path: "src/index.ts", start_line: 1, end_line: 1 } }] }] },
    })));
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    await buildFixturePackages(root);
    await prepareApprovedRevision({ projectRoot: root, selector: "architecture/one.md", instruction: "Clarify usage",
      pending_targets: [{ path: "architecture/two.md", instruction: "Clarify usage" }] });
    for (let index = 0; index < 2; index++) {
      const request = (await readApprovedRevision(root))!;
      const section = approvedContextSectionsInMarkdown(request.target.markdown)[0]!;
      await completeApprovedRevision({ projectRoot: root, revision: request.revision, sections: [{ section_id: section.id!,
        content: [{ markdown: `${section.readerVisibleBody}\nRead the exported constant directly.` }] }] });
    }
    const candidates = await readCandidateRecords(root);
    const ids = candidates.map(candidate => candidate.candidate_id).sort();
    const first = candidates.find(candidate => candidate.path === "architecture/one.md")!;
    await applyReviewDecisions({ projectRoot: root, payload: { scope: { kind: "all", count: ids.length,
      visible_candidate_ids: ids, ids_sha256: candidateIdsHash(ids), candidates_sha256: candidateSetHash(candidates) },
      decisions: [{ candidate_id: first.candidate_id, status: "approved" }] } });
    for (const name of ["candidate-compile", "main-index"]) {
      const directory = join(root, ".tmp/context-runtime/indexer", name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "current.json"), "invalid retired state");
    }
    const scope = (await selectPartialDelivery(root))!;
    expect(scope).toEqual({ kind: "revision", paths: ["knowledge/architecture/one.md"], refs: [first.article_id] });
    await assertPartialDeliveryCurrent(root, scope);
    await expect(assertPartialDeliveryCurrent(root, { ...scope, refs: ["foreign-article"] })).rejects.toThrow("outside");
    expect(await readCandidateRecords(root)).toHaveLength(1);
    const pending = await readCandidateRecords(root);
    const delivery = await runCurrentIndexerLifecycle({ projectRoot: root, managed: true, authorities: [], deliver: true });
    expect(delivery.workflow.current?.node).toBe("close-approved-knowledge");
    await closeProjectWorkspace(root);
    const checkpoint = await readRevisionDelivery(root);
    expect(checkpoint).toMatchObject({ partial: scope, closed: true });
    const template = join(root, "src/package-templates/kb");
    const backup = join(root, ".tmp/revision-template-backup");
    await rename(template, backup);
    try {
      await expect(buildFixturePackages(root)).rejects.toThrow();
      expect(await readRevisionDelivery(root)).toEqual(checkpoint);
      expect(await readCandidateRecords(root)).toEqual(pending);
    } finally { await rename(backup, template); }
    await buildFixturePackages(root);
    expect(await readRevisionDelivery(root)).toBeUndefined();
    expect(await readCandidateRecords(root)).toEqual(pending);
    expect((await collectProjectStatus(root)).workflow.current?.node).toBe("review-current-batch");
    await approveCandidates(root, pending);
    await closeProjectWorkspace(root);
    await buildFixturePackages(root);
    expect(await readApprovedRevision(root)).toBeUndefined();
    expect(await readCandidateRecords(root)).toEqual([]);
    for (const name of ["one", "two"]) {
      expect(await readFile(join(root, `knowledge/architecture/${name}.md`), "utf8")).toContain("Read the exported constant directly.");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
