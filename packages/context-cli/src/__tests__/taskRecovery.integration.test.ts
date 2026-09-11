import { canonicalIndexerNodeRef, indexerArtifactRef } from "@c4a/context";
import type { MainRunSpec } from "../project/indexerMainRunStoreRecords.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completeAuthorStage, approveCandidates, completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { currentLedger, currentSpec, INDEXER_MAIN_RUN_CURRENT_PATH } from "../project/indexerMainRunStoreRecords.js";
import { inspectTaskRecovery, recoverTaskTransactions } from "../project/taskRecovery.js";
import { readRecoveryCheckpoint } from "../project/taskRecoveryCheckpoint.js";
import { recoverAuthorTask, recoveryWorksetClosure } from "../project/taskRecoveryAuthor.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";

async function plannedWorkspace() {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 2 });
  await completePartitionStage(root);
  const review = (await currentIndexerStructureReview(root))!;
  await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved" });
  return root;
}

test("recovery inspection tolerates corrupt state without evaluating the project or writing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "recovery-inspect-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/index.ts"), 'throw new Error("must not evaluate project")');
    await mkdir(join(root, INDEXER_MAIN_RUN_CURRENT_PATH, ".."), { recursive: true });
    await writeFile(join(root, INDEXER_MAIN_RUN_CURRENT_PATH), "bad json");
    const result = await inspectTaskRecovery(root);
    expect(result.findings.some(finding => finding.area === "task-ledger")).toBe(true);
    expect(result.action).toBe("recovery-inspected");
    expect(result.transactions).toEqual([]);
    expect(await readFile(join(root, INDEXER_MAIN_RUN_CURRENT_PATH), "utf8")).toBe("bad json");
    expect("skill" in result.resources).toBe(true);
    if ("skill" in result.resources) {
      expect(await readFile(result.resources.skill!, "utf8")).toContain("task-recovery.md");
      expect(await readFile(result.resources.issue_template!, "utf8")).toContain("Privacy review");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("accepted-plan recovery preserves menu, creates fresh requests, rejects stale apply and changed baselines", async () => {
  const root = await plannedWorkspace();
  try {
    const checkpoint = (await readRecoveryCheckpoint(root))!;
    expect(checkpoint.entries.length).toBeGreaterThan(0);
    const ledger = (await currentLedger(root))!;
    const selected = ledger.entries[0]!;
    const menu = await readFile(join(root, "src/knowledge-map.yaml"), "utf8");
    const input = { projectRoot: root, operation: "plan" as const,
      worksets: [selected.workset_digest], instruction: "Return to the accepted article responsibilities and correct the draft." };
    const preview = await recoverAuthorTask(input);
    expect(preview.action).toBe("preview");
    expect((await currentLedger(root))!.ledger_digest).toBe(ledger.ledger_digest);
    await expect(recoverAuthorTask({ ...input, apply: true, plan_digest: `sha256:${"0".repeat(64)}` })).rejects.toThrow("stale");
    await recoverAuthorTask({ ...input, apply: true, plan_digest: preview.revision });
    const next = (await currentLedger(root))!;
    const oldSpec = await currentSpec({ projectRoot: root, request_digest: selected.execution_request_digest });
    const replacement = next.entries.find(entry => entry.group_key === selected.group_key)!;
    expect(replacement.execution_request_digest).not.toBe(selected.execution_request_digest);
    const nextSpec = await currentSpec({ projectRoot: root, request_digest: replacement.execution_request_digest });
    expect(nextSpec.validation).toEqual(oldSpec.validation);
    for (const entry of ledger.entries.filter(entry => entry.workset_digest !== selected.workset_digest)) {
      expect(next.entries.find(item => item.workset_digest === entry.workset_digest)).toEqual(entry);
    }
    expect(await readFile(join(root, "src/knowledge-map.yaml"), "utf8")).toBe(menu);
    expect((await resolveCurrentIndexerAgentContext(root))?.descriptor.tasks.length).toBeGreaterThan(0);
    await expect(recoverAuthorTask({ ...input, apply: true, plan_digest: preview.revision })).rejects.toThrow();
    await writeFile(join(root, "src/indexers.yaml"), "changed: true");
    await expect(recoverAuthorTask({ ...input, worksets: [replacement.workset_digest] })).rejects.toThrow("baseline changed");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);

test("interrupted repair is recoverable independently of the normal Route", async () => {
  const root = await plannedWorkspace();
  try {
    const ledger = (await currentLedger(root))!;
    const input = { projectRoot: root, operation: "author" as const, worksets: [ledger.entries[0]!.workset_digest], instruction: "Correct the current draft against its existing evidence." };
    const preview = await recoverAuthorTask(input);
    await expect(recoverAuthorTask({ ...input, apply: true, plan_digest: preview.revision,
      inject_failure(point) { if (point.startsWith("after-target-rename:")) throw new Error("interrupted recovery"); },
    })).rejects.toThrow("interrupted recovery");
    const diagnostic = await inspectTaskRecovery(root);
    expect(diagnostic.transactions!.length).toBeGreaterThan(0);
    const recovery = await recoverTaskTransactions({ projectRoot: root });
    await expect(recoverTaskTransactions({ projectRoot: root, apply: true, plan_digest: "wrong" })).rejects.toThrow("inventory changed");
    if ("revision" in recovery) await recoverTaskTransactions({ projectRoot: root, apply: true, plan_digest: recovery.revision });
    expect((await inspectTaskRecovery(root)).transactions).toEqual([]);
    expect((await resolveCurrentIndexerAgentContext(root))?.descriptor.tasks.length).toBeGreaterThan(0);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);


test("candidate recovery preserves approved bytes and refuses to retract a published page before close", async () => {
  const root = await plannedWorkspace();
  try {
    await completeAuthorStage(root, { markdown: "A sourced draft used for recovery testing." });
    const candidates = await readCandidateRecords(root);
    expect(candidates.length).toBeGreaterThan(0);
    const ledger = (await currentLedger(root))!;
    const input = { projectRoot: root, operation: "author" as const, worksets: [ledger.entries[0]!.workset_digest], instruction: "Clarify the existing source entry." };
    const preview = await recoverAuthorTask(input);
    expect(preview.discarded_candidates.length).toBeGreaterThan(0);
    await recoverAuthorTask({ ...input, apply: true, plan_digest: preview.revision });
    expect((await readCandidateRecords(root)).some(candidate => preview.discarded_candidates.includes(candidate.candidate_id))).toBe(false);
    await completeAuthorStage(root, { markdown: "The corrected sourced draft." });
    const revised = await readCandidateRecords(root);
    expect(revised.length).toBeGreaterThan(0);
    await approveCandidates(root, revised);
    const path = join(root, "knowledge", revised[0]!.path);
    const approved = await readFile(path, "utf8");
    await expect(recoverAuthorTask({ ...input, worksets: [(await currentLedger(root))!.entries[0]!.workset_digest] })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(approved);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);


test("recovery expands explicit transitive article consumers and leaves independent work outside its scope", () => {
  const subject = (name: string) => ({ protocol: "context.subject-key/v1", namespace: "sample", kind: "module", local_key: name });
  const ref = (name: string) => indexerArtifactRef(canonicalIndexerNodeRef(subject(name)), { artifact_id: "overview", artifact_kind: "content" });
  const spec = (name: string, dependencies: string[]): MainRunSpec => ({
    request: { workset: { workset_digest: name } },
    validation: { expected_subject_key: subject(name), page_plan: { articles: [{ key: "overview", title: name,
      reader_task: "Understand this module", artifact_intent: "source/guide/understand/content", required: true,
      sections: [{ key: "entry", heading: "Entry", required: true }],
      knowledge_dependencies: dependencies.map(name => ({ artifact_ref: ref(name), required: true, section_refs: [] })),
    }] } },
  } as unknown as MainRunSpec);
  const selected = new Set(["a"]);
  const closure = recoveryWorksetClosure([spec("c", ["b"]), spec("b", ["a"]), spec("a", []), spec("independent", [])], selected);
  expect([...closure].sort()).toEqual(["a", "b", "c"]);
  expect([...selected]).toEqual(["a"]);
});
