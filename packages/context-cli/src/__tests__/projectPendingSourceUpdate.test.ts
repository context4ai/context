import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { readProcessedScopes } from "@c4a/context";
import { DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { completeCurrentIndexerAction } from "./knowledgeMapReview.fixture.js";
import { beginKnowledgeUpdate, readKnowledgeUpdate } from "../project/knowledgeUpdate.js";
import { pendingSourceUpdateScopes } from "../project/pendingSourceUpdates.js";
import { registeredRepoHistoryReader } from "../project/articleSourceReader.js";
import { collectProjectStatus } from "../project/status.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const scope = { requirement_ref: "workspace-knowledge", source_ref: DOCUMENT_REVISION_SOURCE_REF, module_refs: ["module:app"] };
const baseline = async (root: string) => readProcessedScopes(YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8")));

async function settledKnowledge() {
  const root = await initialRevisionKnowledge(roots);
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const update = (await readKnowledgeUpdate(root))!;
  const status = await collectProjectStatus(root, { managed: true });
  await completeCurrentIndexerAction({ cwd: root, revision: status.workflow.current!.revision, managed: true,
    value: { stage: "source-update", decisions: update.candidates.map(({ path }) => ({ path })),
      scope_summary: "Both published constants match the current source.", new_topics: [] } });
  return root;
}

async function moveRegistration(root: string, file: string, content: string) {
  const source = join(root, "fixture-source");
  await writeFile(join(source, file), content);
  execFileSync("git", ["add", file], { cwd: source });
  execFileSync("git", ["commit", "-qm", `change ${file}`], { cwd: source });
  const version = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  const registry = join(root, "sources/repo/index.yaml");
  const parsed = YAML.parse(await readFile(registry, "utf8"));
  parsed.sources[0].modules[0].git.ref = version;
  await writeFile(registry, YAML.stringify(parsed));
  return version;
}

test("a pending update with unchanged cited text settles the new commit without page decisions", async () => {
  const root = await settledKnowledge();
  expect(await beginKnowledgeUpdate(root, undefined, { pending: true })).toMatchObject({ outcome: "current" });
  const version = await moveRegistration(root, "README.md", "Unrelated upstream note.\n");
  expect(await pendingSourceUpdateScopes(root)).toEqual([scope]);
  expect((await collectProjectStatus(root)).workflow.current?.node).toBe("process-source-update");
  expect(await beginKnowledgeUpdate(root, undefined, { pending: true })).toMatchObject({ outcome: "settled", relocated_references: 0 });
  expect(await readKnowledgeUpdate(root)).toBeUndefined();
  expect((await baseline(root)).map(entry => entry.processed_version)).toEqual([version]);
  expect(await pendingSourceUpdateScopes(root)).toEqual([]);
  expect((await collectProjectStatus(root)).workflow.current?.node).not.toBe("process-source-update");
});

test("a pending update asks only about pages whose cited text changed and keeps the old baseline until decided", async () => {
  const root = await settledKnowledge();
  const before = await baseline(root);
  const version = await moveRegistration(root, "src/index.ts", "export const answer = 43;\n");
  expect(await beginKnowledgeUpdate(root, undefined, { pending: true })).toMatchObject({ outcome: "update-prepared" });
  const update = (await readKnowledgeUpdate(root))!;
  expect(update.scopes).toEqual([{ ...scope, processed_version: version }]);
  expect(update.changed_references?.length).toBeGreaterThan(0);
  expect(new Set(update.candidates.map(candidate => candidate.path)))
    .toEqual(new Set(update.changed_references!.map(reference => reference.path)));
  expect(await baseline(root)).toEqual(before);
  await expect(beginKnowledgeUpdate(root, undefined, { pending: true })).rejects.toThrow("active task");
});

test("history reads fetch one missing settled commit into a shallow recovered checkout", async () => {
  const root = await initialRevisionKnowledge(roots);
  const source = join(root, "fixture-source");
  const first = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  const original = await readFile(join(source, "src/index.ts"), "utf8");
  await moveRegistration(root, "src/index.ts", "export const answer = 43;\n");
  const checkout = join(root, "sources/repo/20260903/revision-fixture");
  await rm(checkout, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "--depth=1", `file://${source}`, checkout]);
  const read = await registeredRepoHistoryReader(root);
  expect(await read(DOCUMENT_REVISION_SOURCE_REF, "src/index.ts", first)).toBe(original);
});
