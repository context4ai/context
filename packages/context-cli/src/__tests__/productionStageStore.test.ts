import { afterEach, expect, spyOn, test } from "bun:test";
import * as filesystem from "node:fs/promises";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { materializeProductionStage, prepareNextProductionStage, productionStageDirectory, readProductionStage, saveProductionStage } from "../project/productionStageStore.js";
import { productionCapabilitiesSchema, productionTaskInput, validateProductionStage } from "../project/productionStage.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { productionWorkflowRoute } from "../project/productionWorkflowRoute.js";
import { approveProductionReport, productionReportRevision } from "../project/productionReport.js";
import YAML from "yaml";
import { productionSourceBaseline } from "../project/productionSubmission.js";

const roots: string[] = [];
const baseline = `sha256:${"a".repeat(64)}`;
async function fixture() {
  const parent = resolve(".tmp", "production-stage-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-"));
  roots.push(root);
  const sources = [{ scope: "file:a", baseline }, { scope: "repo:b", baseline }];
  const tasks = ["first", "second"].map(id => {
    const task = { id, article_id: `article:${id}`, path: `architecture/${id}.md`, question: `Explain ${id}`,
      sources, base: null, batch: id, after: [], status: "pending" as const };
    return { ...task, input: productionTaskInput(task) };
  });
  const stage = validateProductionStage({ id: "writing-01", purpose: "Explain the system", scopes: sources,
    tasks, pending_scopes: [], report_approved: true });
  const requirements = YAML.stringify({ requirements: [{ id: "system", purpose: stage.purpose,
    target_scope: { targets: sources.map(source => ({ source_ref: source.scope })) } }] });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/indexers.yaml"), requirements);
  await mkdir(join(root, productionStageDirectory(stage.id), "shared"), { recursive: true });
  await writeFile(join(root, productionStageDirectory(stage.id), "shared/requirements.md"), requirements);
  const materials = { requirements, sources: new Map([
    ["file:a", "# Document A\nAuthorized snapshot: sources/file/a/content.md\n"],
    ["repo:b", "# Module B\nAuthorized snapshot: sources/repo/b\n"],
  ]) };
  return { root, stage, materials };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test("corrupt temporary state identifies its actual file without rewriting or discarding local work", async () => {
  const f = await fixture();
  await saveProductionStage(f.root, f.stage);
  const path = join(productionStageDirectory(f.stage.id), "manifest.json");
  const original = await readFile(join(f.root, path), "utf8");
  await writeFile(join(f.root, path), "{broken");
  await expect(readProductionStage(f.root)).rejects.toMatchObject({ detail: { reason_code: "production-stage-read-failed", file: path,
    next_action: { command: "context status --format json", instruction: expect.any(String) } } });
  expect(await readFile(join(f.root, path), "utf8")).toBe("{broken");
  await writeFile(join(f.root, path), original);
  expect(await readProductionStage(f.root)).toEqual(f.stage);
  const pointer = ".tmp/context-runtime/production-stages/current.json";
  await writeFile(join(f.root, pointer), "{broken");
  await expect(readProductionStage(f.root)).rejects.toMatchObject({ detail: { file: pointer } });
  expect(await readFile(join(f.root, path), "utf8")).toBe(original);
});

test("ordinary continuation does not read unrelated historical article bodies", async () => {
  const f = await fixture();
  await materializeProductionStage({ projectRoot: f.root, stage: f.stage,
    capabilities: productionCapabilitiesSchema.parse({}), materials: f.materials });
  const history = join(f.root, "knowledge/architecture");
  await mkdir(history, { recursive: true });
  const articles = [];
  for (let index = 0; index < 80; index++) {
    const path = `architecture/history-${index}.md`;
    await writeFile(join(f.root, "knowledge", path), `---\ntitle: History ${index}\ndescription: Historical material\n---\n${"Old prose.\n".repeat(2000)}`);
    articles.push({ article_id: `historical-${index}`, path, collection: "architecture", visibility: "public", sections: [] });
  }
  await writeFile(join(f.root, "knowledge/structure.yaml"), YAML.stringify({ articles }));
  const read = filesystem.readFile;
  const historyReads: string[] = [];
  const spy = spyOn(filesystem, "readFile").mockImplementation(((...args: Parameters<typeof read>) => {
    if (String(args[0]).startsWith(history)) historyReads.push(String(args[0]));
    return read(...args);
  }) as typeof read);
  try {
    const before = (await readProductionStage(f.root))!;
    await prepareNextProductionStage({ projectRoot: f.root, stage: before, multiAgent: false });
    expect(await readProductionStage(f.root)).toEqual(before);
    expect(historyReads).toEqual([]);
  } finally { spy.mockRestore(); }
});

test("materializes current single batch and reuses unchanged shared files", async () => {
  const f = await fixture();
  const capabilities = productionCapabilitiesSchema.parse({ skills: [{ name: "code" }] });
  const first = await materializeProductionStage({ projectRoot: f.root, ...f, capabilities });
  expect(first.mode).toBe("single-agent");
  expect(first.batches.map(batch => batch.id)).toEqual(["first"]);
  const current = (await readProductionStage(f.root))!;
  expect(current.tasks.map(task => task.status)).toEqual(["issued", "pending"]);
  const sharedRoot = join(f.root, first.directory, "shared");
  const shared = join(sharedRoot, (await readdir(sharedRoot)).find(name => name.startsWith("source-"))!);
  const before = await stat(shared);
  const repeated = await materializeProductionStage({ projectRoot: f.root, stage: current, materials: f.materials, capabilities });
  expect(repeated.updated_files).toBe(0);
  expect((await stat(shared)).mtimeMs).toBe(before.mtimeMs);
  expect(await readFile(join(f.root, first.submission!), "utf8")).toContain("batches/first/first/article.md");
});

test("continuation checks shared navigation without reading its body and still rejects missing or non-file inputs", async () => {
  const f = await fixture();
  f.materials.sources.set("file:a", `# Large outline\n${"## Reader heading\n".repeat(100_000)}`);
  const first = await materializeProductionStage({ projectRoot: f.root, ...f,
    capabilities: productionCapabilitiesSchema.parse({}) });
  const current = (await readProductionStage(f.root))!;
  const sharedRoot = join(f.root, first.directory, "shared");
  const source = join(sharedRoot, (await readdir(sharedRoot)).find(name => name.startsWith("source-"))!);
  const before = await stat(source);
  const reads = spyOn(filesystem, "readFile");
  try {
    const repeated = await prepareNextProductionStage({ projectRoot: f.root, stage: current });
    expect(repeated!.updated_files).toBe(0);
    expect(reads.mock.calls.some(args => String(args[0]).startsWith(`${sharedRoot}/`))).toBe(false);
  } finally { reads.mockRestore(); }
  expect((await stat(source)).mtimeMs).toBe(before.mtimeMs);
  await rm(source);
  await expect(prepareNextProductionStage({ projectRoot: f.root, stage: current })).rejects.toThrow("Missing authorized material");
  await mkdir(source);
  await expect(prepareNextProductionStage({ projectRoot: f.root, stage: current })).rejects.toThrow("regular file");
  expect(await readProductionStage(f.root)).toEqual(current);
});

test("changing temporary skill guidance does not revoke unchanged writing tasks", async () => {
  const f = await fixture();
  await materializeProductionStage({ projectRoot: f.root, ...f,
    capabilities: productionCapabilitiesSchema.parse({ skills: [{ name: "code" }] }) });
  const before = (await readProductionStage(f.root))!;
  const updated = { ...before, indexer_usage: [{ scopes: ["repo:b"], skills: ["code", "api"],
    purpose: "Use both code and API guidance for the same module" }] };
  await saveProductionStage(f.root, updated);
  const output = await materializeProductionStage({ projectRoot: f.root, stage: updated,
    capabilities: productionCapabilitiesSchema.parse({ skills: [{ name: "code" }, { name: "api" }] }) });
  expect((await readProductionStage(f.root))!.tasks).toEqual(before.tasks);
  expect(YAML.parse(await readFile(join(f.root, output.directory, "indexer-usage.yaml"), "utf8"))).toEqual(updated.indexer_usage);
  expect(await readFile(join(f.root, output.directory, "skills.md"), "utf8")).toContain("api");
  expect(YAML.parse(await readFile(join(f.root, "src/indexers.yaml"), "utf8"))).not.toHaveProperty("indexers");
});

test("append and downgrade preserve previous materials and Agent drafts", async () => {
  const f = await fixture();
  const capabilities = productionCapabilitiesSchema.parse({ multi_agent: true });
  const result = await materializeProductionStage({ projectRoot: f.root, ...f, capabilities });
  expect(result.batches).toHaveLength(2);
  const agent = join(f.root, productionAgentDirectory(f.stage.id));
  await mkdir(join(agent, "submissions"), { recursive: true });
  await writeFile(join(agent, "submissions/ready.yaml"), "Agent owns this draft");
  const current = (await readProductionStage(f.root))!;
  const next = await materializeProductionStage({ projectRoot: f.root, stage: current, materials: f.materials,
    capabilities: productionCapabilitiesSchema.parse({ multi_agent: false }) });
  expect(next.batches).toHaveLength(1);
  expect(await readFile(join(agent, "submissions/ready.yaml"), "utf8")).toBe("Agent owns this draft");
  expect(await readFile(join(f.root, result.directory, "batches/second/tasks/second/task.md"), "utf8")).toContain("Explain second");
  expect((await readProductionStage(f.root))!.tasks.map(task => task.input)).toEqual(f.stage.tasks.map(task => task.input));
});

test("reordering authorized sources never redirects previously issued material links", async () => {
  const f = await fixture();
  const capabilities = productionCapabilitiesSchema.parse({});
  const first = await materializeProductionStage({ projectRoot: f.root, ...f, capabilities });
  const navigation = join(f.root, first.directory, "batches/first/tasks/first/sources.md");
  const before = await readFile(navigation, "utf8");
  const sharedRoot = join(f.root, first.directory, "shared");
  const sources = await Promise.all((await readdir(sharedRoot)).filter(name => name.startsWith("source-")).map(async name =>
    ({ name, content: await readFile(join(sharedRoot, name), "utf8") })));
  const current = (await readProductionStage(f.root))!;
  const reordered = { ...current, scopes: [...current.scopes].reverse() };
  await saveProductionStage(f.root, reordered);
  await materializeProductionStage({ projectRoot: f.root, stage: reordered, materials: f.materials, capabilities });
  expect(await readFile(navigation, "utf8")).toBe(before);
  for (const source of sources) expect(await readFile(join(sharedRoot, source.name), "utf8")).toBe(source.content);
});

test("next preparation never inherits a prior caller's multi-agent authority", async () => {
  const f = await fixture();
  await materializeProductionStage({ projectRoot: f.root, ...f, capabilities: productionCapabilitiesSchema.parse({ multi_agent: true,
    skills: [{ name: "available-code-skill" }] }) });
  const current = (await readProductionStage(f.root))!;
  const single = (await prepareNextProductionStage({ projectRoot: f.root, stage: current }))!;
  expect(single.mode).toBe("single-agent");
  expect(single.batches).toHaveLength(1);
  expect(await readFile(join(f.root, single.directory, "skills.md"), "utf8")).toContain("available-code-skill");
  const multi = (await prepareNextProductionStage({ projectRoot: f.root, stage: current, multiAgent: true }))!;
  expect(multi.mode).toBe("multi-agent");
  expect(multi.batches).toHaveLength(2);
  // A fresh workflow observation never sends a new host straight into the old
  // multi-batch directory. Its default preparation rewrites only CLI navigation.
  expect((await productionWorkflowRoute({ projectRoot: f.root, authorities: [] }))!.node).toBe("prepare-production-stage");
  await prepareNextProductionStage({ projectRoot: f.root, stage: current });
  expect((await productionWorkflowRoute({ projectRoot: f.root, authorities: [] }))!.node).toBe("work-production-stage");
});

test("the graph waits for report feedback before issuing writing and rejects approval of an old plan", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "sources/note/20260913"), { recursive: true });
  await writeFile(join(f.root, "sources/note/20260913/scope.md"), "# Scope\nA source for the report.\n");
  const scope = "note:20260913/scope.md";
  const scopes = [{ scope, baseline: await productionSourceBaseline(f.root, scope) }];
  const stage = { ...f.stage, scopes, report_approved: false, tasks: f.stage.tasks.map(task => {
    const current = { ...task, sources: scopes };
    return { ...current, input: productionTaskInput(current) };
  }) };
  f.materials.sources = new Map([[scope, "# Source\nRead sources/note/20260913/scope.md.\n"]]);
  const requirements = YAML.stringify({ requirements: [{ id: "readers", purpose: stage.purpose,
    target_scope: { targets: stage.scopes.map(source => ({ source_ref: source.scope })) } }] });
  await mkdir(join(f.root, "src"), { recursive: true });
  await writeFile(join(f.root, "src/indexers.yaml"), requirements);
  f.materials.requirements = requirements;
  await materializeProductionStage({ projectRoot: f.root, stage, materials: f.materials,
    capabilities: productionCapabilitiesSchema.parse({}) });
  const planningDirectory = join(f.root, ".tmp/context-runtime/production-stages", stage.id);
  await writeFile(join(planningDirectory, "planning.md"), "Investigation completed for the authorized sources.");
  await writeFile(join(planningDirectory, "planning.schema.json"), "{}");
  const route = (await productionWorkflowRoute({ projectRoot: f.root, authorities: ["context.knowledge-review"] }))!;
  expect(route.node).toBe("confirm-production-report");
  expect(route.gate).toMatchObject({ delegatable: false, resolution: "user" });
  expect(route.commands[0]!.availability).toBe("after-human-confirmation");
  expect((await readProductionStage(f.root))!.tasks.every(task => task.status === "pending")).toBe(true);
  for (const resource of route.resources.required) if (resource.path) expect(await readFile(resource.path, "utf8")).not.toBeEmpty();
  const path = "submissions/report.yaml";
  const agentRoot = join(f.root, productionAgentDirectory(stage.id));
  await mkdir(join(agentRoot, "submissions"), { recursive: true });
  await writeFile(join(agentRoot, path), YAML.stringify({ stage: stage.id, decision: "approved" }));
  const changed = { ...stage, purpose: "Changed requested outcome" };
  await saveProductionStage(f.root, changed);
  const updated = (await productionWorkflowRoute({ projectRoot: f.root, authorities: [] }))!;
  expect(updated.revision).not.toBe(route.revision);
  expect(await readFile(updated.resources.required.at(-1)!.path!, "utf8")).toContain(changed.purpose);
  await expect(approveProductionReport({ projectRoot: f.root, stage: stage.id, revision: route.revision, path })).rejects.toThrow("plan changed");
  const accepted = await approveProductionReport({ projectRoot: f.root, stage: stage.id,
    revision: productionReportRevision(changed), path });
  expect(accepted.stage_state).toBe("active");
  expect((await productionWorkflowRoute({ projectRoot: f.root, authorities: [] }))!.node).toBe("work-production-stage");
});

test("the graph selects preparation, unresolved scope and completion from actual stage facts", async () => {
  const f = await fixture();
  await saveProductionStage(f.root, f.stage);
  expect((await productionWorkflowRoute({ projectRoot: f.root, authorities: [] }))!.node).toBe("prepare-production-stage");
  const completed = { ...f.stage, tasks: f.stage.tasks.map(task => ({ ...task, status: "accepted" as const })) };
  await saveProductionStage(f.root, { ...completed, pending_scopes: [f.stage.scopes[0]!.scope] });
  expect((await productionWorkflowRoute({ projectRoot: f.root, authorities: [] }))!.node).toBe("continue-production-investigation");
  await saveProductionStage(f.root, { ...completed, pending_scopes: [f.stage.scopes[0]!.scope],
    gaps: [{ scope: f.stage.scopes[0]!.scope, reason: "Material is unavailable" }] });
  expect((await productionWorkflowRoute({ projectRoot: f.root, authorities: [] }))!.node).toBe("resolve-production-gap");
  await saveProductionStage(f.root, completed);
  expect(await productionWorkflowRoute({ projectRoot: f.root, authorities: [] })).toBeUndefined();
});

test("does not issue work whose material projection failed", async () => {
  const f = await fixture();
  await saveProductionStage(f.root, f.stage);
  await expect(materializeProductionStage({ projectRoot: f.root, stage: f.stage,
    capabilities: productionCapabilitiesSchema.parse({}), materials: { ...f.materials, sources: new Map() } })).rejects.toThrow("Missing authorized");
  expect((await readProductionStage(f.root))!.tasks.every(task => task.status === "pending")).toBe(true);
});

test("stale preparation cannot replace newly accepted progress", async () => {
  const f = await fixture();
  const accepted = { ...f.stage, tasks: f.stage.tasks.map(task => ({ ...task, status: "accepted" as const })) };
  await saveProductionStage(f.root, accepted);
  await expect(materializeProductionStage({ projectRoot: f.root, ...f,
    capabilities: productionCapabilitiesSchema.parse({}) })).rejects.toThrow("Stage changed");
  expect((await readProductionStage(f.root))!.tasks.every(task => task.status === "accepted")).toBe(true);
});

test("clearing temporary state leaves no production process to restore", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "knowledge/architecture"), { recursive: true });
  await writeFile(join(f.root, "knowledge/architecture/approved.md"), "# Existing formal article\n");
  await saveProductionStage(f.root, f.stage);
  await rm(join(f.root, ".tmp"), { recursive: true, force: true });
  expect(await readProductionStage(f.root)).toBeUndefined();
  expect(await readFile(join(f.root, "knowledge/architecture/approved.md"), "utf8")).toBe("# Existing formal article\n");
});
