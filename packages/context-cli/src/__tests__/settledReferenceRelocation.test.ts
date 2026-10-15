import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { completeCurrentIndexerAction } from "./knowledgeMapReview.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildFixturePackages as buildProjectPackages } from "./workspaceVersionDelivery.fixture.js";
import { beginKnowledgeUpdate, readKnowledgeUpdate } from "../project/knowledgeUpdate.js";
import { readApprovedRevision } from "../project/approvedRevision.js";
import { collectProjectStatus } from "../project/status.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const scope = { requirement_ref: "workspace-knowledge", source_ref: DOCUMENT_REVISION_SOURCE_REF, module_refs: ["module:app"] };

async function complete(root: string, value: unknown) {
  const status = await collectProjectStatus(root, { managed: true });
  return completeCurrentIndexerAction({ cwd: root, revision: status.workflow.current!.revision, managed: true, value }) as Promise<Record<string, unknown>>;
}

async function commitSource(root: string, content: string) {
  const source = join(root, "fixture-source");
  await writeFile(join(source, "src/index.ts"), content);
  execFileSync("git", ["add", "src/index.ts"], { cwd: source });
  execFileSync("git", ["commit", "-qm", "change source"], { cwd: source });
  const version = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  const registry = join(root, "sources/repo/index.yaml");
  const parsed = YAML.parse(await readFile(registry, "utf8"));
  parsed.sources[0].modules[0].git.ref = version;
  await writeFile(registry, YAML.stringify(parsed));
}

async function citedLines(root: string) {
  const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  return Object.fromEntries((structure.articles as Array<{ path: string; sections: Array<{ references: Array<{ locator: { start_line: number }; content_digest: string }> }> }>)
    .map(article => [article.path, article.sections[0]!.references[0]!]));
}

async function keepAll(root: string) {
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const update = (await readKnowledgeUpdate(root))!;
  return complete(root, { stage: "source-update", decisions: update.candidates.map(({ path }) => ({ path })),
    scope_summary: "The pages remain correct.", new_topics: [] });
}

test("keeping pages relocates uniquely moved unchanged citations at settlement", async () => {
  const root = await initialRevisionKnowledge(roots);
  const before = await citedLines(root);
  await commitSource(root, `// header\n${await readFile(join(root, "fixture-source/src/index.ts"), "utf8")}`);
  const result = await keepAll(root);
  expect(result.outcome).toBe("unchanged");
  expect(result.reference_warnings).toBeUndefined();
  const after = await citedLines(root);
  for (const [path, reference] of Object.entries(after)) {
    expect(reference.locator.start_line).toBe(2);
    expect(reference.content_digest).toBe(before[path]!.content_digest);
  }
}, 60_000);

test("keeping pages whose cited text changed returns a receipt and retains the old citation", async () => {
  const root = await initialRevisionKnowledge(roots);
  const before = await citedLines(root);
  await commitSource(root, "export const answer = 43;\n");
  const result = await keepAll(root);
  expect(result.outcome).toBe("unchanged");
  const warnings = result.reference_warnings as Array<{ path: string; state: string }>;
  expect(warnings.map(item => item.state)).toEqual(["changed", "changed"]);
  expect(String(result.reference_warning_instruction)).toContain("context revise");
  expect(await citedLines(root)).toEqual(before);
}, 60_000);

test("a missing region baseline is reported, never treated as unchanged", async () => {
  const root = await initialRevisionKnowledge(roots);
  const before = await citedLines(root);
  await commitSource(root, `// header\n${await readFile(join(root, "fixture-source/src/index.ts"), "utf8")}`);
  await rm(join(root, ".tmp/context-runtime/source-regions"), { recursive: true, force: true });
  const result = await keepAll(root);
  expect((result.reference_warnings as Array<{ state: string }>).map(item => item.state)).toEqual(["unavailable", "unavailable"]);
  expect(await citedLines(root)).toEqual(before);
}, 60_000);

test("a mixed batch relocates the kept page when the revision queue settles", async () => {
  const root = await initialRevisionKnowledge(roots);
  await commitSource(root, `// header\n${await readFile(join(root, "fixture-source/src/index.ts"), "utf8")}`);
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const update = (await readKnowledgeUpdate(root))!;
  const [revised, kept] = update.candidates;
  const result = await complete(root, { stage: "source-update", scope_summary: "Clarify one page.", new_topics: [],
    decisions: [{ path: revised!.path, instruction: "Clarify the entry point." }, { path: kept!.path }] });
  expect(result.outcome).toBe("revisions-prepared");
  expect(result.reference_warnings).toBeUndefined();
  expect((await citedLines(root))[kept!.path]!.locator.start_line).toBe(1);
  const request = (await readApprovedRevision(root))!;
  await complete(root, { stage: "approved-revision", markdown: request.target.markdown.replace("public entry point", "documented public entry point") });
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root);
  await buildProjectPackages(root);
  const after = await citedLines(root);
  expect(after[kept!.path]!.locator.start_line).toBe(2);
  expect(after[revised!.path]!.locator.start_line).toBe(2);
}, 60_000);
