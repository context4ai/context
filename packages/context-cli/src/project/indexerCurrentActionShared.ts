import { join } from "node:path";
import { canonicalIndexerJson } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";

export interface IndexerTaskCompletionOutcome {
  task_key: string;
  outcome: string;
  committed?: boolean;
  message?: string;
  error?: {
    code: string;
    schema: string;
    issues: Array<{
      path: readonly (string | number)[];
      pointer: string;
      code: string;
      message: string;
      received: unknown;
      expected: unknown;
    }>;
    retry: { task_key: string; result: { stage: "partition" | "author" | "post-author" } };
  };
}

function valueAtIssuePath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return current;
    current = Reflect.get(current, segment);
  }
  return current;
}

export function schemaFailure(input: {
  stage: "partition" | "author" | "post-author";
  task_key: string;
  result: unknown;
  issues: readonly {
    path: readonly (string | number)[];
    message: string;
    code: string;
  }[];
}): IndexerTaskCompletionOutcome {
  return {
    task_key: input.task_key,
    outcome: "failed",
    committed: false,
    error: {
      code: "schema-invalid",
      schema: input.stage === "partition"
        ? "context.indexer.semantic-partition-result/v1"
        : input.stage === "author"
        ? "context.indexer.semantic-author-result/v1"
        : "context.indexer.semantic-post-author-result/v1",
      issues: input.issues.map((issue) => ({
        path: issue.path,
        pointer: issue.path.length === 0
          ? ""
          : `/${issue.path.map((segment) => String(segment)
            .replace(/~/gu, "~0").replace(/\//gu, "~1")).join("/")}`,
        code: issue.code,
        message: issue.message,
        received: valueAtIssuePath(input.result, issue.path) ?? { state: "missing" },
        expected: (() => {
          const detail = issue as unknown as Record<string, unknown>;
          if (Array.isArray(detail.options)) return detail.options;
          return detail.expected ?? issue.message;
        })(),
      })),
      retry: {
        task_key: input.task_key,
        result: { stage: input.stage },
      },
    },
  };
}

export async function persistIndexerSemanticResult(input: {
  projectRoot: string;
  requestDigest: string;
  semantic: unknown;
}): Promise<void> {
  await atomicWriteFile(
    join(
      input.projectRoot,
      ".tmp",
      "context-runtime",
      "indexer",
      "semantic-results",
      `${input.requestDigest.slice("sha256:".length)}.json`,
    ),
    canonicalIndexerJson(input.semantic),
  );
}
