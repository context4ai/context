import { constants } from "node:fs";
import { readFile, access, stat } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { indexerProtocolDigest } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";
import { productionAgentDirectory } from "./productionSubmissionFiles.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { readApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import { productionApprovedTargetsIndex, readProductionArticleTarget } from "./productionArticleTarget.js";
import { withProductionFeedback } from "./productionFeedback.js";
import { dispatchProductionStage, validateProductionStage,
  productionCapabilitiesSchema, type ProductionCapabilities, type ProductionDispatch, type ProductionStage } from "./productionStage.js";

import { productionSourceSummaryMarkdown } from "./productionSourceSummary.js";

export const PRODUCTION_STAGES_ROOT = ".tmp/context-runtime/production-stages";
const CURRENT_PATH = join(PRODUCTION_STAGES_ROOT, "current.json");

export function productionStageDirectory(id: string): string {
  // The same path-safe identity rule protects both sides of the file protocol.
  productionAgentDirectory(id);
  return join(PRODUCTION_STAGES_ROOT, id);
}

async function readOptional(root: string, path: string): Promise<string | undefined> {
  const absolute = await safeProjectTarget(root, path);
  try { return await readFile(absolute, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** Continuation needs a readable navigation file, not its full body. Its
 * contents are prepared explicitly and consumed by the Agent, not redecoded
 * merely to issue another batch. Preserve missing/non-file/permission errors. */
async function hasReadableProjection(root: string, path: string): Promise<boolean> {
  const absolute = await safeProjectTarget(root, path);
  try {
    if (!(await stat(absolute)).isFile()) throw new TypeError(`Stage material must be a regular file: ${path}`);
    await access(absolute, constants.R_OK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Do not rewrite unchanged shared materials on every submission. */
export async function writeProductionProjection(root: string, path: string, content: string): Promise<boolean> {
  if (await readOptional(root, path) === content) return false;
  await atomicWriteFile(await safeProjectTarget(root, path), content);
  return true;
}

export async function readProductionStage(root: string, id?: string): Promise<ProductionStage | undefined> {
  return (await readProductionStageSnapshot(root, id))?.stage;
}

/** Bind a write baseline to the exact bytes which produced its validated state. */
export async function readProductionStageSnapshot(root: string, id?: string): Promise<{ stage: ProductionStage; content: string } | undefined> {
  const feedback = { operation: "stage-read", file: CURRENT_PATH,
    recovery: "Inspect the reported temporary file and restore this run's intact local state before querying again. Do not reconstruct process state from Git or automatically delete accepted drafts; if local state is lost, start a new production run." };
  return withProductionFeedback(feedback, async () => {
  if (id === undefined) {
    const current = await readOptional(root, CURRENT_PATH);
    if (current === undefined) return undefined;
    const value: unknown = JSON.parse(current);
    if (!value || typeof value !== "object" || !("stage" in value) || typeof value.stage !== "string") {
      throw new TypeError("Invalid current production stage pointer; re-enter the workspace to inspect its temporary state");
    }
    id = value.stage;
  }
  feedback.file = join(productionStageDirectory(id), "manifest.json");
  const content = await readOptional(root, feedback.file);
  if (content === undefined) return undefined;
  const stage = validateProductionStage(JSON.parse(content));
  if (stage.id !== id) throw new TypeError("Production stage directory and manifest identity disagree");
  return { stage, content };
  });
}

/** The manifest is the one temporary task-state source. The current pointer is
 * just an entry locator, and neither file belongs in Git. Caller may already
 * own the project lock while atomically accepting a candidate. */
export async function saveProductionStage(root: string, value: ProductionStage): Promise<void> {
  const stage = validateProductionStage(value);
  await withProjectWriteLock(root, "production-stage", async () => {
    await writeProductionProjection(root, join(productionStageDirectory(stage.id), "manifest.json"), `${JSON.stringify(stage)}\n`);
    await writeProductionProjection(root, CURRENT_PATH, `${JSON.stringify({ stage: stage.id })}\n`);
  });
}

export interface ProductionStageMaterials {
  requirements: string;
  sources: ReadonlyMap<string, string>;
  guidance?: ReadonlyMap<string, string>;
}

export function productionSourceFile(scope: string): string {
  // File identity follows the source, not its current ordinal. Reordering or
  // appending a plan cannot redirect an already-issued task's material link.
  return `shared/source-${indexerProtocolDigest(scope).slice("sha256:".length)}.md`;
}

export function productionPlanMarkdown(stage: ProductionStage): string {
  const directory = productionStageDirectory(stage.id);
  return [`# ${stage.purpose}`, "", "## Planned articles", "",
    ...stage.tasks.filter(task => task.status !== "replaced").map(task => `- ${task.question} — ${task.path} (${task.sources.map(source => source.scope).join(", ")})`),
    ...(stage.tasks.some(task => task.status === "replaced") ? ["", "## Superseded task plans", "",
      ...stage.tasks.filter(task => task.status === "replaced").map(task => `- ${task.path}: ${task.reason ?? "Replaced by the current plan"}`)] : []),
    "", `Planned skill guidance: ${join(directory, "indexer-usage.yaml")}`, `Available skill entries: ${join(directory, "skills.md")}`,
    "", `Remaining investigation: ${stage.pending_scopes.join(", ") || "none"}`, "",
    ...(!stage.report_approved && stage.planning_complete ? [
      `If the user requests changes, edit ${productionAgentDirectory(stage.id)}/submissions/plan.yaml using ${join(directory, "planning.schema.json")}.`,
      `Resubmit: context action complete-current --revision ${stage.id} --input ${productionAgentDirectory(stage.id)}/submissions/plan.yaml --format json`,
      "Then present the updated report and apply context.gate.work_start_scope; an old decision does not approve changed article goals.", "",
    ] : []),
    ...productionSourceSummaryMarkdown(stage)].join("\n");
}

/** Prepare directories before publishing issued state. A crash can leave an
 * unused projection, but cannot expose an issued task without its inputs. */
export async function materializeProductionStage(input: {
  projectRoot: string;
  stage: ProductionStage;
  capabilities: ProductionCapabilities;
  materials?: ProductionStageMaterials;
}): Promise<ProductionDispatch & { directory: string; agent_directory: string; submission?: string; updated_files: number }> {
  return withProjectWriteLock(input.projectRoot, "production-stage-materialize", async () => {
    const stage = validateProductionStage(input.stage);
    const previous = await readProductionStage(input.projectRoot, stage.id);
    if (previous && indexerProtocolDigest(previous) !== indexerProtocolDigest(stage)) {
      throw new TypeError("Stage changed before materialization; read its current manifest and retry without replacing accepted progress");
    }
    const dispatch = dispatchProductionStage(stage, input.capabilities);
    const directory = productionStageDirectory(stage.id);
    const agent = productionAgentDirectory(stage.id);
    let changed = 0;
    const write = async (path: string, content: string) => {
      if (await writeProductionProjection(input.projectRoot, path, content)) changed += 1;
    };
    if (input.materials) {
      await write(join(directory, "shared/requirements.md"), input.materials.requirements);
    } else if (dispatch.batches.length && !await hasReadableProjection(input.projectRoot, join(directory, "shared/requirements.md"))) {
      throw new TypeError("Stage materials are missing. Re-prepare the current plan's directory; accepted tasks remain saved.");
    }
    await write(join(directory, "capabilities.yaml"), YAML.stringify(input.capabilities));
    await write(join(directory, "skills.md"), ["# Available skills", "",
      ...input.capabilities.skills.map(skill => `- ${skill.name}${skill.entry ? `: ${skill.entry}` : " (read through the host)"}`), "",
      "Skills are temporary guidance, not article ownership or version constraints.", ""].join("\n"));
    await write(join(directory, "indexer-usage.yaml"), YAML.stringify(stage.indexer_usage));
    await write(join(directory, "plan.md"), productionPlanMarkdown(stage));
    const issued = new Set(dispatch.batches.flatMap(batch => batch.tasks));
    const neededScopes = new Set(stage.tasks.filter(task => issued.has(task.id)).flatMap(task => task.sources.map(source => source.scope)));
    const scopePaths = new Map<string, string>();
    for (const scope of stage.scopes) {
      const path = join(directory, productionSourceFile(scope.scope));
      scopePaths.set(scope.scope, path);
      if (input.materials) {
        const content = input.materials.sources.get(scope.scope);
        if (content === undefined) throw new TypeError(`Missing authorized material navigation for ${scope.scope}`);
        await write(path, content);
      } else if (neededScopes.has(scope.scope) && !await hasReadableProjection(input.projectRoot, path)) {
        throw new TypeError(`Missing authorized material navigation for ${scope.scope}; re-prepare that source's material.`);
      }
    }
    for (const [path, content] of input.materials?.guidance ?? []) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/u.test(path)) throw new TypeError("Guidance files need a local Markdown basename");
      await write(join(directory, "guidance", path), content);
    }
    const submittedTasks = [];
    let candidates: ReturnType<typeof readCandidateRecords> | undefined;
    let approved: Promise<ReturnType<typeof productionApprovedTargetsIndex>> | undefined;
    const tasksById = new Map(stage.tasks.map(task => [task.id, task]));
    for (const batch of dispatch.batches) {
      const batchPath = join(directory, "batches", batch.id);
      await write(join(batchPath, "batch.md"), `# Batch ${batch.id}\n\nTasks: ${batch.tasks.join(", ")}\n\nRead each task's scope and dependencies. Workers write drafts only; the coordinator submits.\n`);
      // Only independent CLI-owned task projections overlap. Keep a bounded
      // number of filesystem operations and publish issued state after all
      // projections complete, under the same project write lock.
      for (let offset = 0; offset < batch.tasks.length; offset += 8) {
        const projections = await Promise.allSettled(batch.tasks.slice(offset, offset + 8).map(async id => {
          const task = tasksById.get(id)!;
          const taskRoot = join(batchPath, "tasks", id);
          if (task.base !== null) {
            const basePath = join(taskRoot, "base.md");
            const referencesPath = join(taskRoot, "base-references.yaml");
            let missing = false;
            try {
              await access(await safeProjectTarget(input.projectRoot, basePath));
              await access(await safeProjectTarget(input.projectRoot, referencesPath));
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
              missing = true;
            }
            if (missing) {
              candidates ??= readCandidateRecords(input.projectRoot);
              const target = await readProductionArticleTarget({ projectRoot: input.projectRoot, task, candidates: await candidates,
                readApproved: () => approved ??= readApprovedKnowledgeMetadataIndex(input.projectRoot).then(productionApprovedTargetsIndex) });
              if (!target.base) throw new TypeError(`Revision base is unavailable for ${task.path}; refresh this task before writing`);
              await write(basePath, target.base.markdown);
              await write(referencesPath, YAML.stringify({ sections: target.base.sections }));
            }
          }
          await write(join(taskRoot, "task.md"), [`# ${task.question}`, "", `Target: ${task.path}`,
            `Draft Markdown: ${join(agent, "batches", batch.id, id, "article.md")}`,
            `Draft references: ${join(agent, "batches", batch.id, id, "references.yaml")}`,
            `Article: ${task.article_id}`, `Dependencies: ${task.after.join(", ") || "none"}`, "",
            task.brief ?? "Read the authorized sources and write the complete article, or revise the existing article's affected fragments.", "",
            ...(task.base !== null ? [`Revision base: ${join(taskRoot, "base.md")}`,
              `Existing sections and references: ${join(taskRoot, "base-references.yaml")}`, ""] : []),
            `Shared requirements: ${join(directory, "shared/requirements.md")}`,
            `Relevant planned skills: ${join(directory, "indexer-usage.yaml")}`, ""].join("\n"));
          await write(join(taskRoot, "sources.md"), ["# Authorized sources", "",
            ...task.sources.map(source => `- ${source.scope}: ${scopePaths.get(source.scope)!}`), "",
            "Navigation is not semantic evidence. Read the relevant full text before writing and cite actual source regions.", ""].join("\n"));
          const output = `batches/${batch.id}/${id}`;
          return { task: id, input: task.input, content: `${output}/article.md`, references: `${output}/references.yaml` };
        }));
        // Drain all workers before releasing the lock on failure; partial
        // unissued projections are safe to reuse during normal preparation.
        for (const projection of projections) {
          if (projection.status === "rejected") throw projection.reason;
          submittedTasks.push(projection.value);
        }
      }
    }
    // The CLI supplies a template on its own side; it never overwrites an Agent
    // draft or an edited submission on a repeated preparation or downgrade.
    const submission = dispatch.batches.length ? join(directory, "submission.yaml") : undefined;
    if (submission) await write(submission, `# Draft paths below are relative to ${agent}/, NOT this template directory.\n# Copy this template to ${agent}/submissions/ready.yaml before editing.\n${YAML.stringify({ stage: stage.id, tasks: submittedTasks })}`);
    await write(join(directory, "stage.md"), [`# ${stage.purpose}`, "",
      `Stage: ${stage.id}`, `State: ${dispatch.state}`, `Scheduling: ${dispatch.mode}`, "",
      ...dispatch.batches.map(batch => `- Batch ${batch.id}: ${join(directory, "batches", batch.id, "batch.md")}`), "",
      `Agent output directory (all content/references/edits paths resolve here): ${agent}`, `Remaining investigation: ${stage.pending_scopes.join(", ") || "none"}`, "",
      ...stage.tasks.filter(task => task.status === "blocked").map(task => `- Blocked task ${task.id}: ${task.path} — ${task.reason ?? "Investigate the task's source and dependencies."}`), "",
      `To add articles within this confirmed purpose and source scope, submit a plan amendment using ${join(directory, "planning.schema.json")}.`,
      "During writing, articles adds tasks; replaces explicitly names unfinished task IDs. Existing task IDs may be used in after. Do not resubmit the whole original plan or widen the purpose without user confirmation.",
      `Plan amendment: context action complete-current --revision ${stage.id} --input ${agent}/submissions/plan-amendment.yaml --format json`, "",
      ...stage.gaps.map(gap => `- Gap in ${gap.scope}: ${gap.reason}`), "",
      ...(submission ? [`Copy ${submission} to ${agent}/submissions/ready.yaml; submit only completed tasks.`, ""] : []),
      ...(submission ? [`Submit: context action complete-current --revision ${stage.id} --input ${agent}/submissions/ready.yaml${input.capabilities.multi_agent ? " --multi-agent" : ""} --format json`, ""] : []),
      "Completion of this stage does not approve or publish its candidates.", ""].join("\n"));
    await saveProductionStage(input.projectRoot, { ...stage,
      tasks: stage.tasks.map(task => issued.has(task.id) && task.status === "pending" ? { ...task, status: "issued" } : task) });
    return { ...dispatch, directory, agent_directory: agent, ...(submission ? { submission } : {}), updated_files: changed };
  });
}

/** Reuse already-projected materials after an acceptance. Scheduling authority
 * comes from this call, never from a previous session's persisted multi_agent.
 * Saved skill names are guidance only and do not authorize extra work. */
export async function prepareNextProductionStage(input: {
  projectRoot: string;
  stage: ProductionStage;
  multiAgent?: boolean;
}) {
  const capabilities = await readProductionCapabilities(input.projectRoot, input.stage.id);
  capabilities.multi_agent = input.multiAgent === true;
  const dispatch = dispatchProductionStage(input.stage, capabilities);
  if (!dispatch.batches.length) return undefined;
  return materializeProductionStage({ projectRoot: input.projectRoot, stage: input.stage, capabilities });
}

export async function readProductionCapabilities(root: string, stage: string): Promise<ProductionCapabilities> {
  const saved = await readOptional(root, join(productionStageDirectory(stage), "capabilities.yaml"));
  return productionCapabilitiesSchema.parse(saved ? YAML.parse(saved) : {});
}
