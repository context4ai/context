import { afterEach, expect, test } from "bun:test";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { type IndexerRegistry, readProcessedScopes } from "@c4a/context";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";
import { collectProjectStatus } from "../project/status.js";
import { runCurrentIndexerLifecycle } from "../project/indexerLifecycleRun.js";
import { readKnowledgeUpdate } from "../project/knowledgeUpdate.js";
import { readApprovedRevision } from "../project/approvedRevision.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { prepareManagedSourceKnowledgeUpdate } from "../project/managedSourceKnowledgeUpdate.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function initialKnowledge() {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"),
    join(root, "src/package-templates/kb"), { recursive: true });
  const entryPath = join(root, "src/index.ts");
  const entry = await readFile(entryPath, "utf8");
  await writeFile(entryPath, entry.replace("defineProject, source", "defineProject, kbPackage, source")
    .replace("packages: []", 'packages: [kbPackage({ name: "update-kb", template: { path: "src/package-templates/kb", vars: {} } })]'));
  await completePartitionStage(root);
  const structure = (await currentIndexerStructureReview(root))!;
  await completeCurrentIndexerAction({ cwd: root, revision: structure.revision, managed: true,
    value: { stage: "structure-review", decision: "approved" } });
  await completeAuthorStage(root);
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root);
  await acceptStarterPackageTemplates({ projectRoot: root });
  await buildProjectPackages(root);
  return root;
}

async function addSavedSource(root: string, type: "note" | "sessions" = "sessions") {
  const saved = await importManagedDocument(root, { type, name: "20260909/service-scope.md",
    markdown: "# Service scope\n\nThe supplied discussion states that only registered services appear in the picker." });
  const path = join(root, "src/index.ts");
  const content = await readFile(path, "utf8");
  await writeFile(path, content.replace("sources: [fixture]", `sources: [fixture, source("20260909/service-scope.md", { type: "${type}" })]`));
  return saved.source_ref;
}
async function complete(root: string, value: unknown) {
  const status = await collectProjectStatus(root, { managed: true });
  return completeCurrentIndexerAction({ cwd: root, revision: status.workflow.current!.revision, managed: true, value });
}
async function bindSession(root: string, sourceRef: string) {
  const path = join(root, "src/indexers.yaml");
  const registry = YAML.parse(await readFile(path, "utf8")) as IndexerRegistry;
  registry.requirements.push({ id: "service-faq", purpose: "Explain the service picker scope", reader_goals: ["resolve-common-problems"],
    coverage_domains: { troubleshooting: "required" }, target_scope: { targets: [{ source_ref: sourceRef, module_refs: [] }] },
    evidence_source_scope: { targets: [{ source_ref: sourceRef, module_refs: [] }] } });
  await writeFile(path, YAML.stringify(registry));
  const route = (await collectProjectStatus(root, { managed: true })).workflow.current!;
  expect(route.node).toBe("configure-indexer-providers");
  const actionInput = route.action!.input as { existing_indexers: unknown[]; cli_bundled_providers: Array<{ skill: string }> };
  expect(actionInput.existing_indexers).toEqual(registry.indexers);
  expect(actionInput.cli_bundled_providers.some(provider => provider.skill === "context-sessions-indexer")).toBe(true);
  const bundle = (await listCliBundledIndexers()).bundles.find(item => item.skill === "context-sessions-indexer")!;
  registry.indexers.push({ id: "service-faq", operations: ["main-index"],
    requirement_bindings: [{ requirement_ref: "service-faq", coverage_domains: ["troubleshooting"],
      owned_scope: { ref: "requirement:service-faq#target_scope" }, role: "primary" }],
    read_scope: { refs: ["requirement:service-faq#target_scope"] },
    profile: { primary: { id: "faq-support", provider: "community" } },
    providers: [{ id: "community", role: "primary", skill: bundle.skill, version: bundle.version, integrity: bundle.integrity, distribution: bundle.distribution }] });
  await writeFile(path, YAML.stringify(registry));
}

test("a selected but unbound saved source stops at configuration without starting old work", async () => {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  const sourceRef = await addSavedSource(root);
  const output = await runCurrentIndexerLifecycle({ projectRoot: root, managed: true, authorities: [] });
  expect(output.advanced).toBe(false);
  expect(output.workflow.current?.configuration?.file).toBe("src/indexers.yaml");
  expect(output.workflow.current?.configuration?.action).toContain(sourceRef);
  expect(await currentLedger(root)).toBeUndefined();
  expect(await readKnowledgeUpdate(root)).toBeUndefined();
}, 60_000);

test("a new session topic uses scoped update and delivers without rebuilding old worksets", async () => {
  const root = await initialKnowledge();
  const before = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  const oldPages = new Map<string, string>(await Promise.all(before.views.map(async (view: { path: string }) =>
    [view.path, await readFile(join(root, "knowledge", view.path), "utf8")] as const)));
  await importManagedDocument(root, { type: "sessions", name: "20260909/archive-only.md", markdown: "# Archive\n\nSaved for later reference only." });
  expect(await prepareManagedSourceKnowledgeUpdate(root)).toBe(false);
  expect(await currentLedger(root)).toBeUndefined();
  const sourceRef = await addSavedSource(root);
  await bindSession(root, sourceRef);
  const output = await runCurrentIndexerLifecycle({ projectRoot: root, managed: true, authorities: [] });
  expect(output.workflow.current?.node).toBe("inspect-source-update");
  const request = (await readKnowledgeUpdate(root))!;
  expect(request.scopes.map(scope => scope.source_ref)).toEqual([sourceRef]);
  expect(request.candidates).toEqual([]);
  expect(await currentLedger(root)).toBeUndefined();
  const retried = await runCurrentIndexerLifecycle({ projectRoot: root, managed: true, authorities: [] });
  expect(retried.workflow.current?.node).toBe("inspect-source-update");
  expect((await readKnowledgeUpdate(root))?.revision).toBe(request.revision);
  await complete(root, { stage: "source-update", decisions: [], scope_summary: "Add the supplied picker explanation as a separate topic.",
    new_topics: [{ path: "architecture/service-picker.md", title: "Service picker", source_refs: [sourceRef], instruction: "Explain the picker scope from the supplied conversation." }] });
  await complete(root, { stage: "structure-review", decision: "approved" });
  const revision = (await readApprovedRevision(root))!;
  await complete(root, { stage: "approved-revision", markdown: revision.target.markdown +
    `\n<!-- context:section id="scope" kind="content" source_ref="${sourceRef}" -->\n\nThe supplied discussion states that only registered services appear in the picker.\n\n<!-- /context:section -->\n` });
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root);
  await buildProjectPackages(root);
  for (const [path, body] of oldPages) expect(await readFile(join(root, "knowledge", path), "utf8")).toBe(body);
  expect(readProcessedScopes(YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"))).some(scope => scope.source_ref === sourceRef)).toBe(true);
  expect(await currentLedger(root)).toBeUndefined();
  expect(await prepareManagedSourceKnowledgeUpdate(root)).toBe(false);
}, 60_000);

test("supporting notes reuse the existing owner and bring only its target scopes into update", async () => {
  const root = await initialKnowledge();
  const sourceRef = await addSavedSource(root, "note");
  const path = join(root, "src/indexers.yaml");
  const registry = YAML.parse(await readFile(path, "utf8")) as IndexerRegistry;
  registry.requirements[0]!.evidence_source_scope.targets.push({ source_ref: sourceRef, module_refs: [] });
  registry.indexers[0]!.read_scope.refs.push("requirement:workspace-knowledge#evidence_source_scope");
  await writeFile(path, YAML.stringify(registry));
  const output = await runCurrentIndexerLifecycle({ projectRoot: root, managed: true, authorities: [] });
  expect(output.workflow.current?.node).toBe("inspect-source-update");
  const request = (await readKnowledgeUpdate(root))!;
  expect(request.scopes).toHaveLength(2);
  expect(request.scopes.some(scope => scope.source_ref === sourceRef)).toBe(true);
  expect(request.candidates).toHaveLength(2);
  expect(await currentLedger(root)).toBeUndefined();
  expect((YAML.parse(await readFile(path, "utf8")) as IndexerRegistry).indexers).toHaveLength(1);
}, 60_000);
