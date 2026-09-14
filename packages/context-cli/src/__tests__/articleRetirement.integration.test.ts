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
