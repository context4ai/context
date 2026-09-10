import { expect, test } from "bun:test";
import { readFile, realpath, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { indexerAuthorSemanticInputSchema } from "@c4a/context";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { resolveCurrentIndexerAgentContext, resolveCurrentIndexerWorkflowRoute } from "../project/indexerCurrentWorkflowRoute.js";
import { scaffoldCurrentAuthor } from "../project/indexerAuthorDraft.js";
import { scaffoldAuthorTask } from "../project/indexerAuthorScaffold.js";
import { ContextError } from "../lib/errors.js";
import { createHash } from "node:crypto";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { CONTEXT_WORKFLOW_AUTHORITIES } from "../project/workflow/workflowTypes.js";

test("Author grouped draft validates without changing acceptance, then commits through the same Route", async () => {
  const root = await realpath(await createDocumentRevisionWorkspace());
  const authorities = Object.values(CONTEXT_WORKFLOW_AUTHORITIES);
  try {
    await completePartitionStage(root, true);
    const review = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved" });
    const current = (await resolveCurrentIndexerAgentContext(root))!;
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: current.descriptor.tasks[0]!.task_key });
    const draft = scaffoldAuthorTask(task);
    expect(indexerAuthorSemanticInputSchema.safeParse(draft.result).success).toBe(false);
    expect(draft.result.member_dispositions.map(item => item.item)).toEqual((task.spec.validation.canonical_inventory_members as { member_id: string }[]).map(member => member.member_id));
    const results = [];
    for (const descriptor of current.descriptor.tasks) {
      const selected = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: descriptor.task_key });
      const skeleton = scaffoldAuthorTask(selected);
      const validation = selected.spec.validation as { allowed_question_targets: { question_target_key: string }[] };
      const fact = selected.view.items.find(item => item.category === "fact")!;
      results.push({ task_key: skeleton.task_key, result: { ...skeleton.result,
        title: "Public entry", summary: "Use the public entry.",
        sections: [{ key: "overview", heading: "Overview", markdown: "Use the exported entry.", facts: [fact.ref], answers: validation.allowed_question_targets.map(target => target.question_target_key) }],
        member_dispositions: [{ items: skeleton.result.member_dispositions.map(item => item.item), state: "covered", section: "overview" }],
      } });
    }
    const value = { stage: "author", results };
    const route = (await resolveCurrentIndexerWorkflowRoute({ projectRoot: root, authorities, managed: true }))!;
    const before = JSON.stringify(await currentLedger(root));
    const scaffold = await scaffoldCurrentAuthor({ projectRoot: root, revision: route.revision, managed: true, authorities });
    expect(scaffold.results[0]).toEqual(draft);
    const resource = route.resources.recommended.find(item => item.id === "indexer-author-scaffold")!;
    expect(resource).toBeDefined();
    const scaffoldText = await readFile(resource.path!, "utf8");
    expect(JSON.parse(scaffoldText)).toEqual({ stage: "author", results: scaffold.results });
    expect(resource.revision).toBe(route.revision);
    expect(resource.digest).toBe(`sha256:${createHash("sha256").update(scaffoldText).digest("hex")}`);
    const repeated = (await resolveCurrentIndexerWorkflowRoute({ projectRoot: root, authorities, managed: true }))!;
    expect(repeated.resources.recommended.find(item => item.id === resource.id)).toEqual(resource);
    const binary = join(import.meta.dir, "../../dist/cli.js");
    const cli = await promisify(execFile)("node", [binary,
      ...authorities.flatMap(authority => ["--workflow-authority", authority]),
      "action", "scaffold-current", "--revision", route.revision, "--managed", "--format", "json"],
      { cwd: root, env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, maxBuffer: 1024 * 1024 });
    expect(JSON.parse(cli.stdout)).toEqual(scaffold);
    await expect(scaffoldCurrentAuthor({ projectRoot: root, revision: "sha256:wrong", managed: true, authorities })).rejects.toThrow();
    try {
      await scaffoldCurrentAuthor({ projectRoot: root, revision: `sha256:${"0".repeat(64)}`, managed: true, authorities });
      throw new Error("Expected stale revision");
    } catch (error) {
      if (!(error instanceof ContextError)) throw error;
      const action = error.detail?.next_action as { cwd: string; command: string };
      expect(action.cwd).toBe(root);
      const args = action.command.match(/'[^']*'|\S+/gu)!.slice(1).map(arg => arg.replace(/^'|'$/gu, ""));
      const refreshed = await promisify(execFile)("node", [binary, ...args], {
        cwd: action.cwd, env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, maxBuffer: 4 * 1024 * 1024,
      });
      expect(JSON.parse(refreshed.stdout)).toBeDefined();
      expect(JSON.stringify(await currentLedger(root))).toBe(before);
    }
    const preview = await completeCurrentIndexerAction({ cwd: root, revision: route.revision, managed: true, authorities, value, preview: true });
    if (!("validation_results" in preview)) throw new Error("Expected Author preview");
    expect(preview).toMatchObject({ valid: true });
    expect(preview.committed_count).toBe(0);
    for (const outcome of preview.validation_results) {
      expect(outcome.pages?.length).toBeGreaterThan(0);
      for (const page of outcome.pages ?? []) {
        const text = await readFile(page.path, "utf8");
        expect(text).toContain("Use the exported entry.");
        expect(Buffer.byteLength(text)).toBe(page.bytes);
        expect(text).not.toContain("evidence_refs");
      }
    }
    expect(JSON.stringify(await currentLedger(root))).toBe(before);
    expect((await resolveCurrentIndexerWorkflowRoute({ projectRoot: root, authorities, managed: true }))!.revision).toBe(route.revision);
    const files = (task.spec.validation.source_identity_inventory as { files: { normalized_path: string }[] }).files;
    const additionalPath = files.some(file => file.normalized_path === "src/index.ts") ? "src/secondary.ts" : "src/index.ts";
    const expanded = { ...value, results: value.results.map((row, index) => index !== 0 ? row : {
      ...row, result: { ...row.result, sections: row.result.sections.map(section => ({ ...section, source_items: [additionalPath] })) },
    }) };
    const materialPreview = await completeCurrentIndexerAction({ cwd: root, revision: route.revision, managed: true, authorities, value: expanded, preview: true });
    expect(materialPreview).toMatchObject({ valid: true, committed_count: 0 });
    expect(JSON.stringify(await currentLedger(root))).toBe(before);
    expect((await resolveCurrentIndexerWorkflowRoute({ projectRoot: root, authorities, managed: true }))!.revision).toBe(route.revision);
    const malformed = JSON.parse(JSON.stringify(value));
    malformed.results[0].result.sections[0].facts = [42];
    malformed.results[0].result.member_dispositions = [
      { item: draft.result.member_dispositions[0]!.item, state: "invalid-state" },
      { items: [draft.result.member_dispositions[0]!.item], state: "invalid-state" },
      { state: "invalid-state" },
    ];
    const located = await completeCurrentIndexerAction({ cwd: root, revision: route.revision, managed: true, authorities, value: malformed, preview: true });
    if (!("validation_results" in located)) throw new Error("Expected preview diagnostics");
    expect(located).toMatchObject({ valid: false, committed_count: 0, revision_advanced: false });
    const failure = located.validation_results.find(item => item.task_key === draft.task_key)!;
    expect(failure.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["result", "sections", 0, "facts", 0], section_key: "overview" }),
      expect.objectContaining({ path: ["result", "member_dispositions", 0, "state"], member_id: draft.result.member_dispositions[0]!.item }),
      expect.objectContaining({ path: ["result", "member_dispositions", 1, "state"] }),
      expect.objectContaining({ path: ["result", "member_dispositions", 2], code: "invalid_union" }),
    ]));
    expect(JSON.stringify(await currentLedger(root))).toBe(before);
    expect((await resolveCurrentIndexerWorkflowRoute({ projectRoot: root, authorities, managed: true }))!.revision).toBe(route.revision);
    const duplicate = structuredClone(value);
    duplicate.results[0]!.result.member_dispositions[0]!.items.push(draft.result.member_dispositions[0]!.item);
    const invalid = await completeCurrentIndexerAction({ cwd: root, revision: route.revision, managed: true, authorities, value: duplicate, preview: true });
    expect(invalid).toMatchObject({ valid: false, committed_count: 0 });
    expect(JSON.stringify(await currentLedger(root))).toBe(before);
    const complete = await completeCurrentIndexerAction({ cwd: root, revision: route.revision, managed: true, authorities, value });
    if (!("outcomes" in complete)) throw new Error("Expected committed batch outcomes");
    expect(complete.outcomes).toHaveLength(results.length);
    expect(complete.outcomes.every(outcome => outcome.outcome === "accepted" && outcome.committed)).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
