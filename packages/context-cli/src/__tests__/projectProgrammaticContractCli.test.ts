import { expect, test } from "bun:test";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";
import { indexerArtifactResultSchema, indexerAuthorSemanticInputSchema, resolveIndexerSubjectKeySchemas } from "@c4a/context";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { buildIndexerAuthorRunResultFromSemantic } from "../project/indexerSemanticAuthorResult.js";
import { acceptIndexerMainAuthorRunsStore, readAcceptedIndexerMainAuthorResultRecords } from "../project/indexerMainRunStore.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { readCurrentIndexerFinalization } from "../project/indexerCurrentFinalization.js";
import { loadCliIndexerBaseContracts } from "../project/indexerCliBundledProvider.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { readIndexerDelivery } from "../project/indexerDelivery.js";

const execute = promisify(execFile);
// Normal unit runs exercise the source command. Artifact runs must execute the
// selected CLI with Node, not import its separately installed SDK as a proxy.
const cliPath = process.env.CONTEXT_TEST_CLI && resolve(process.env.CONTEXT_TEST_CLI);

async function compileWithCli(root: string, inputPath: string): Promise<void> {
  const args = ["indexer", "compile-indexer-candidates", "--input", inputPath, "--format", "json"];
  const output = cliPath
    ? (await execute("node", [cliPath, ...args], { cwd: root, timeout: 60_000,
        env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, maxBuffer: 16 * 1024 * 1024 })).stdout
    : await runCliInDir(root, args);
  expect(JSON.parse(output).outcome).toBe("indexer-candidates-compiled");
}

async function prepareContractWorkspace(): Promise<string> {
  const root = await createDocumentRevisionWorkspace();
  const repo = join(root, "fixture-source");
  await rm(join(repo, "src/index.ts"));
  await rm(join(repo, "src/secondary.ts"));
  const packagePath = join(repo, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  pkg.exports = { ".": "./src/panel.tsx" };
  await writeFile(packagePath, JSON.stringify(pkg));
  await writeFile(join(repo, "src/panel.tsx"), `export interface PanelProps {
  showHeading?: boolean;
  locale?: string;
  /** @default false */
  enabled?: boolean;
  selected?: string[];
}
export const Panel = ({ showHeading = true, locale = 'en-US', enabled = true, selected = [] }: PanelProps) => null;
`);
  execFileSync("git", ["add", "package.json", "src"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "add public contract fixture"], { cwd: repo });
  const ref = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const path = join(root, "sources/repo/index.yaml");
  const sources = YAML.parse(await readFile(path, "utf8"));
  sources.sources[0].modules[0].git.ref = ref;
  await writeFile(path, YAML.stringify(sources));
  await completePartitionStage(root, true);
  const review = await currentIndexerStructureReview(root);
  if (!review) throw new Error("missing fixture structure review");
  await completeCurrentIndexerAction({ cwd: root, revision: review.revision,
    value: { stage: "structure-review", decision: "approved", knowledge_map: {
      expected_revision: review.knowledge_map?.revision ?? null, remove: [],
      upsert: review.preview.topics.flatMap(topic => topic.article_targets ?? []).map(article => ({
        key: `reader:${article.artifact_ref}`, parent: null, title: article.artifact_ref, order: 0,
        target: { artifact_ref: article.artifact_ref },
      })),
    } }, managed: true,
    authorities: contextWorkflowAuthorities({ managed: true }) });
  return root;
}

async function acceptContractAuthors(root: string, catalogComponent: boolean): Promise<void> {
  const current = await resolveCurrentIndexerAgentContext(root);
  if (!current || current.descriptor.stage !== "author") throw new Error("missing fixture Author batch");
  const runs = [];
  let supportingCount = 0;
  for (const descriptor of current.descriptor.tasks) {
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root,
      descriptor: current.descriptor, taskKey: descriptor.task_key });
    const workset = task.spec.request.workset;
    if (workset.stage !== "author") throw new Error("expected Author workset");
    const validation = task.spec.validation as Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"];
    const dependencyView = validation.dependency_view as {
      positive_nodes: Array<{ kind: string; evidence_ref?: string }>;
    };
    const sourceItems = dependencyView.positive_nodes.flatMap(node =>
      node.kind === "source-span" && node.evidence_ref ? [node.evidence_ref] : []);
    const viewFacts = task.view.items.filter(item => item.category === "fact");
    const catalogMembers = new Set(validation.canonical_inventory_members.filter(member =>
      catalogComponent && viewFacts.some(item => {
        const value = item.value as { payload?: { kind?: string } };
        return (item.ref === member.member_id || item.provenance.container_ref === member.member_id)
          && value.payload?.kind === "component";
      })).map(member => member.member_id));
    supportingCount += catalogMembers.size;
    const semantic = indexerAuthorSemanticInputSchema.parse({
      stage: "author", outcome: "publish", group_key: workset.group_key,
      artifact_intent: "authoritative-source/usage-guide/integrate-capability/content",
      title: "Public component", summary: "Use the public component and its parameters.",
      target_resolutions: (workset.target_resolution_view?.entries ?? []).map(entry => ({
        target: entry.query_ref, disposition: entry.state === "resolved" ? "reuse-existing" : "create-independent",
      })),
      sections: [{ key: "overview", heading: "Overview", markdown: "Use the exported component.",
        source_items: sourceItems,
        facts: viewFacts.filter(item => !catalogMembers.has(item.provenance.container_ref ?? item.ref)).map(item => item.ref),
        answers: validation.allowed_question_targets.map(target => target.question_target_key),
      }],
      member_dispositions: validation.canonical_inventory_members.map(member => catalogMembers.has(member.member_id)
        ? { item: member.member_id, state: "catalog-only" }
        : { item: member.member_id, state: "covered", section: "overview" }),
      material_gaps: [], diagnostics: [],
    });
    runs.push({ workset_digest: workset.workset_digest,
      result: buildIndexerAuthorRunResultFromSemantic({ request: task.spec.request, view: task.view, semantic, validation }) });
  }
  if (catalogComponent) expect(supportingCount).toBeGreaterThan(0);
  const accepted = await acceptIndexerMainAuthorRunsStore({ projectRoot: root, runs });
  expect(accepted.outcomes.map(outcome => outcome.outcome)).toEqual(runs.map(() => "accepted"));
  await advanceCurrentIndexerLifecycle(root);
}

for (const catalogComponent of [false, true]) {
  test(`CLI Candidate compile merges defaults with component ${catalogComponent ? "catalog-only" : "covered"}`, async () => {
    const root = await prepareContractWorkspace();
    try {
      await acceptContractAuthors(root, catalogComponent);
      const finalization = await readCurrentIndexerFinalization(root);
      expect(finalization?.state).toBe("ready");
      const delivery = await readIndexerDelivery(root);
      const records = (await readAcceptedIndexerMainAuthorResultRecords(root)).map(record => ({
        ...record, artifact_result: indexerArtifactResultSchema.parse(record.artifact_result),
      })).filter(record => !delivery?.current.length || delivery.current.some(page =>
        page.result_digest === record.artifact_result.output_digest));
      const contracts = await loadCliIndexerBaseContracts();
      const schemas = resolveIndexerSubjectKeySchemas({ profile_contract: contracts.profiles,
        operator_contract: contracts.operators, providers: [], selections: [{
          indexer_id: "revision-fixture", profile: "component-library", role: "primary", provider_layer_id: "community",
        }] });
      const input = {
        protocol: "context.indexer.candidate-compile-input/v1",
        accepted_result_refs: records.map(record => ({
          workset_digest: record.accepted_record.workset_digest,
          execution_request_digest: record.accepted_record.execution_request_digest,
          acceptance_digest: record.accepted_record.acceptance_digest,
          artifact_result_digest: record.artifact_result.output_digest,
        })),
        subject_key_schema_set: schemas,
        layout_proposal_set: finalization!.layout_proposal_set,
        layout_transition: finalization!.layout_transition,
        layout_change_confirmations: finalization!.confirmations ?? [],
        rendered_artifacts: records.map(record => ({ artifact_result_digest: record.artifact_result.output_digest, artifacts: [] })),
      };
      const inputPath = join(root, ".tmp/contract-compile.json");
      await mkdir(join(root, ".tmp"), { recursive: true });
      await writeFile(inputPath, JSON.stringify(input));
      await compileWithCli(root, inputPath);
      const markdown = (await readCandidateRecords(root)).map(candidate => candidate.body).join("\n");
      for (const [name, type, value] of [
        ["showHeading", "boolean", "true"], ["locale", "string", "'en-US'"],
        ["enabled", "boolean", "true"], ["selected", "string[]", "[]"],
      ]) {
        expect(markdown.split(`| PanelProps | ${name} |`).length - 1).toBe(1);
        expect(markdown).toContain(`| PanelProps | ${name} | ${type} | optional | ${value} |`);
        expect(markdown).not.toContain(`| Panel | ${name} |`);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 120_000);
}
