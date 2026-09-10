import { afterEach, expect, test } from "bun:test";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { currentLedger, currentSpec } from "../project/indexerMainRunStoreRecords.js";
import { collectProjectStatus } from "../project/status.js";
import { approvedContextSectionsInMarkdown } from "../project/verifyContextSections.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function partlyOmittedBatch() {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"),
    join(root, "src/package-templates/kb"), { recursive: true });
  const entry = join(root, "src/index.ts");
  await writeFile(entry, (await readFile(entry, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
    .replace("packages: []", 'packages: [kbPackage({ name: "repair-kb", template: { path: "src/package-templates/kb" } })]'));
  await acceptStarterPackageTemplates({ projectRoot: root });
  await completePartitionStage(root);
  const structure = (await currentIndexerStructureReview(root))!;
  await completeCurrentIndexerAction({ cwd: root, revision: structure.revision, managed: true,
    value: { stage: "structure-review", decision: "approved" } });
  await completeAuthorStage(root);
  const initial = await readCandidateRecords(root);
  const omitted = initial[0]!;
  const approvedPath = initial[1]!.path;
  const href = posix.relative(posix.dirname(approvedPath), omitted.path);
  await beginDocumentRevision({ projectRoot: root, selector: approvedPath, instruction: "Include the related page link." });
  await completeAuthorStage(root, { relatedPage: href });
  const candidates = await readCandidateRecords(root);
  const approved = candidates.find((item) => item.path === approvedPath)!;
  expect(approved.body).toContain(`[Related API](${href})`);
  await applyReviewDecisions({ projectRoot: root, payload: { collection: approved.collection,
    scope: { kind: "collection", collection: approved.collection, count: candidates.length,
      ids_sha256: candidateIdsHash(candidates.map((item) => item.candidate_id).sort()), candidates_sha256: candidateSetHash(candidates) },
    decisions: candidates.map((item) => ({ candidate_id: item.candidate_id,
      status: item.path === approvedPath ? "approved" : "rejected" })) } });
  return { root, approved, omitted };
}

test("an approved page linking an omitted peer can reenter its existing Author and finish", async () => {
  const { root, approved, omitted } = await partlyOmittedBatch();
  await closeProjectWorkspace(root);
  const before = await readFile(join(root, "knowledge", approved.path), "utf8");
  const ledger = (await currentLedger(root))!;
  const revision = await beginDocumentRevision({ projectRoot: root, selector: approved.path,
    instruction: "The related page was omitted. Keep this page self-contained and remove that navigation link." });
  expect(revision.status).toBe("author-reopened");
  const next = (await currentLedger(root))!;
  expect(next.entries.filter((entry) => entry.state === "accepted")).toHaveLength(ledger.entries.length - 1);
  const running = next.entries.find((entry) => entry.state === "running")!;
  const spec = await currentSpec({ projectRoot: root, request_digest: running.execution_request_digest });
  const sections = (markdown: string) => approvedContextSectionsInMarkdown(markdown).map(({ id, kind, refs, readerVisibleBody }) =>
    ({ id, kind, refs, readerVisibleBody }));
  expect(sections(spec.request.workset.repair_intent!.current_markdown!)).toEqual(sections(before));
  expect(await readFile(join(root, "knowledge", approved.path), "utf8")).toBe(before);
  await completeAuthorStage(root);
  const candidates = await readCandidateRecords(root);
  expect(candidates.find((item) => item.path === omitted.path)?.status).toBe("rejected");
  const repaired = candidates.find((item) => item.path === approved.path)!;
  expect(repaired.node_ref).toBe(approved.node_ref);
  expect(repaired.view_ref).toBe(approved.view_ref);
  await approveCandidates(root, [repaired]);
  await closeProjectWorkspace(root); await buildProjectPackages(root);
  expect((await collectProjectStatus(root, { managed: true })).workflow.status).toBe("complete");
  expect(await currentLedger(root)).toBeUndefined();
}, 45_000);

test("an externally changed approved batch page is not mistaken for its compiled result", async () => {
  const { root, approved } = await partlyOmittedBatch();
  const path = join(root, "knowledge", approved.path);
  const changed = (await readFile(path, "utf8")).replaceAll("public entry point", "a separately edited public entry point");
  await writeFile(path, changed);
  const ledger = await currentLedger(root);
  await expect(beginDocumentRevision({ projectRoot: root, selector: approved.path, instruction: "Remove the invalid navigation." })).rejects.toThrow("unfinished Indexer lifecycle");
  expect(await currentLedger(root)).toEqual(ledger);
  expect(await readFile(path, "utf8")).toBe(changed);
}, 45_000);
