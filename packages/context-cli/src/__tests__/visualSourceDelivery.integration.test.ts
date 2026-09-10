import { walkMarkdown } from "../project/verifyProjectFiles.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { expect, test } from "bun:test";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captureFile, source, indexerAuthorSemanticInputSchema } from "@c4a/context";
import { createArticleDocumentWorkspace } from "./articleDocumentWorkspace.fixture.js";
import { completePartitionStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { runCaptureFilePhase } from "../project/documentCapture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { buildIndexerAuthorRunResultFromSemantic } from "../project/indexerSemanticAuthorResult.js";
import { acceptIndexerMainAuthorRunsStore } from "../project/indexerMainRunStore.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { visualResourcesFromView, readVisualReceipts, approvedVisualResults } from "../project/visualSourceProcessing.js";

test("captured image reaches Author, survives selected template and Review, and ships Mermaid without image", async () => {
  const root = await createArticleDocumentWorkspace({ id: "visual-delivery", sourceType: "file", profile: "domain-reference",
    source: "# Request flow\n\nRequest then reply.\n", articles: [{ type: "c01", title: "Request flow", task: "Understand request flow", slots: { scope: "Request then reply." } }] }, ["understand-domain"]);
  try {
    await mkdir(join(root, "source-documents/assets"));
    await writeFile(join(root, "source-documents/assets/flow.png"), Buffer.from("anonymous-image-fixture"));
    await writeFile(join(root, "source-documents/manual.md"), "# Request flow\n\nRequest then reply.\n\n![Flow](assets/flow.png)\n");
    await runCaptureFilePhase({ projectRoot: root, phase: captureFile({ source: source("20260903/manual", { type: "file" }) }) });
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entry = join(root, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({name: "visual-kb", template: {path: "src/package-templates/kb", vars: {}}})]'));
    await completePartitionStage(root, false, false, undefined, (intents, targets) => [{ key: "flow", title: "Request flow",
      reader_task: "Understand request flow", artifact_intent: intents.find(intent => intent.includes("/understand-domain/") && intent.endsWith("/content"))!,
      template_id: "domain-reference-c01-page", required: true, question_targets: targets,
      sections: [{ key: "scope", heading: "Scope", required: false }] }], undefined, undefined, "reader-subject");
    const review = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved" });
    const current = (await resolveCurrentIndexerAgentContext(root))!;
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: current.descriptor.tasks[0]!.task_key });
    const workset = task.spec.request.workset;
    if (workset.stage !== "author") throw new Error("Expected Author");
    const validation = task.spec.validation as Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"];
    const visuals = visualResourcesFromView(task.view);
    expect(visuals).toHaveLength(1);
    const document = task.view.items.find(item => item.category === "document")!;
    const semantic = indexerAuthorSemanticInputSchema.parse({ stage: "author", group_key: workset.group_key, outcome: "publish", policy: "standard",
      articles: [{ key: "flow", title: "Request flow", summary: "A documented request and reply.", sections: [{ key: "scope", heading: "Scope",
        markdown: "The source defines request then reply.", source_items: [document.ref], answers: validation.page_plan!.articles![0]!.question_targets,
        visuals: [{ resource: visuals[0]!.ref, context: ["Request then reply."], requirements: "English; flow", disposition: "converted", format: "mermaid",
          markdown: "```mermaid\nflowchart LR\n Client --> Service\n Service --> Client\n```" }] }],
        template_variables: { scope: { value: `Read the documented flow.\n\n${visuals[0]!.original_markdown}`, source_items: [document.ref] } } }],
      member_dispositions: validation.canonical_inventory_members.map(member => ({ item: member.member_id, state: "covered", article: "flow", section: "scope" })) });
    const result = buildIndexerAuthorRunResultFromSemantic({ request: task.spec.request, view: task.view, validation, semantic });
    const accepted = await acceptIndexerMainAuthorRunsStore({ projectRoot: root, runs: [{ workset_digest: workset.workset_digest, result }] });
    expect(accepted.outcomes[0]?.outcome).toBe("accepted");
    await advanceCurrentIndexerLifecycle(root);
    const candidates = await readCandidateRecords(root);
    expect(candidates).toHaveLength(1);
    await approveCandidates(root, candidates);
    await closeProjectWorkspace(root);
    const content = await readFile(join(root, "knowledge", candidates[0]!.path), "utf8");
    expect(content).toContain("```mermaid");
    expect(content).not.toContain("![");
    expect(readVisualReceipts(content)).toHaveLength(1);
    expect(await approvedVisualResults(root)).toHaveLength(1);
    await acceptStarterPackageTemplates({ projectRoot: root });
    const built = await buildProjectPackages(root);
    expect(built.packages).toHaveLength(1);
    const pages = await walkMarkdown(join(root, "dist/visual-kb"));
    const outputs = await Promise.all(pages.map(page => readFile(page.absPath, "utf8")));
    expect(outputs.some(page => page.includes("```mermaid"))).toBe(true);
    expect(outputs.join("\n")).not.toContain("context:visual");
    expect(outputs.join("\n")).not.toContain("![Source resource]");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
