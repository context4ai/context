import { validateProjectIndexerMainRun } from "../project/indexerMainRunValidationActions.js";
import { expect, test } from "bun:test";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalIndexerNodeRef, indexerArtifactRef, indexerAuthorSemanticInputSchema } from "@c4a/context";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "../project/indexerStructureReview.js";
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
import { approvedKnowledgeDependencyWarnings } from "../project/approvedKnowledgeDependencyWarnings.js";
import { readKnowledgeStructure } from "../project/packageBuildInventory.js";
import { approvedKnowledgeSnapshotsFromStructure } from "../project/approvedKnowledgeSnapshots.js";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { readApprovedRevision } from "../project/approvedRevision.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { adjustCurrentTaskSources } from "../project/taskSourceAdjustment.js";
import { readApprovedKnowledgeInput } from "../project/approvedKnowledgeInput.js";

test("a required cross-topic article waits for approval, receives supporting facts and completes through the existing Author workflow", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 3 });
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entry = join(root, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "knowledge-dependencies", template: { path: "src/package-templates/kb", vars: {} } })]'));
    let upstream: string | undefined;
    const producerRefs: string[] = [];
    await completePartitionStage(root, false, false, undefined, (intents, targets, subject) => {
      const intent = intents.find(value => value.endsWith("/content"))!;
      const ref = indexerArtifactRef(canonicalIndexerNodeRef(subject), { artifact_id: "overview", artifact_kind: "content" });
      const dependencies = producerRefs.length >= 2 ? [{ artifact_ref: upstream!, required: true, section_refs: [] }] : [];
      if (producerRefs.length < 2) producerRefs.push(ref);
      upstream ??= ref;
      return [{ key: "overview", title: "Public entry", reader_task: "Locate the public entry and its supporting capability",
        required: true, artifact_intent: intent, sections: [{ key: "entry", heading: "Entry", required: true }], question_targets: targets,
        knowledge_dependencies: dependencies }];
    });
    let waves = 0, supportingFacts = 0;
    for (; waves < 3; waves++) {
      const structure = await currentIndexerStructureReview(root);
      if (!structure) break;
      if (!waves) {
        expect(structure.preview.topics).toHaveLength(2);
        expect(structure.preview.pending_knowledge).toHaveLength(1);
      }
      await completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "approved" });
      const current = (await resolveCurrentIndexerAgentContext(root))!;
      expect(current.descriptor.stage).toBe("author");
      for (const descriptor of current.descriptor.tasks) {
        const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: descriptor.task_key });
        const workset = task.spec.request.workset;
        if (workset.stage !== "author") throw new Error("expected Author");
        const validation = task.spec.validation as Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"];
        const facts = task.view.items.filter(item => item.category === "fact" || item.category === "supporting-fact");
        supportingFacts += task.view.items.filter(item => item.category === "supporting-fact").length;
        if (waves) expect(task.view.items.some(item => item.category === "approved-interpretation")).toBe(true);
        const semantic = indexerAuthorSemanticInputSchema.parse({ stage: "author", group_key: workset.group_key,
          outcome: "publish", policy: "standard", target_resolutions: (workset.target_resolution_view?.entries ?? []).map(entry => ({
            target: entry.query_ref, disposition: entry.state === "resolved" ? "reuse-existing" : "create-independent" })),
          articles: validation.page_plan!.articles!.map(article => ({ key: article.key, title: article.title, summary: article.reader_task,
            sections: [{ key: "entry", heading: "Entry", markdown: "Follow the exported source entry and its approved supporting capability.",
              facts: facts.map(fact => fact.ref), answers: article.question_targets }] })),
          member_dispositions: validation.canonical_inventory_members.map(member => ({ item: member.member_id, state: "covered", article: "overview", section: "entry" })),
        });
        const result = buildIndexerAuthorRunResultFromSemantic({ request: task.spec.request, view: task.view, validation, semantic });
        const descriptors = task.spec.validation.supplementary_sources as Array<{ source_binding_digest: string }> | undefined;
        if (descriptors?.length) {
          const stale = structuredClone(task.spec.validation);
          (stale.supplementary_sources as Array<{ source_binding_digest: string }>)[0]!.source_binding_digest = `sha256:${"0".repeat(64)}`;
          await expect(validateProjectIndexerMainRun({ projectRoot: root, value: {
            protocol: "context.indexer.main-run-validation-input/v1", request: task.spec.request, result, validation: stale,
          } })).rejects.toThrow("supplementary source binding is stale");
        }
        const accepted = await acceptIndexerMainAuthorRunsStore({ projectRoot: root, runs: [{ workset_digest: workset.workset_digest, result }] });
        expect(accepted.outcomes).toMatchObject([{ outcome: "accepted" }]);
      }
      await advanceCurrentIndexerLifecycle(root);
      await approveCandidates(root, await readCandidateRecords(root));
      await closeProjectWorkspace(root);
      await acceptStarterPackageTemplates({ projectRoot: root });
      await buildProjectPackages(root);
      if ((await collectProjectStatus(root, { managed: true })).workflow.status === "complete") { waves++; break; }
      await advanceCurrentIndexerLifecycle(root);
    }
    expect(waves).toBe(2);
    expect(supportingFacts).toBeGreaterThan(0);
    expect((await collectProjectStatus(root, { managed: true })).workflow.status).toBe("complete");
    expect(await approvedKnowledgeDependencyWarnings(root)).toEqual([]);
    const snapshots = approvedKnowledgeSnapshotsFromStructure((await readKnowledgeStructure(root)).parsed);
    const producer = snapshots.find(snapshot => snapshot.artifact_ref === upstream)!;
    const consumer = snapshots.find(snapshot => snapshot.dependencies.some(dependency => dependency.artifact_ref === upstream))!;
    expect(consumer.dependency_versions?.[0]?.approved_content_digest).toBe(producer.approved_content_digest);
    const producerPath = join(root, "knowledge", producer.path);
    await beginDocumentRevision({ projectRoot: root, selector: producer.path, instruction: "Clarify the public entry wording without changing source facts." });
    const revision = (await readApprovedRevision(root))!;
    const route = (await collectProjectStatus(root, { managed: true })).workflow.current!;
    await completeCurrentIndexerAction({ cwd: root, revision: route.revision, managed: true,
      value: { stage: "approved-revision", markdown: revision.target.markdown.replace("Follow the exported source entry", "Follow the documented source entry") } });
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    const revisedProducer = approvedKnowledgeSnapshotsFromStructure((await readKnowledgeStructure(root)).parsed).find(snapshot => snapshot.artifact_ref === upstream)!;
    expect(revisedProducer.source_versions).toEqual(producer.source_versions);
    expect(revisedProducer.facts).toEqual(producer.facts);
    expect(revisedProducer.approved_content_digest).not.toBe(producer.approved_content_digest);
    expect(revisedProducer.sections.some(section => section.markdown.includes("documented source entry"))).toBe(true);
    expect(await approvedKnowledgeDependencyWarnings(root)).toMatchObject([{ severity: "warning", path: consumer.path }]);
    expect(await readApprovedKnowledgeInput({ projectRoot: root, dependencies: [{ artifact_ref: consumer.artifact_ref, required: true, section_refs: [] }],
      subject_key: { ...consumer.subject_key, local_key: "third-level" }, authorized_targets: [], bindings: [], evidence_kinds: new Set(["code"]) }))
      .toMatchObject({ status: "waiting", pending: [{ reason: "approval-changed" }] });
    const approvedConsumer = await readFile(join(root, "knowledge", consumer.path), "utf8");
    await buildProjectPackages(root);
    const consumerOutput = join(root, "dist/knowledge-dependencies/wikis", consumer.path);
    expect(await readFile(consumerOutput, "utf8")).toContain("Supporting knowledge needs review");
    expect(await readFile(join(root, "knowledge", consumer.path), "utf8")).toBe(approvedConsumer);
    await buildProjectPackages(root);
    expect(await readFile(consumerOutput, "utf8")).toContain("Supporting knowledge needs review");
    await beginDocumentRevision({ projectRoot: root, selector: consumer.path, instruction: "Recheck the integration against the approved upstream clarification." });
    const consumerRevision = (await readApprovedRevision(root))!;
    expect(consumerRevision.knowledge_input?.status).toBe("ready");
    expect(consumerRevision.knowledge_input?.reading_sections.some(section => section.markdown.includes("documented source entry"))).toBe(true);
    expect(consumerRevision.knowledge_input?.versions[0]?.approved_content_digest).toBe(revisedProducer.approved_content_digest);
    const consumerRoute = (await collectProjectStatus(root, { managed: true })).workflow.current!;
    // Rechecking may legitimately confirm the same wording. It still needs
    // Review to accept a different supporting version.
    await completeCurrentIndexerAction({ cwd: root, revision: consumerRoute.revision, managed: true,
      value: { stage: "approved-revision", markdown: consumerRevision.target.markdown } });
    expect(await readCandidateRecords(root)).toHaveLength(1);
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    await buildProjectPackages(root);
    expect(await approvedKnowledgeDependencyWarnings(root)).toEqual([]);
    expect(await readFile(consumerOutput, "utf8")).not.toContain("Supporting knowledge needs review");
    const refreshedConsumer = approvedKnowledgeSnapshotsFromStructure((await readKnowledgeStructure(root)).parsed).find(snapshot => snapshot.artifact_ref === consumer.artifact_ref)!;
    expect(refreshedConsumer.dependency_versions?.[0]?.approved_content_digest).toBe(revisedProducer.approved_content_digest);
    await writeFile(producerPath, (await readFile(producerPath, "utf8")) + "\nAn upstream clarification requires rechecking this integration.\n");
    expect(await approvedKnowledgeDependencyWarnings(root)).toMatchObject([{ severity: "warning", path: consumer.path, code: "approved-knowledge-dependency-stale" }]);
    await rm(producerPath);
    expect(await approvedKnowledgeDependencyWarnings(root)).toMatchObject([{ severity: "warning", path: consumer.path }]);
    // A removed or split upstream can be replaced through the existing task,
    // using approved identities and explicit section evidence, without editing
    // the persisted dependency graph or silently approving the consumer.
    await beginDocumentRevision({ projectRoot: root, selector: consumer.path, instruction: "Replace the unavailable upstream with the remaining approved capability." });
    const beforeReplacement = await readFile(join(root, "knowledge", consumer.path), "utf8");
    await expect(adjustCurrentTaskSources(root, { knowledge_dependencies: {
      dependencies: [{ artifact_ref: consumer.artifact_ref, required: true, section_refs: [] }],
    }, instruction: "Invalid self dependency" })).rejects.toThrow("cycle");
    const dependencies = [{ artifact_ref: producerRefs[1]!, required: true, section_refs: [] }];
    await adjustCurrentTaskSources(root, { knowledge_dependencies: { dependencies }, instruction: "Read replacement support before binding sections." });
    const selected = (await readApprovedRevision(root))!;
    expect(selected.knowledge_input?.status).toBe("ready");
    expect(selected.knowledge_input?.reading_sections.every(section => section.artifact_ref === producerRefs[1])).toBe(true);
    expect(await readFile(join(root, "knowledge", consumer.path), "utf8")).toBe(beforeReplacement);
    const selectionRoute = (await collectProjectStatus(root, { managed: true })).workflow.current!;
    await expect(completeCurrentIndexerAction({ cwd: root, revision: selectionRoute.revision, managed: true,
      value: { stage: "approved-revision", markdown: selected.target.markdown } })).rejects.toThrow("knowledge_dependencies.sections");
    const sections = refreshedConsumer.sections.map(section => ({ section_key: section.section_key!,
      fact_refs: selected.knowledge_input!.facts.map(fact => fact.fact_ref),
      evidence_refs: selected.knowledge_input!.evidence_bindings.map(binding => binding.evidence_ref) }));
    await expect(adjustCurrentTaskSources(root, { knowledge_dependencies: { dependencies,
      sections: sections.map(section => ({ ...section, fact_refs: ["fact:unavailable"] })) }, instruction: "Invalid support" })).rejects.toThrow("unavailable fact");
    await adjustCurrentTaskSources(root, { knowledge_dependencies: { dependencies, sections }, instruction: "Use the remaining capability as the revised source entry." });
    const replacement = (await readApprovedRevision(root))!;
    const replacementRoute = (await collectProjectStatus(root, { managed: true })).workflow.current!;
    await completeCurrentIndexerAction({ cwd: root, revision: replacementRoute.revision, managed: true,
      value: { stage: "approved-revision", markdown: replacement.target.markdown.replace("supporting capability", "replacement capability") } });
    expect(await readFile(join(root, "knowledge", consumer.path), "utf8")).toBe(beforeReplacement);
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    await buildProjectPackages(root);
    const rebound = approvedKnowledgeSnapshotsFromStructure((await readKnowledgeStructure(root)).parsed).find(snapshot => snapshot.artifact_ref === consumer.artifact_ref)!;
    expect(rebound.dependencies).toEqual(dependencies);
    expect(rebound.dependency_versions?.map(version => version.artifact_ref)).toEqual([producerRefs[1]!]);
    expect(await approvedKnowledgeDependencyWarnings(root)).toEqual([]);
    expect(await readFile(consumerOutput, "utf8")).not.toContain("Supporting knowledge needs review");

  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);

test("an absent required dependency keeps a concrete planning adjustment instead of closing an empty wave", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    await completePartitionStage(root, false, false, undefined, (intents, targets) => [{ key: "overview", title: "Integration", reader_task: "Find the missing upstream entry",
      artifact_intent: intents.find(intent => intent.endsWith("/content"))!, required: true,
      sections: [{ key: "entry", heading: "Entry", required: true }], question_targets: targets,
      knowledge_dependencies: [{ artifact_ref: "artifact:missing-upstream", section_refs: [], required: true }] }]);
    const structure = (await currentIndexerStructureReview(root))!;
    expect(structure.preview.topics).toHaveLength(1);
    expect(structure.preview.pending_knowledge?.[0]?.dependencies).toMatchObject([{ artifact_ref: "artifact:missing-upstream", reason: "not-approved" }]);
    await expect(completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "approved" })).rejects.toThrow("request-adjustment");
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "request-adjustment",
      feedback: "Plan an authorized upstream entry first, or remove this unsupported dependency and retain only the evidence-backed entry." });
    expect((await collectProjectStatus(root, { managed: true })).workflow.current?.node).toBe("advance-current-indexer-lifecycle");
    await advanceCurrentIndexerLifecycle(root);
    const next = (await resolveCurrentIndexerAgentContext(root))!;
    expect(next.descriptor.stage).toBe("partition");
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: next.descriptor, taskKey: next.descriptor.tasks[0]!.task_key });
    expect(task.view.items.some(item => item.category === "revision-feedback")).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
