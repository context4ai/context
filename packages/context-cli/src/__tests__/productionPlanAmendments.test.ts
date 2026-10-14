import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inheritedProductionSources, resolveProductionDependency } from "../project/productionDependencies.js";
import { migrateProductionDrafts } from "../project/productionDraftMigration.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { productionTaskInput, validateProductionStage, type ProductionTask } from "../project/productionStage.js";
import { retainProductionRepairDraft } from "../project/productionRepairDraft.js";
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

test("revised articles inherit only authorized and available cited sources", async () => {
  const refs = [{ source_ref: "note:a" }, { source_ref: "note:b" }, { source_ref: "note:b" }, { source_ref: "note:c" }, { source_ref: "note:x" }];
  const inherited = await inheritedProductionSources(["note:a"], refs, ["note:a", "note:b", "note:c"], async scope => scope !== "note:c");
  expect(inherited).toEqual(["note:a", "note:b"]);
});

test("draft migration preserves existing work and refuses a changed or repair editing base", async () => {
  const root = await mkdtemp(join(tmpdir(), "draft-migration-"));
  try {
    const old = task("old"); const next = task("next"); const value = stage([old]);
    const from = join(productionAgentDirectory(value.id), "batches/one/old");
    await mkdir(join(root, from), { recursive: true });
    await writeFile(join(root, from, "edits.yaml"), "# Existing fragment IDs\nedits: []\n");
    expect(await migrateProductionDrafts(root, value, [next], [old.id])).toEqual([]);
    const work = "edits:\n  - replace: [a]\n    with: [{ id: a, markdown: Revised }]\n";
    await writeFile(join(root, from, "edits.yaml"), work);
    const target = join(productionAgentDirectory(value.id), "batches/one/next");
    await mkdir(join(root, target), { recursive: true });
    await writeFile(join(root, target, "edits.yaml"), "edits: []\n");
    const result = await migrateProductionDrafts(root, value, [next], [old.id]);
    expect(result[0]!.outcome).toBe("copied");
    expect(await readFile(join(root, target, "edits.yaml"), "utf8")).toBe(work);
    await writeFile(join(root, result[0]!.to, "edits.yaml"), "Agent work\n");
    expect((await migrateProductionDrafts(root, value, [next], [old.id]))[0]!.outcome).toBe("kept");
    expect(await readFile(join(root, result[0]!.to, "edits.yaml"), "utf8")).toBe("Agent work\n");
    expect((await migrateProductionDrafts(root, value, [{ ...task("changed"), base: null }], [old.id]))[0]!.outcome).toBe("rebase-required");
    const fixed = (text: string) => ({ path: "draft", text, digest: baseline, bytes: text.length });
    await retainProductionRepairDraft({ projectRoot: root, stage: value.id, task: old,
      files: { task: old.id, input: old.input, content: fixed("Different failed draft"), references: fixed("sections: []") } });
    expect((await migrateProductionDrafts(root, value, [task("repair")], [old.id]))[0]!.outcome).toBe("rebase-required");
  } finally { await rm(root, { recursive: true, force: true }); }
});
