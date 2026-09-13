import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inspectTaskRecovery, recoverTaskTransactions } from "../project/taskRecovery.js";
import { runDurableMultiFileTransaction } from "../project/durableMultiFileTransaction.js";
import { durableContentDigest } from "../project/durableSingleFileTransaction.js";
import { PRODUCTION_STAGES_ROOT, readProductionStage } from "../project/productionStageStore.js";
import { prepareRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";

async function fixture() {
  const parent = resolve(".tmp/task-recovery-tests");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, "case-"));
}

test("recovery inspection tolerates corrupt current stage without evaluating project code or writing files", async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/index.ts"), 'throw new Error("must not evaluate project")');
    await mkdir(join(root, PRODUCTION_STAGES_ROOT), { recursive: true });
    const current = join(root, PRODUCTION_STAGES_ROOT, "current.json");
    await writeFile(current, "bad json");
    const result = await inspectTaskRecovery(root);
    expect(result.findings.some(finding => finding.area === "production-stage")).toBe(true);
    expect(result.tasks).toEqual([]);
    expect(result.transactions).toEqual([]);
    expect(await readFile(current, "utf8")).toBe("bad json");
    if ("skill" in result.resources) {
      expect(await readFile(result.resources.skill!, "utf8")).toContain("task-recovery.md");
      expect(await readFile(result.resources.issue_template!, "utf8")).toContain("Privacy review");
    } else throw new Error("Missing packaged recovery resources");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("interrupted current transaction can be inspected and completed without evaluating the ordinary route", async () => {
  const root = await fixture();
  try {
    const paths = [".tmp/accepted/article.md", ".tmp/accepted/receipt.json"];
    const contents = ["Fixed accepted draft", '{"accepted":true}'];
    await expect(runDurableMultiFileTransaction({ projectRoot: root, kind: "production-recovery-test",
      proposal_digest: durableContentDigest("current transaction"),
      targets: paths.map((path, index) => ({ path, operation: "write" as const, base_digest: null,
        target_digest: durableContentDigest(contents[index]!), content: contents[index]! })),
      inject_failure: point => { if (point.startsWith("after-target-rename:")) throw new Error("interrupted acceptance"); },
    })).rejects.toThrow("interrupted acceptance");
    expect((await inspectTaskRecovery(root)).transactions!.length).toBeGreaterThan(0);
    const preview = await recoverTaskTransactions({ projectRoot: root });
    expect(preview.action).toBe("preview");
    expect("affected_files" in preview && preview.affected_files.map(file => file.path).sort()).toEqual([...paths].sort());
    await expect(recoverTaskTransactions({ projectRoot: root, apply: true, plan_digest: "stale" })).rejects.toThrow("inventory changed");
    if (!("revision" in preview)) throw new Error("Missing recovery preview");
    await recoverTaskTransactions({ projectRoot: root, apply: true, plan_digest: preview.revision });
    expect((await inspectTaskRecovery(root)).transactions).toEqual([]);
    for (const [index, path] of paths.entries()) expect(await readFile(join(root, path), "utf8")).toBe(contents[index]!);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recovery reports current article tasks without restoring an old plan or mutating accepted drafts", async () => {
  const roots: string[] = [];
  try {
    const root = await prepareRevisionKnowledge(roots);
    const stage = (await readProductionStage(root))!;
    const candidates = await readCandidateRecords(root);
    await writeFile(join(root, "src/index.ts"), 'throw new Error("inspection must not run project code");');
    const result = await inspectTaskRecovery(root);
    expect(result.stage).toBe(stage.id);
    expect(result.tasks).toEqual(stage.tasks.map(task => ({ task: task.id, path: task.path, state: task.status })));
    expect(result).not.toHaveProperty("checkpoint");
    expect(result.actions.map(action => action.operation)).not.toContain("author");
    expect(result.actions.map(action => action.operation)).not.toContain("plan");
    expect(await readProductionStage(root)).toEqual(stage);
    expect(await readCandidateRecords(root)).toEqual(candidates);
    await rm(join(root, ".tmp"), { recursive: true, force: true });
    expect((await inspectTaskRecovery(root)).tasks).toEqual([]);
  } finally { for (const root of roots) await rm(root, { recursive: true, force: true }); }
});
