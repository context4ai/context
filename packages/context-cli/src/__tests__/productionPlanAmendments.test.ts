import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveProductionDependency } from "../project/productionDependencies.js";
import { previousProductionDrafts } from "../project/productionDraftMigration.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { productionTaskInput, validateProductionStage, type ProductionTask } from "../project/productionStage.js";
const baseline = `sha256:${"a".repeat(64)}`;
function task(id: string, status: ProductionTask["status"] = "pending") {
  const value = { id, article_id: "article:one", path: "architecture/one.md", question: "Explain",
    sources: [{ scope: "note:a", baseline }], base: baseline, batch: "one", after: [], status };
  return { ...value, input: productionTaskInput(value) };
}
function stage(tasks: ProductionTask[]) {
  return validateProductionStage({ id: "plan", purpose: "Explain", scopes: [{ scope: "note:a", baseline }], tasks, pending_scopes: [], report_approved: true });
}

test("dependency paths choose the current task and every branch rejects retired targets", () => {
  const old = task("old", "replaced");
  const current = task("current");
  const value = stage([old, current]);
  expect(resolveProductionDependency(current.path, new Map(), value, [])).toBe("current");
  expect(resolveProductionDependency(current.path, new Map([[current.path, "incoming"]]), value, ["current"])).toBe("incoming");
  expect(() => resolveProductionDependency("old", new Map(), value, [])).toThrow("replaced");
  expect(() => resolveProductionDependency("current", new Map(), value, ["current"])).toThrow("being replaced");
  expect(() => resolveProductionDependency(current.path, new Map(), stage([current, task("other")]), [])).toThrow("ambiguous");
});

test("replacing a task reports its non-empty draft without copying it", async () => {
  const root = await mkdtemp(join(tmpdir(), "previous-drafts-"));
  try {
    const next = task("next"); const value = stage([task("old", "replaced"), next]);
    const from = join(productionAgentDirectory(value.id), "batches/one/old");
    const to = join(productionAgentDirectory(value.id), "batches/one/next");
    await mkdir(join(root, from), { recursive: true });
    await writeFile(join(root, from, "edits.yaml"), "# Existing fragment IDs\nedits: []\n");
    expect(await previousProductionDrafts(root, value)).toEqual([]);
    await writeFile(join(root, from, "edits.yaml"), "edits:\n  - replace: [a]\n    with: [{ id: a, markdown: Revised }]\n");
    expect(await previousProductionDrafts(root, value)).toEqual([{ task: "next", from, to }]);
    expect(await previousProductionDrafts(root, stage([task("old"), next]))).toEqual([]);
    expect(existsSync(join(root, to, "edits.yaml"))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
