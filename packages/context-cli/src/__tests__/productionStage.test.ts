import { describe, expect, test } from "bun:test";
import { dispatchProductionStage, productionCapabilitiesSchema, productionTaskInput,
  reviseProductionPlan, validateProductionStage, type ProductionStage, type ProductionTask } from "../project/productionStage.js";

const baseline = `sha256:${"a".repeat(64)}`;
function task(id: string, overrides: Partial<ProductionTask> = {}): ProductionTask {
  const value: Omit<ProductionTask, "input"> = { id, article_id: `article:${id}`,
    path: `architecture/${id}.md`, question: `Explain ${id}`, sources: [{ scope: "document:a", baseline }],
    base: null, batch: id, after: [], status: "pending", ...overrides };
  return { ...value, input: productionTaskInput(value) };
}
function stage(tasks: ProductionTask[]): ProductionStage {
  return validateProductionStage({ id: "writing-01", purpose: "Explain the product",
    scopes: ["document:a", "document:b", "module:service"].map(scope => ({ scope, baseline })),
    pending_scopes: [], tasks, indexer_usage: [], report_approved: true, gaps: [] });
}
const single = productionCapabilitiesSchema.parse({});
const multiple = productionCapabilitiesSchema.parse({ multi_agent: true });

describe("stage-owned production scheduling", () => {
  test("does not dispatch writing before report feedback, even with multiple workers", () => {
    const value = { ...stage([task("a")]), report_approved: false };
    expect(dispatchProductionStage(value, multiple)).toEqual({ mode: "single-agent", batches: [], state: "waiting-user" });
  });

  test("defaults to one batch, allows mixed sources and multiple Indexers", () => {
    const mixed = task("mixed", { sources: [{ scope: "document:a", baseline }, { scope: "module:service", baseline }] });
    const value = stage([mixed, task("second")]);
    value.indexer_usage = [{ scopes: ["module:service"], skills: ["code", "framework"], purpose: "Identify entry points" }];
    expect(dispatchProductionStage(value, single).batches).toEqual([{ id: "mixed", tasks: ["mixed"] }]);
    expect(dispatchProductionStage(value, multiple).batches).toHaveLength(2);
    expect(productionTaskInput(mixed)).toBe(mixed.input);
  });

  test("only issues dependent work after its actual prerequisite is accepted", () => {
    const first = task("first");
    const next = task("next", { after: ["first"] });
    const value = stage([first, next]);
    expect(dispatchProductionStage(value, multiple).batches.map(batch => batch.id)).toEqual(["first"]);
    first.status = "accepted";
    expect(dispatchProductionStage(stage([first, next]), multiple).batches.map(batch => batch.id)).toEqual(["next"]);
    expect(next.input).toBe(productionTaskInput(next));
  });

  test("downgrades without revoking issued tasks or rewriting their input handles", () => {
    const value = stage([task("new"), task("issued", { status: "issued" }), task("other", { status: "issued" })]);
    const before = JSON.stringify(value);
    expect(dispatchProductionStage(value, single).batches).toEqual([{ id: "issued", tasks: ["issued"] }]);
    expect(JSON.stringify(value)).toBe(before);
  });

  test("prevents concurrent article/path conflicts independently of batching", () => {
    const value = stage([task("a"), task("b", { path: "architecture/a.md" }), task("c", { article_id: "article:a" })]);
    expect(dispatchProductionStage(value, multiple).batches).toEqual([{ id: "a", tasks: ["a"] }]);
  });

  test.each([
    ["architecture/Entry.md", "architecture/entry.md"],
    ["architecture/café.md", "architecture/CAFE\u0301.md"],
  ])("does not dispatch portable path aliases concurrently: %s / %s", (first, second) => {
    const value = stage([task("a", { path: first }), task("b", { path: second })]);
    expect(dispatchProductionStage(value, multiple).batches).toEqual([{ id: "a", tasks: ["a"] }]);
  });

  test("does not report uninvestigated scope or unresolved gaps as complete", () => {
    const done = stage([task("a", { status: "accepted" })]);
    expect(dispatchProductionStage(done, single).state).toBe("ended");
    expect(dispatchProductionStage({ ...done, pending_scopes: ["document:b"] }, single).state).toBe("active");
    expect(dispatchProductionStage({ ...done, gaps: [{ scope: "document:b", reason: "Unavailable" }] }, single).state).toBe("blocked");
    const changed = stage([task("a")]);
    changed.scopes[0]!.baseline = `sha256:${"b".repeat(64)}`;
    expect(dispatchProductionStage(changed, single).batches).toHaveLength(0);
  });

  test("atomically replaces unfinished plans and preserves accepted siblings", () => {
    const value = stage([task("a"), task("b"), task("saved", { status: "accepted" })]);
    const updated = reviseProductionPlan({ stage: value, replaces: ["a", "b"], tasks: [task("merged")] });
    expect(updated.tasks.map(item => item.status)).toEqual(["replaced", "replaced", "accepted", "pending"]);
    expect(value.tasks[0]!.status).toBe("pending");
    expect(() => reviseProductionPlan({ stage: value, replaces: ["saved"], tasks: [task("new")] })).toThrow("explicit revision");
  });

  test("unknown source versions remain explicit gaps and cannot authorize tasks", () => {
    const value = stage([task("ready"), task("unavailable", { sources: [{ scope: "document:b", baseline }] })]);
    value.scopes.find(source => source.scope === "document:b")!.baseline = null;
    expect(() => validateProductionStage(value)).toThrow("explicit gap");
    value.pending_scopes = ["document:b"];
    value.gaps = [{ scope: "document:b", reason: "No captured material" }];
    expect(dispatchProductionStage(validateProductionStage(value), multiple).batches).toEqual([{ id: "ready", tasks: ["ready"] }]);
    expect(() => validateProductionStage({ ...value, tasks: [{ ...value.tasks[1]!,
      sources: [{ scope: "document:b", baseline: null }] }] })).toThrow();
    // Even a previously observed version cannot override a current material gap.
    value.scopes.find(source => source.scope === "document:b")!.baseline = baseline;
    expect(dispatchProductionStage(value, multiple).batches).toEqual([{ id: "ready", tasks: ["ready"] }]);
  });

  test("rejects missing/cyclic dependencies, stale new plans and unauthorized scopes", () => {
    expect(() => stage([task("a", { after: ["missing"] })])).toThrow("Unknown dependency");
    expect(() => stage([task("a", { after: ["b"] }), task("b", { after: ["a"] })])).toThrow("cycle");
    expect(() => stage([task("a", { sources: [{ scope: "private:other", baseline }] })])).toThrow("authorized");
    expect(() => reviseProductionPlan({ stage: stage([]), tasks: [task("a", {
      sources: [{ scope: "document:a", baseline: `sha256:${"b".repeat(64)}` }],
    })] })).toThrow("baseline");
  });

  test("does not accept version credentials in capability declarations", () => {
    expect(() => productionCapabilitiesSchema.parse({ skills: [{ name: "code", hash: baseline }] })).toThrow();
    expect(() => productionCapabilitiesSchema.parse({ skills: [{ name: "code", version: "1.0" }] })).toThrow();
  });
});
