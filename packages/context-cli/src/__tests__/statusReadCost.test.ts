import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { collectProjectStatus } from "../project/status.js";
import { verifyProjectWorkspace } from "../project/verify.js";
import { readApprovedMarkdownFiles, readApprovedStructureValue } from "../project/approvedFileRead.js";
import { withCommandReadCache } from "../project/commandReadCache.js";
import { readTaskPreparation, resumeWorkspaceTask } from "../project/taskResumption.js";
import { productionPlanningRequest } from "../project/productionPlanning.js";
import { prepareCurrentProductionStage } from "../project/productionStagePreparation.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

test("cleared task progress does not audit article bodies; explicit verification still catches edits", async () => {
  const root = await initialRevisionKnowledge(roots);
  const article = join(root, "knowledge/architecture/overview.md");
  await fs.writeFile(article, "Broken article without required fragment markers.\n");
  const original = fs.readFile;
  const bodies: string[] = [];
  const spy = spyOn(fs, "readFile").mockImplementation(((...args: Parameters<typeof original>) => {
    if (String(args[0]).startsWith(join(root, "knowledge/architecture"))) bodies.push(String(args[0]));
    return original(...args);
  }) as typeof original);
  try {
    const status = await collectProjectStatus(root);
    expect(status.state).toBe("route.workspace.task-cleared");
    expect(status.evidenceStatus).toBe("not-checked");
    expect(status.close.state).toBe("not-checked");
    expect(bodies).toEqual([]);
    expect((await verifyProjectWorkspace(root)).ok).toBe(false);
    expect(bodies).toContain(article);
  } finally { spy.mockRestore(); }
});

test("discarding scratch after delivery does not restart production or change approved files", async () => {
  const root = await initialRevisionKnowledge(roots);
  const paths = ["knowledge/structure.yaml", "knowledge/architecture/overview.md", "changelog.yaml", "package.json"];
  const before = await Promise.all(paths.map(path => fs.readFile(join(root, path), "utf8")));
  await fs.rm(join(root, ".tmp"), { recursive: true, force: true });
  expect(await readTaskPreparation(root)).toBe("cleared");
  const status = await collectProjectStatus(root);
  expect(status.workflow.current?.node).toBe("reopen-cleared-task");
  expect(status.evidenceStatus).toBe("not-checked");
  expect(await Promise.all(paths.map(path => fs.readFile(join(root, path), "utf8")))).toEqual(before);
  await resumeWorkspaceTask(root);
  expect(await readTaskPreparation(root)).toBe("resume-requested");
  expect((await collectProjectStatus(root)).workflow.current?.node).toBe("prepare-production-planning");
});

test("command reads share bytes but detect additions, replacement, deletion and isolate mutable structure", async () => {
  const parent = resolve(".tmp/approved-read-tests");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(join(parent, "case-")); roots.push(root);
  await fs.mkdir(join(root, "knowledge/architecture"), { recursive: true });
  const article = join(root, "knowledge/architecture/a.md");
  await fs.writeFile(article, "first");
  await fs.writeFile(join(root, "knowledge/structure.yaml"), "articles: []\n");
  const original = fs.readFile;
  let bodyReads = 0;
  const spy = spyOn(fs, "readFile").mockImplementation(((...args: Parameters<typeof original>) => {
    if (String(args[0]) === article) bodyReads++;
    return original(...args);
  }) as typeof original);
  try {
    await withCommandReadCache(async () => {
      const first = await readApprovedMarkdownFiles(root);
      first[0]!.content = "not committed";
      expect((await readApprovedMarkdownFiles(root))[0]!.content).toBe("first");
      expect(bodyReads).toBe(1);
      const structure = await readApprovedStructureValue(root) as { articles: unknown[] };
      structure.articles.push({ uncommitted: true });
      expect(await readApprovedStructureValue(root)).toEqual({ articles: [] });
      await fs.writeFile(join(root, "replacement"), "other");
      await fs.rename(join(root, "replacement"), article);
      expect((await readApprovedMarkdownFiles(root))[0]!.content).toBe("other");
      await fs.writeFile(join(root, "knowledge/architecture/b.md"), "added");
      expect(await readApprovedMarkdownFiles(root)).toHaveLength(2);
      await fs.rm(article);
      expect(await readApprovedMarkdownFiles(root)).toHaveLength(1);
    });
    await fs.writeFile(article, "new command");
    expect((await withCommandReadCache(() => readApprovedMarkdownFiles(root)))[0]!.content).toBe("new command");
  } finally { spy.mockRestore(); }
});

test("new investigation keeps its actual route without re-auditing previously delivered prose", async () => {
  const root = await initialRevisionKnowledge(roots);
  await resumeWorkspaceTask(root);
  const request = (await productionPlanningRequest(root))!;
  await prepareCurrentProductionStage({ projectRoot: root, revision: request.revision });
  const original = fs.readFile;
  const bodies: string[] = [];
  const spy = spyOn(fs, "readFile").mockImplementation(((...args: Parameters<typeof original>) => {
    if (String(args[0]).startsWith(join(root, "knowledge/architecture"))) bodies.push(String(args[0]));
    return original(...args);
  }) as typeof original);
  try {
    const status = await collectProjectStatus(root);
    expect(status.evidenceStatus).toBe("not-checked");
    expect(status.workflow.current?.reason_code).toStartWith("route.production.");
    expect(bodies).toEqual([]);
  } finally { spy.mockRestore(); }
});
