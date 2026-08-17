import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { KNOWLEDGE_COLLECTIONS } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { isSafeEntityId } from "./entityId.js";

export const REVIEW_DECISIONS_FILE = join("knowledge", "decisions.json");
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COLLECTIONS = new Set<string>(KNOWLEDGE_COLLECTIONS);

export type RejectedDecisions = Map<string, string>;

function isCandidateId(value: string): boolean {
  const separator = value.indexOf("/");
  return isSafeEntityId(value) && separator > 0 && COLLECTIONS.has(value.slice(0, separator));
}

function invalidDecisions(reason: string): ContextError {
  return new ContextError(ExitCode.WorkspaceStateError, `${REVIEW_DECISIONS_FILE} is invalid`, {
    category: ErrorCategory.WorkspaceStateInvalid,
    path: REVIEW_DECISIONS_FILE,
    reason,
  });
}

export async function readRejectedDecisions(projectRoot: string): Promise<RejectedDecisions> {
  const path = join(projectRoot, REVIEW_DECISIONS_FILE);
  if (!existsSync(path)) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw invalidDecisions(error instanceof Error ? error.message : String(error));
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalidDecisions("root must be an object");
  }
  const decisions = new Map<string, string>();
  for (const [candidateId, fingerprint] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isCandidateId(candidateId)) {
      throw invalidDecisions(`candidate_id is invalid: ${candidateId || "<empty>"}`);
    }
    if (typeof fingerprint !== "string" || !FINGERPRINT_PATTERN.test(fingerprint)) {
      throw invalidDecisions(`fingerprint is invalid for ${candidateId}`);
    }
    decisions.set(candidateId, fingerprint);
  }
  return decisions;
}

export async function writeRejectedDecisions(
  projectRoot: string,
  decisions: ReadonlyMap<string, string>,
): Promise<void> {
  const path = join(projectRoot, REVIEW_DECISIONS_FILE);
  if (decisions.size === 0) {
    await rm(path, { force: true });
    return;
  }
  const rejected = Object.fromEntries([...decisions.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const tempPath = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(rejected, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}
