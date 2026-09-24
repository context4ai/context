import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";

const localId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u);
const filePath = z.string().min(1);
export const productionSubmissionSchema = z.object({
  stage: localId,
  tasks: z.array(z.object({
    task: localId,
    input: z.string().min(1),
    content: filePath.optional(),
    references: filePath.optional(),
    edits: filePath.optional(),
  }).strict()).min(1),
}).strict();

export interface FixedProductionFile {
  path: string;
  text: string;
  digest: string;
  bytes: number;
}

export interface FixedProductionTask {
  task: string;
  input: string;
  content?: FixedProductionFile;
  references?: FixedProductionFile;
  edits?: FixedProductionFile;
}

export interface ProductionFileLimits {
  file_bytes: number;
  submission_bytes: number;
}

// These are transport safety limits, not article length or semantic quotas.
const DEFAULT_LIMITS: ProductionFileLimits = {
  file_bytes: 16 * 1024 * 1024,
  submission_bytes: 64 * 1024 * 1024,
};

function invalidFile(path: string, message: string): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    reason_code: "invalid-production-file",
    file: path,
    next_action: { command: "context action complete-current --help" },
    input_schema: { path: "Relative UTF-8 regular file inside the current stage Agent directory" },
  });
}

export function productionAgentDirectory(stage: string): string {
  return join(".tmp", "agent-work", "production-stages", localId.parse(stage));
}

function assertRelativeFile(path: string): void {
  if (isAbsolute(path) || /^[a-zA-Z]:/u.test(path) || path.includes("\\") ||
      path.includes("\0") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw invalidFile(path, "Use a stage-relative file path without traversal or absolute paths; no tasks were saved.");
  }
}

/** Read once into immutable text. Callers validate and commit this text, never
 * reopen the Agent's draft after validation. All paths in a submission are
 * checked before its first write, including paths of later independent tasks. */
export async function readProductionFile(input: {
  projectRoot: string;
  stage: string;
  path: string;
  maxBytes?: number;
}): Promise<FixedProductionFile> {
  return readFixedProductionFile({ ...input, directory: productionAgentDirectory(input.stage) });
}

/** Before a stage exists, known article goals use the same fixed-read safety
 * inside the existing Agent temporary work area. No process files enter Git. */
export async function readProductionPlanningFile(input: {
  projectRoot: string; path: string; maxBytes?: number;
}): Promise<FixedProductionFile> {
  return readFixedProductionFile({ ...input, directory: join(".tmp", "agent-work") });
}

async function readFixedProductionFile(input: {
  projectRoot: string; directory: string; path: string; maxBytes?: number;
}): Promise<FixedProductionFile> {
  assertRelativeFile(input.path);
  const limit = input.maxBytes ?? DEFAULT_LIMITS.file_bytes;
  if (!Number.isSafeInteger(limit) || limit < 1) throw invalidFile(input.path, "File budget must be a positive safe integer.");
  const local = join(input.directory, input.path);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const root = await realpath(input.projectRoot);
    const absolute = await safeProjectTarget(root, local);
    const before = await lstat(absolute);
    if (!before.isFile()) throw invalidFile(input.path, "Submit a regular file, not a directory, symlink or device.");
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await handle.stat();
    const resolved = await realpath(absolute);
    const stageRoot = join(root, input.directory);
    const within = relative(stageRoot, resolved);
    if (within.startsWith("..") || isAbsolute(within) || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw invalidFile(input.path, "The draft path changed while opening it; restore a stage-local file and retry.");
    }
    // Repeat the ancestor check before reading through the opened descriptor.
    await safeProjectTarget(root, local);
    if (!opened.isFile() || opened.size > limit) throw invalidFile(input.path, `File exceeds the ${limit}-byte transport budget or is not regular.`);
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit - bytes + 1));
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) break;
      bytes += result.bytesRead;
      if (bytes > limit) throw invalidFile(input.path, `File exceeds the ${limit}-byte transport budget.`);
      chunks.push(buffer.subarray(0, result.bytesRead));
    }
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw invalidFile(input.path, "The submitted draft changed during reading; stop editing submitted files and retry.");
    }
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { throw invalidFile(input.path, "Save the submitted file as valid UTF-8 text and retry."); }
    if (text.includes("\0")) throw invalidFile(input.path, "Submitted text must not contain NUL bytes.");
    return { path: input.path, text, bytes, digest: durableContentDigest(text) };
  } catch (error) {
    if (error instanceof ContextError) throw error;
    const failure = invalidFile(input.path, `Cannot read ${local}. Draft paths are relative to ${input.directory}/, not the runtime or submission-file directory. ${error instanceof Error ? error.message : String(error)}. No tasks were saved.`);
    throw new ContextError(failure.code, failure.message, { ...failure.detail,
      base_directory: input.directory, expected_path: local });
  } finally {
    await handle?.close();
  }
}

export async function readProductionSubmission(input: {
  projectRoot: string;
  stage: string;
  path: string;
  limits?: ProductionFileLimits;
  manifest?: FixedProductionFile;
}): Promise<{ stage: string; tasks: FixedProductionTask[]; bytes: number }> {
  const limits = input.limits ?? DEFAULT_LIMITS;
  if (!Number.isSafeInteger(limits.submission_bytes) || limits.submission_bytes < 1) {
    throw invalidFile(input.path, "Submission budget must be a positive safe integer.");
  }
  const manifest = input.manifest ?? await readProductionFile({ ...input, maxBytes: Math.min(limits.file_bytes, limits.submission_bytes) });
  if (manifest.bytes > Math.min(limits.file_bytes, limits.submission_bytes)) throw invalidFile(input.path, "Manifest exceeds its transport budget.");
  let value: z.infer<typeof productionSubmissionSchema>;
  try { value = productionSubmissionSchema.parse(YAML.parse(manifest.text)); }
  catch (error) { throw invalidFile(input.path, `Invalid submission manifest: ${error instanceof Error ? error.message : String(error)}`); }
  if (value.stage !== input.stage) throw invalidFile(input.path, "Submission belongs to another stage; use its current task directory.");
  const tasks = new Set<string>();
  const paths = new Set<string>([input.path]);
  for (const task of value.tasks) {
    if (tasks.has(task.task)) throw invalidFile(input.path, `Task ${task.task} occurs more than once; submit it once.`);
    tasks.add(task.task);
    if ((task.content === undefined) === (task.edits === undefined)) {
      throw invalidFile(input.path, `Task ${task.task} requires exactly one content or edits file.`);
    }
    if (task.content !== undefined && task.references === undefined) {
      throw invalidFile(input.path, `Task ${task.task} requires a references file with its complete article.`);
    }
    for (const path of [task.content, task.references, task.edits]) {
      if (path === undefined) continue;
      assertRelativeFile(path);
      if (paths.has(path)) throw invalidFile(path, "A result file may only belong to one submitted task and role.");
      paths.add(path);
    }
  }
  let bytes = manifest.bytes;
  const fixed: FixedProductionTask[] = [];
  for (const task of value.tasks) {
    const output: FixedProductionTask = { task: task.task, input: task.input };
    for (const field of ["content", "references", "edits"] as const) {
      const path = task[field];
      if (path === undefined) continue;
      const remaining = limits.submission_bytes - bytes;
      if (remaining < 1) throw invalidFile(path, "Submission exceeds its transport budget; submit a smaller completed subset.");
      const file = await readProductionFile({ ...input, path, maxBytes: Math.min(limits.file_bytes, remaining) });
      bytes += file.bytes;
      output[field] = file;
    }
    fixed.push(output);
  }
  return { stage: value.stage, tasks: fixed, bytes };
}
