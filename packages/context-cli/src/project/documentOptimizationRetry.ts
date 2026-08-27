import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ContextError } from "../lib/errors.js";
import type { DocumentOptimizationFragment } from "./documentOptimizationModel.js";
import { sha256 } from "./documentOptimizationModel.js";
import { documentOptimizationCacheRoot } from "./documentOptimizationConfig.js";

export interface DocumentOptimizationGuidanceProblem {
  problem_fingerprint: string;
  attempts: number;
  message: string;
  fragment_ids: string[];
  signal_codes: string[];
}

interface DocumentOptimizationRetryState {
  schema: "context.document-optimization-retry.v1";
  batch_digest: string;
  problems: DocumentOptimizationGuidanceProblem[];
}

const RETRY_STATE_FILE = "retry.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))].sort();
}

export function documentOptimizationBatchDigest(
  fragments: readonly DocumentOptimizationFragment[],
): string {
  return sha256(JSON.stringify(fragments.map((fragment) => ({
    fragment_id: fragment.fragment_id,
    input_digest: fragment.input_digest,
    context_digest: fragment.context_digest,
    policy_digest: fragment.policy_digest,
  })).sort((left, right) => left.fragment_id.localeCompare(right.fragment_id))));
}

function retryStatePath(projectRoot: string): string {
  return join(documentOptimizationCacheRoot(projectRoot), RETRY_STATE_FILE);
}

async function readRetryState(projectRoot: string): Promise<DocumentOptimizationRetryState | undefined> {
  const path = retryStatePath(projectRoot);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.schema !== "context.document-optimization-retry.v1" ||
      typeof parsed.batch_digest !== "string" || !Array.isArray(parsed.problems)) return undefined;
    const problems = parsed.problems.flatMap((item): DocumentOptimizationGuidanceProblem[] => {
      if (!isRecord(item) || typeof item.problem_fingerprint !== "string" ||
        typeof item.attempts !== "number" || typeof item.message !== "string") return [];
      return [{
        problem_fingerprint: item.problem_fingerprint,
        attempts: item.attempts,
        message: item.message,
        fragment_ids: stableStrings(item.fragment_ids),
        signal_codes: stableStrings(item.signal_codes),
      }];
    });
    return {
      schema: "context.document-optimization-retry.v1",
      batch_digest: parsed.batch_digest,
      problems,
    };
  } catch {
    return undefined;
  }
}

export async function collectDocumentOptimizationGuidance(input: {
  projectRoot: string;
  fragments: readonly DocumentOptimizationFragment[];
}): Promise<{ retry_attempts: number; guidance_required: boolean; guidance_problems: DocumentOptimizationGuidanceProblem[] }> {
  const state = await readRetryState(input.projectRoot);
  const batchDigest = documentOptimizationBatchDigest(input.fragments);
  const problems = state?.batch_digest === batchDigest ? state.problems : [];
  const retryAttempts = Math.max(0, ...problems.map((problem) => problem.attempts));
  return {
    retry_attempts: retryAttempts,
    guidance_required: problems.some((problem) => problem.attempts >= 3),
    guidance_problems: problems.filter((problem) => problem.attempts >= 3),
  };
}

export async function recordDocumentOptimizationFailure(input: {
  projectRoot: string;
  fragments: readonly DocumentOptimizationFragment[];
  error: ContextError;
}): Promise<void> {
  const batchDigest = documentOptimizationBatchDigest(input.fragments);
  const previous = await readRetryState(input.projectRoot);
  const signalCodes = stableStrings(input.error.detail?.signals ?? input.error.detail?.missing_signal_codes);
  const fragmentIds = stableStrings(input.error.detail?.fragment_ids);
  const problemFingerprint = sha256(JSON.stringify({
    batch_digest: batchDigest,
    message: input.error.message,
    fragment_ids: fragmentIds,
    signal_codes: signalCodes,
  }));
  const problems = previous?.batch_digest === batchDigest ? [...previous.problems] : [];
  const index = problems.findIndex((problem) => problem.problem_fingerprint === problemFingerprint);
  const next: DocumentOptimizationGuidanceProblem = {
    problem_fingerprint: problemFingerprint,
    attempts: (index < 0 ? 0 : problems[index]!.attempts) + 1,
    message: input.error.message,
    fragment_ids: fragmentIds,
    signal_codes: signalCodes,
  };
  if (index < 0) problems.push(next);
  else problems[index] = next;
  await atomicWriteFile(retryStatePath(input.projectRoot), `${JSON.stringify({
    schema: "context.document-optimization-retry.v1",
    batch_digest: batchDigest,
    problems,
  }, null, 2)}\n`);
}

export async function clearDocumentOptimizationRetry(projectRoot: string): Promise<void> {
  await rm(retryStatePath(projectRoot), { force: true });
}
