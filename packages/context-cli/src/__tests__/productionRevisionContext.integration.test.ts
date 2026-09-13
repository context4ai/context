import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { initContextProject } from "../project/workspace.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { approvedRevisionContext } from "../project/approvedRevisionContext.js";
import { productionPlanningRequest, submitProductionPlan } from "../project/productionPlanning.js";
import { prepareCurrentProductionStage } from "../project/productionStagePreparation.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { captureProcessedScopes, currentScopeSourceVersion } from "../project/processedScopeStorage.js";
import { beginKnowledgeUpdate, readKnowledgeUpdate } from "../project/knowledgeUpdate.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test.each(["note", "sessions"] as const)("%s revision gets current guidance and source context without persistent Providers", async type => {
  const parent = resolve(".tmp/production-revision-context-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-")); roots.push(outer);
  const root = (await initContextProject({ cwd: outer, projectDir: "workspace", dev: true })).projectRoot;
  const saved = await importManagedDocument(root, { type, name: "20260913/access.md",
    markdown: "# Access\nAsk the owner to restore access.",
    ...(type === "sessions" ? { changes: [{ mr: "https://git.example.org/team/project/pull/42" }] } : {}) });
  const requirements = { requirements: [{ id: "access", purpose: "Explain access recovery",
    target_scope: { targets: [{ source_ref: saved.source_ref, module_refs: ["reading-focus"] }] } }] };
  const requirementsPath = join(root, "src/indexers.yaml");
  await writeFile(requirementsPath, YAML.stringify(requirements));
  const request = (await productionPlanningRequest(root))!;
  await prepareCurrentProductionStage({ projectRoot: root, revision: request.revision });
  const stage = (await readProductionStage(root))!;
  const agent = join(root, productionAgentDirectory(stage.id));
  const usage = [{ scopes: [saved.source_ref], skills: [`context-${type}-indexer`, "team-access-guidance"],
    purpose: "Combine source reading with the team's access terminology" }];
  await mkdir(join(agent, "submissions"), { recursive: true });
  await writeFile(join(agent, "submissions/plan.yaml"), YAML.stringify({ stage: stage.id,
    capabilities: { multi_agent: false, skills: usage[0]!.skills.map(name => ({ name })) },
    indexer_usage: usage,
    articles: [{ path: "faq/access.md", question: "How should access be restored?", sources: [saved.source_ref], batch: "access" }],
  }));
  await submitProductionPlan({ projectRoot: root, stage: stage.id, path: "submissions/plan.yaml" });
  const target = { source_refs: [saved.source_ref], markdown: "# Access help\n", sections: [] };
  const context = await approvedRevisionContext(root, target);
  expect(context.requirements).toEqual(requirements.requirements);
  expect(context.indexer_usage).toEqual(usage);
  expect(context).not.toHaveProperty("providers");
  expect(context.sources).toMatchObject([{ source_ref: saved.source_ref, path: await realpath(join(root, saved.path)) }]);
  if (type === "sessions") expect(context.sources[0]!.changes).toEqual([{ mr: "https://git.example.org/team/project/pull/42" }]);
  else expect(context.sources[0]!.changes).toBeUndefined();

  const scope = { requirement_ref: "access", source_ref: saved.source_ref,
    processed_version: await currentScopeSourceVersion(root, saved.source_ref) };
  expect(await captureProcessedScopes(root, [scope])).toEqual([scope]);
  const differentFocus = { ...scope, module_refs: ["another-reading-focus"] };
  expect(await captureProcessedScopes(root, [differentFocus])).toEqual([differentFocus]);
  const beforeStage = await readProductionStage(root);
  await expect(beginKnowledgeUpdate(root, { scopes: [scope] })).rejects.toThrow("active task");
  expect(await readProductionStage(root)).toEqual(beforeStage);
  expect(await readKnowledgeUpdate(root)).toBeUndefined();
  await expect(captureProcessedScopes(root, [{ ...scope, requirement_ref: "unapproved" }])).rejects.toThrow("boundary");
  await expect(captureProcessedScopes(root, [{ ...scope, processed_version: "changed" }])).rejects.toThrow("version");
  expect(YAML.parse(await readFile(requirementsPath, "utf8"))).toEqual(requirements);
  await rm(join(root, ".tmp"), { recursive: true, force: true });
  const fresh = await approvedRevisionContext(root, target);
  expect(fresh.requirements).toEqual(requirements.requirements);
  expect(fresh.indexer_usage).toEqual([]);
  expect(fresh.sources).toEqual(context.sources);
  // Retired process files do not restore a run or prevent an independent update.
  await mkdir(join(root, ".tmp/context-runtime/indexer/main-index"), { recursive: true });
  await writeFile(join(root, ".tmp/context-runtime/indexer/main-index/current.json"), "Invalid retired process state");
  await mkdir(join(root, "knowledge"), { recursive: true });
  await writeFile(join(root, "knowledge/structure.yaml"), YAML.stringify({ articles: [] }));
  expect((await beginKnowledgeUpdate(root, { scopes: [scope] })).outcome).toBe("update-prepared");
  const update = (await readKnowledgeUpdate(root))!;
  expect(update.requirements).toEqual(requirements.requirements);
  expect(update.scopes).toEqual([scope]);
  expect(YAML.parse(await readFile(requirementsPath, "utf8"))).toEqual(requirements);
});
