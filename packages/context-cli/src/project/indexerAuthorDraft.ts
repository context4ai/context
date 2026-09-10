import { inheritAuthorTaskGroup } from "./indexerAuthorTaskDefaults.js";
import { ZodError } from "zod";
import { scaffoldAuthorTask } from "./indexerAuthorScaffold.js";
import { indexerAgentStepInputSchema, indexerAuthorSemanticInputSchema, materializeIndexerStructuredContent, validateAndRecordIndexerMainRun } from "@c4a/context";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { loadCurrentIndexerBatchTask, type CurrentIndexerBatchDescriptor } from "./indexerCurrentBatch.js";
import { resolveCurrentIndexerAgentContext } from "./indexerCurrentWorkflowRoute.js";
import { assertCurrentIndexerBatchRevision } from "./indexerBatchRevision.js";
import { contextWorkflowAuthorities } from "./workflow/workflowFacts.js";
import { prepareIndexerAuthorSubmission } from "./indexerAuthorSubmission.js";
import type { ContextWorkflowAuthority } from "./workflow/workflowTypes.js";

export async function scaffoldCurrentAuthor(input: { projectRoot: string; revision: string;
  managed?: boolean; authorities?: readonly ContextWorkflowAuthority[] }) {
  const route = await assertCurrentIndexerBatchRevision({ projectRoot: input.projectRoot, expectedRevision: input.revision,
    managed: input.managed === true, authorities: contextWorkflowAuthorities({ managed: input.managed === true,
      ...(input.authorities ? { authorities: input.authorities } : {}) }) });
  const selected = indexerAgentStepInputSchema.safeParse(route.action?.input);
  if (!selected.success || selected.data.stage !== "author") throw new TypeError("scaffold-current requires the active Author Route; follow the current Route instead");
  const current = await resolveCurrentIndexerAgentContext(input.projectRoot);
  if (current?.descriptor.stage !== "author") throw new TypeError("scaffold-current supports the current Author Route only; follow the current Route for other stages");
  const results = [];
  for (const task of current.descriptor.tasks) results.push(scaffoldAuthorTask(await loadCurrentIndexerBatchTask({
    projectRoot: input.projectRoot, descriptor: current.descriptor, taskKey: task.task_key,
  })));
  return { stage: "author", results };
}

type AuthorInputIssue = {
  path: (string | number)[]; code: string; message: string;
  section_key?: string; member_id?: string;
};

function inputIssues(error: ZodError, result: unknown): AuthorInputIssue[] {
  const root = result && typeof result === "object" ? result as Record<string, unknown> : undefined;
  const branchIssues = error.issues.flatMap(issue => {
    if (issue.code !== "invalid_union" || issue.path.length !== 0 || root === undefined) return [issue];
    // Preserve field-level recovery guidance for both supported Author forms.
    // Choose the explicit shape, never a branch based on prose or quality.
    const branch = root.outcome === "publish" ? (Array.isArray(root.articles) ? 1 : 0)
      : root.outcome === "catalog-only" ? 2 : root.outcome === "request-material" ? 3
      : root.outcome === "unsupported" ? 4 : undefined;
    return branch === undefined ? [issue] : issue.unionErrors[branch]?.issues ?? [issue];
  });
  const issues = branchIssues.flatMap(issue => {
    // This union accepts either an item or an items group. Select only the
    // explicitly supplied form; ambiguous input keeps the original union error.
    if (issue.code !== "invalid_union" || issue.path[0] !== "member_dispositions") return [issue];
    const entries = result && typeof result === "object" ? (result as Record<string, unknown>).member_dispositions : undefined;
    const entry = Array.isArray(entries) && typeof issue.path[1] === "number" ? entries[issue.path[1]] : undefined;
    if (!entry || typeof entry !== "object" || ("item" in entry) === ("items" in entry)) return [issue];
    return issue.unionErrors["item" in entry ? 0 : 1]?.issues ?? [issue];
  });
  return issues.map(issue => {
    const path = issue.path;
    const collection = root && typeof root === "object" ? root[String(path[0])] : undefined;
    const row = Array.isArray(collection) && typeof path[1] === "number" ? collection[path[1]] : undefined;
    const articleSection = path[0] === "articles" && path[2] === "sections" && Array.isArray(row?.sections)
      && typeof path[3] === "number" ? row.sections[path[3]] : undefined;
    return { path: ["result", ...path], code: issue.code, message: issue.message,
      ...(path[0] === "sections" && typeof row?.key === "string" ? { section_key: row.key } : {}),
      ...(typeof articleSection?.key === "string" ? { section_key: articleSection.key } : {}),
      ...(path[0] === "member_dispositions" && typeof row?.item === "string" ? { member_id: row.item } : {}),
    };
  });
}

/** The same converter and SDK validator used on acceptance, without persisting
 * source expansion, accepted receipts, semantic output or advancing the Route. */
export async function previewAuthorBatch(input: { projectRoot: string; revision: string;
  descriptor: CurrentIndexerBatchDescriptor; results: readonly { task_key: string; result?: unknown }[] }) {
  const outcomes: { task_key: string; outcome: string; message?: string; issues?: AuthorInputIssue[]; pages?: { path: string; bytes: number }[] }[] = [];
  const counts = new Map<string, number>();
  for (const row of input.results) counts.set(row.task_key, (counts.get(row.task_key) ?? 0) + 1);
  for (const row of input.results) {
    let inputValidated = false;
    try {
      if (counts.get(row.task_key) !== 1) throw new TypeError("duplicate task key");
      const task = await loadCurrentIndexerBatchTask({ projectRoot: input.projectRoot,
        descriptor: input.descriptor, taskKey: row.task_key });
      const semantic = indexerAuthorSemanticInputSchema.parse(inheritAuthorTaskGroup(row.result, task));
      inputValidated = true;
      if (semantic.outcome === "request-material") throw new TypeError("Material requests require the normal completion command; preview does not expand a task");
      const prepared = await prepareIndexerAuthorSubmission({ projectRoot: input.projectRoot, task, semantic, preview: true });
      validateAndRecordIndexerMainRun({ request: prepared.task.spec.request, result: prepared.result,
        validation: prepared.task.spec.validation as unknown as Parameters<typeof validateAndRecordIndexerMainRun>[0]["validation"] });
      const result = prepared.result.result.result;
      const pages = [];
      if (result.protocol === "context.indexer.artifact-result/v1") {
        for (const artifact of result.artifacts) {
          if (artifact.representation !== "sections") continue;
          const markdown = artifact.sections.flatMap(section => materializeIndexerStructuredContent({
            blocks: section.blocks, facts: result.facts,
          }).map(block => block.markdown)).join("\n\n") + "\n";
          const digest = createHash("sha256").update(markdown).digest("hex");
          const path = join(input.projectRoot, ".tmp/context-runtime/author-previews", `${digest}.md`);
          await atomicWriteFile(path, markdown);
          pages.push({ path, bytes: Buffer.byteLength(markdown) });
        }
      }
      outcomes.push({ task_key: row.task_key, outcome: "valid", pages });
    } catch (error) {
      outcomes.push({ task_key: row.task_key, outcome: "failed", message: error instanceof Error ? error.message : String(error),
        ...(!inputValidated && error instanceof ZodError ? { issues: inputIssues(error, row.result) } : {}) });
    }
  }
  for (const task of input.descriptor.tasks) if (!counts.has(task.task_key)) outcomes.push({ task_key: task.task_key, outcome: "missing" });
  return { protocol: "context.author.preview/v1", revision: input.revision, revision_advanced: false,
    committed_count: 0, valid: outcomes.every(item => item.outcome === "valid"), validation_results: outcomes };
}
