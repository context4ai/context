import { readReadingStructure } from "../project/readingStructure.js";
import { adjustCurrentTaskSources } from "../project/taskSourceAdjustment.js";
import { join } from "node:path";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { expect, test } from "bun:test";
import { cp, readFile, writeFile, rm } from "node:fs/promises";
import { indexerAuthorSemanticInputSchema, type IndexerArticlePlan } from "@c4a/context";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { buildIndexerAuthorRunResultFromSemantic } from "../project/indexerSemanticAuthorResult.js";
import { acceptIndexerMainAuthorRunsStore } from "../project/indexerMainRunStore.js";

function plan(intents: string[], targets: string[]): IndexerArticlePlan[] {
  const intent = intents.find(value => value.endsWith("/content"))!;
  return ["overview", "integration"].map((key, index) => ({ key, title: key, reader_task: "Understand the public entry", artifact_intent: intent,
    template_id: index ? "component-library-l02" : "component-library-l05",
    required: true, sections: [{ key: "entry", heading: "Entry", required: true }], question_targets: index ? [] : targets }));
}

test("accepted multi-article plan keeps identities and shared member ownership through persisted Author acceptance", async () => {
  const root = await createDocumentRevisionWorkspace();
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entryPath = join(root, "src/index.ts");
    await writeFile(entryPath, (await readFile(entryPath, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", "packages: [kbPackage({ name: \"article-kb\", template: { path: \"src/package-templates/kb\", vars: {} } })]"));
    await completePartitionStage(root, false, false, undefined, plan);
    const review = (await currentIndexerStructureReview(root))!;
    const navigationTargets = review.preview.topics.flatMap(topic => topic.article_targets ?? []);
    expect(navigationTargets.length).toBeGreaterThan(0);
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved",
      reading_structure: { expected_revision: null, remove: [], upsert: [
        { key: "library", parent: null, title: "Components and adoption", order: 0 },
        ...navigationTargets.map((target, index) => ({ key: `entry-${index}`, parent: "library", title: target.article_key, order: index,
          target: { artifact_ref: target.artifact_ref, section_key: target.section_keys[0]! } })),
      ] } });
    expect(await readFile(join(root, "src/reading-structure.yaml"), "utf8")).toContain("Components and adoption");
    const current = (await resolveCurrentIndexerAgentContext(root))!;
    for (const descriptor of current.descriptor.tasks) {
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: descriptor.task_key });
    const workset = task.spec.request.workset;
    if (workset.stage !== "author") throw new Error("expected Author");
    const validation = task.spec.validation as Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"];
    const accepted = validation.page_plan!.articles!;
    expect(accepted.map(article => article.key)).toEqual(["overview", "integration"]);
    const guidance = task.spec.validation.article_guidance as Record<string, { template_id: string; content: string }>;
    expect(guidance.overview?.template_id).toBe("component-library-l05");
    expect(guidance.integration?.template_id).toBe("component-library-l02");
    expect(guidance.integration?.content).toContain("writing blueprint");
    expect(Object.keys(guidance).sort()).toEqual(["integration", "overview"]);
    const fact = task.view.items.find(item => item.category === "fact")!;
    const input = indexerAuthorSemanticInputSchema.parse({ stage: "author", group_key: workset.group_key, outcome: "publish", policy: "standard",
      articles: accepted.map(article => ({ key: article.key, title: article.title, summary: "Reference for the public entry.",
        sections: [{ key: "entry", heading: "Entry", markdown: "Use the exported entry.", facts: [fact.ref], answers: article.question_targets }] })),
      member_dispositions: validation.canonical_inventory_members.map(member => ({ item: member.member_id, state: "covered", article: "overview", section: "entry" })),
    });
    const build = (semantic = input) => buildIndexerAuthorRunResultFromSemantic({ request: task.spec.request, view: task.view, validation, semantic });
    for (const articles of [input.articles!.slice(0, 1), [...input.articles!, input.articles![0]!], [{ ...input.articles![0]!, key: "invented" }, input.articles![1]!]]) {
      expect(() => build({ ...input, articles })).toThrow();
    }
    expect(() => build({ ...input, articles: input.articles!.map(article => ({ ...article, sections: [{ ...article.sections[0]!, facts: ["fact:unavailable"] }] })) })).toThrow();
    const drift = build({ ...input, articles: input.articles!.map(article => article.key === "integration" ?
      { ...article, sections: article.sections.map(section => ({ ...section, key: "investigation" })) } : article) });
    if (drift.result.result.protocol !== "context.indexer.artifact-result/v1") throw new Error("expected ArtifactResult");
    expect(drift.result.result.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining(["article-outline-gap", "article-outline-drift"]));
    const result = build();
    expect(build()).toEqual(result);
    const output = result.result.result;
    if (output.protocol !== "context.indexer.artifact-result/v1") throw new Error("expected ArtifactResult");
    expect(output.artifacts.map(artifact => artifact.artifact_id)).toEqual(["overview", "integration"]);
    const keys = output.artifacts.flatMap(artifact => artifact.representation === "sections" ? artifact.sections.map(section => section.section_key) : []);
    expect(new Set(keys).size).toBe(keys.length);
    expect(output.inventory_dispositions.dispositions.length).toBe(validation.canonical_inventory_members.length);
    const response = await acceptIndexerMainAuthorRunsStore({ projectRoot: root, runs: [{ workset_digest: workset.workset_digest, result }] });
    expect(response.outcomes.map(outcome => outcome.outcome)).toEqual(["accepted"]);
    }
    await advanceCurrentIndexerLifecycle(root);
    const candidates = await readCandidateRecords(root);
    expect(candidates.length).toBe(current.descriptor.tasks.length * 2);
    expect(new Set(candidates.map(candidate => candidate.path)).size).toBe(candidates.length);
    await approveCandidates(root, candidates);
    await closeProjectWorkspace(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    const built = await buildProjectPackages(root);
    expect(built.packages[0]!.files).toBeGreaterThan(candidates.length);
    const navigation = JSON.parse(await readFile(join(root, "dist/article-kb/context-reading-structure.json"), "utf8"));
    expect(navigation.warnings).toEqual([]);
    expect(navigation.entries[0].children.length).toBe(navigationTargets.length);
    expect(await readFile(join(root, "dist/article-kb/index.md"), "utf8")).toContain("Components and adoption");
    for (const candidate of candidates) {
      expect(await readFile(join(root, "knowledge", candidate.path), "utf8")).toContain("Use the exported entry.");
      expect(await readFile(join(root, "dist/article-kb/wikis", candidate.path), "utf8")).toContain("Use the exported entry.");
    }
    for (const child of navigation.entries[0].children) {
      const [path, anchor] = child.href.split("#");
      expect(await readFile(join(root, "dist/article-kb", decodeURIComponent(path)), "utf8")).toContain(`<a id="${anchor}"></a>`);
    }
    const originalBodies = await Promise.all(candidates.map(candidate => readFile(join(root, "knowledge", candidate.path), "utf8")));
    const reading = (await readReadingStructure(root))!;
    const library = reading.entries.find(entry => entry.key === "library")!;
    await adjustCurrentTaskSources(root, { reading_structure: { expected_revision: reading.revision,
      upsert: [{ ...library, title: "Adoption by reader task" }], remove: [] } });
    const renamed = await buildProjectPackages(root);
    expect(renamed.packages[0]!.state).toBe("updated");
    expect(await readFile(join(root, "dist/article-kb/index.md"), "utf8")).toContain("Adoption by reader task");
    expect(await Promise.all(candidates.map(candidate => readFile(join(root, "knowledge", candidate.path), "utf8")))).toEqual(originalBodies);
    expect((await buildProjectPackages(root)).packages[0]!.state).toBe("unchanged");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
