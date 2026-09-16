import { afterEach, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { retireArticles } from "../project/articleRetirement.js";
import { closeProjectWorkspace } from "../project/close.js";
import { collectProjectStatus } from "../project/status.js";
import { buildFixturePackages } from "./workspaceVersionDelivery.fixture.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
test("retired approved article does not return at close or in rebuilt package inventory", async () => {
  const root = await initialRevisionKnowledge(roots);
  const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  const old = structure.articles[0];
  const value = { reason: "The reader task is no longer applicable", targets: [{ path: old.path }] };
  const preview = await retireArticles({ projectRoot: root, value });
  await retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision });
  const status = await collectProjectStatus(root, { managed: true });
  expect(status.workflow.current).toBeDefined();
  expect(status.workflow.current?.node).not.toBe("current-scope-complete");
  await closeProjectWorkspace(root);
  await buildFixturePackages(root);
  const after = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  expect(after.articles.some((article: { article_id: string }) => article.article_id === old.article_id)).toBe(false);
  const inventory = await readFile(join(root, "dist/update-kb/context-build-inventory.json"), "utf8");
  expect(inventory).not.toContain(old.path);
}, 60_000);


test("retirement supplies an executable rebuild while unfinished production remains intact", async () => {
  const { maintenanceProductionWorkspace } = await import("./maintenanceProduction.fixture.js");
  const { readProductionStage } = await import("../project/productionStageStore.js");
  const { runCliInDir } = await import("./projectBuildVerifyV060Helpers.js");
  const { advanceKnowledgeMaintenance } = await import("../project/knowledgeMaintenance.js");
  const { root, views } = await maintenanceProductionWorkspace(roots);
  await buildFixturePackages(root);
  const before = await readProductionStage(root);
  const value = { reason: "Remove an obsolete reader task", targets: [{ path: views[0]!.path }] };
  const preview = await retireArticles({ projectRoot: root, value });
  const applied = await retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision });
  const retry = await retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision });
  expect(retry.next_action.command).toBe(applied.next_action.command);
  const match = applied.next_action.command.match(/--input '([^']+)'/u);
  expect(match).not.toBeNull();
  await runCliInDir(root, ["task", "maintain", "--input", match![1]!, "--format", "json"]);
  const status = await collectProjectStatus(root, { managed: true });
  expect(status.workflow.current?.node).toBe("advance-knowledge-maintenance");
  await advanceKnowledgeMaintenance(root, status.workflow.current!.revision);
  expect(await readProductionStage(root)).toEqual(before);
  expect((await collectProjectStatus(root, { managed: true })).workflow.current?.node).not.toBe("advance-knowledge-maintenance");
}, 90_000);


test("older retirement receipts gain a rebuild input on retry", async () => {
  const { writeFile } = await import("node:fs/promises");
  const root = await initialRevisionKnowledge(roots);
  const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  const value = { reason: "Remove an obsolete page", targets: [{ path: structure.articles[0].path }] };
  const preview = await retireArticles({ projectRoot: root, value });
  await retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision });
  const directory = join(root, ".tmp/context-runtime/retirements", preview.revision.slice(7));
  const receipt = JSON.parse(await readFile(join(directory, "receipt.json"), "utf8"));
  receipt.files = receipt.files.filter((file: { path: string }) => !file.path.endsWith("/rebuild.json"));
  await writeFile(join(directory, "receipt.json"), JSON.stringify(receipt));
  await rm(join(directory, "rebuild.json"));
  const result = await retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision });
  expect(result.action).toBe("already-applied");
  expect(JSON.parse(await readFile(join(directory, "rebuild.json"), "utf8"))).toMatchObject({ operation: "rebuild", targets: [] });
}, 60_000);
