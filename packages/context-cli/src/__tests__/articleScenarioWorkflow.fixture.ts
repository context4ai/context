import { expect } from "bun:test";
import { expandArticleBlueprint } from "../project/indexerArticleBlueprint.js";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { indexerAuthorSemanticInputSchema, indexerTemplateContractSchema, validateIndexerAuthorDependencyView } from "@c4a/context";
import type { ArticleScenario } from "./articleCodeScenarios.fixture.js";
import { createArticleDocumentWorkspace } from "./articleDocumentWorkspace.fixture.js";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { buildIndexerAuthorRunResultFromSemantic } from "../project/indexerSemanticAuthorResult.js";
import { acceptIndexerMainAuthorRunsStore } from "../project/indexerMainRunStore.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { collectProjectStatus } from "../project/status.js";
import { splitFrontmatter } from "../project/indexerTemplateRendering.js";
import { readKnowledgeMap } from "../project/knowledgeMap.js";

export async function runArticleScenario(scenario: ArticleScenario, options: { organization?: { proposed: string; accepted: string } } = {}) {
  const provider = scenario.sourceType === "file" ? "markdown" : scenario.sourceType ?? "code";
  const providerRoot = resolve(import.meta.dir, `../../../../plugins/context/skills/context-${provider}-indexer`);
  const manifest = YAML.parse(await readFile(join(providerRoot, "context-indexer.yaml"), "utf8"));
  const plans = await Promise.all(scenario.articles.map(async article => {
    const id = `${scenario.profile}-${article.type}-page`;
    const selected = manifest.provider.templates.find((template: { id: string }) => template.id === id);
    if (!selected) throw new Error(`Scenario lacks a registered template: ${id}`);
    const metadata = splitFrontmatter(await readFile(join(providerRoot, selected.path), "utf8")).metadata;
    const contract = expandArticleBlueprint(metadata, selected)?.contract ?? indexerTemplateContractSchema.parse(metadata);
    for (const key of Object.keys(article.slots)) expect(contract.variables.some(variable => variable.id === key)).toBe(true);
    return { article, contract };
  }));
  const path = scenario.sourcePath ?? (scenario.sourceType ? "manual.md" : scenario.source.includes("<button") ? "src/index.tsx" : "src/index.ts");
  const root = scenario.sourceType ? await createArticleDocumentWorkspace(scenario, [...new Set(plans.map(plan => plan.contract.reader_goal))]) : await createDocumentRevisionWorkspace({ sourceCount: 1, profile: scenario.profile,
    purpose: scenario.articles.map(article => article.task).join("; "),
    readerGoals: [...new Set(plans.map(plan => plan.contract.reader_goal))],
    sourceFiles: { [path]: scenario.source }, packageJson: { exports: { ".": `./${path}` } } });
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entry = join(root, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({name: "scenario-kb", template: {path: "src/package-templates/kb", vars: {}}})]'));
    if (options.organization) {
      await mkdir(join(root, ".tmp"), { recursive: true });
      // A recorded Agent/user exchange, not CLI parsing or an invented gate.
      await writeFile(join(root, ".tmp/work-start-report.md"), `# Structure proposal\n\nProposed: ${options.organization.proposed}\nRecorded fixture feedback: ${options.organization.accepted}\n\n${scenario.articles.map(article => `- ${article.title}: ${article.task}; sections: ${Object.keys(article.slots).join(", ")}`).join("\n")}\n`);
    }
    await completePartitionStage(root, false, false, undefined, (intents, targets) => plans.map(({ article, contract }, index) => ({
      key: article.key ?? article.type, title: article.title, reader_task: article.task, required: true,
      artifact_intent: intents.find(intent => intent.split("/")[2] === contract.reader_goal && intent.endsWith("/content"))!,
      template_id: contract.template_id, question_targets: index === 0 ? targets : [],
      sections: Object.keys(article.slots).map(key => ({ key, heading: key, required: false })),
    })), undefined, undefined, scenario.sourceType ? "reader-subject" : "semantic-subject");
    const delivered: Array<{ type: string; key: string; path: string }> = [];
    for (let wave = 0; wave < 30; wave++) {
      const structure = await currentIndexerStructureReview(root);
      if (structure && !structure.approved) {
        const organization = options.organization;
        const previous = organization ? await readKnowledgeMap(root) : undefined;
        await completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "approved",
          ...(organization ? { knowledge_map: { expected_revision: previous?.revision ?? null, remove: [], upsert: [
            { key: "reader-root", parent: null, title: organization.accepted, order: 0 },
            ...structure.preview.topics.flatMap(topic => (topic.article_targets ?? []).map((target, index) => ({
              key: target.article_key, parent: "reader-root", title: scenario.articles.find(article => (article.key ?? article.type) === target.article_key)!.title,
              order: index, target: { artifact_ref: target.artifact_ref },
            }))),
          ] } } : {}),
        });
      }
      const current = await resolveCurrentIndexerAgentContext(root);
      if (current?.descriptor.stage === "author") {
        for (const descriptor of current.descriptor.tasks) {
          const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: descriptor.task_key });
          const workset = task.spec.request.workset;
          if (workset.stage !== "author") throw new Error("Expected Author");
          const validation = task.spec.validation as Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"];
          const facts = task.view.items.filter(item => item.category === "fact").map(item => item.ref);
          const sourceItems = scenario.sourceType ? validateIndexerAuthorDependencyView(validation.dependency_view).positive_nodes.flatMap(node => node.kind === "source-span" ? [node.evidence_ref] : []) : [];
          expect(facts.length + sourceItems.length).toBeGreaterThan(0);
          const articles = validation.page_plan!.articles!.map(planned => {
            const article = scenario.articles.find(article => (article.key ?? article.type) === planned.key)!;
            expect(validation.article_templates?.[planned.key]?.contract.template_id).toBe(planned.template_id);
            const articleFacts = article.symbols ? task.view.items.filter(item => {
              if (item.category !== "fact") return false;
              const value = item.value as { payload?: { name?: string } };
              return value.payload?.name !== undefined && article.symbols!.includes(value.payload.name);
            }).map(item => item.ref) : facts;
            expect(articleFacts.length + sourceItems.length).toBeGreaterThan(0);
            const key = Object.keys(article.slots)[0]!;
            return { key: planned.key, title: article.title, summary: article.task,
              sections: [{ key, heading: key, markdown: article.slots[key]!, facts: articleFacts, source_items: sourceItems, answers: planned.question_targets }],
              template_variables: Object.fromEntries(Object.entries(article.slots).map(([key, value]) => [key, { value, facts: articleFacts, source_items: sourceItems }])) };
          });
          const semantic = indexerAuthorSemanticInputSchema.parse({ stage: "author", group_key: workset.group_key, outcome: "publish", policy: "standard", articles,
            target_resolutions: (workset.target_resolution_view?.entries ?? []).map(entry => ({ target: entry.query_ref,
              disposition: entry.state === "resolved" ? "reuse-existing" : "create-independent" })),
            member_dispositions: validation.canonical_inventory_members.map(member => ({ item: member.member_id, state: "covered",
              article: articles[0]!.key, section: articles[0]!.sections[0]!.key })) });
          const result = buildIndexerAuthorRunResultFromSemantic({ request: task.spec.request, view: task.view, validation, semantic });
          const accepted = await acceptIndexerMainAuthorRunsStore({ projectRoot: root, runs: [{ workset_digest: workset.workset_digest, result }] });
          expect(accepted.outcomes).toMatchObject([{ outcome: "accepted" }]);
        }
        await advanceCurrentIndexerLifecycle(root);
      }
      const candidates = await readCandidateRecords(root);
      for (const candidate of candidates) {
        const article = scenario.articles.find(article => article.title === candidate.review.title)!;
        expect(article).toBeDefined();
        for (const text of Object.values(article.slots)) expect(candidate.body).toContain(text);
        delivered.push({ type: article.type, key: article.key ?? article.type, path: candidate.path });
      }
      if (candidates.length) {
        await approveCandidates(root, candidates);
        await closeProjectWorkspace(root);
        await acceptStarterPackageTemplates({ projectRoot: root });
        await (await import("./workspaceVersionDelivery.fixture.js")).recordFixtureVersionIfRequired(root);
        await buildProjectPackages(root);
      }
      if ((await collectProjectStatus(root, { managed: true })).workflow.status === "complete") break;
      await advanceCurrentIndexerLifecycle(root);
    }
    expect(new Set(delivered.map(page => page.key))).toEqual(new Set(scenario.articles.map(article => article.key ?? article.type)));
    expect((await collectProjectStatus(root, { managed: true })).workflow.status).toBe("complete");
    if (options.organization) {
      const reading = (await readKnowledgeMap(root))!;
      expect(reading.entries.find(entry => entry.key === "reader-root")?.title).toBe(options.organization.accepted);
      const output = JSON.parse(await readFile(join(root, "dist/scenario-kb/context-knowledge-map.json"), "utf8"));
      expect(output.entries[0].title).toBe(options.organization.accepted);
      expect(output.entries[0].children).toHaveLength(scenario.articles.length);
      for (const entry of output.entries[0].children as Array<{ href?: string }>) {
        expect(entry.href?.startsWith("./")).toBe(true);
        const target = join(root, "dist/scenario-kb", decodeURIComponent(entry.href!.slice(2).split("#")[0]!));
        expect((await readFile(target, "utf8")).trim().length).toBeGreaterThan(0);
      }
      expect(await readFile(join(root, ".tmp/work-start-report.md"), "utf8")).toContain(options.organization.proposed);
      await buildProjectPackages(root);
      expect((await readKnowledgeMap(root))?.revision).toBe(reading.revision);
    }
    for (const page of delivered) {
      const article = scenario.articles.find(article => (article.key ?? article.type) === page.key)!;
      const markdown = await readFile(join(root, "knowledge", page.path), "utf8");
      expect(markdown).not.toContain("{{variable:");
      expect(markdown).toContain(path);
      if (article.symbols) {
        const otherSymbols = scenario.articles.flatMap(other => other.symbols ?? []).filter(symbol => !article.symbols!.includes(symbol));
        for (const symbol of otherSymbols) expect(markdown).not.toContain(`| ${symbol} |`);
        expect(markdown).toContain("## API");
        for (const [symbol, name] of article.apiRows ?? []) expect(markdown).toContain(`| ${symbol} | ${name} |`);
      }
    }
    if (process.env.CONTEXT_ARTICLE_SCENARIO_OUTPUT) {
      const output = resolve(process.env.CONTEXT_ARTICLE_SCENARIO_OUTPUT, scenario.id);
      await rm(output, { recursive: true, force: true });
      await mkdir(output, { recursive: true });
      await cp(join(root, "knowledge"), join(output, "knowledge"), { recursive: true });
      await cp(join(root, "dist"), join(output, "dist"), { recursive: true });
      await writeFile(join(output, "receipt.json"), JSON.stringify({ scenario: scenario.id, profile: scenario.profile, delivered }, null, 2));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}
