import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  validateSchema,
  type ResourceReadReceiptSet,
} from "@c4a/agent-graph";
import { ErrorCategory } from "../../lib/cliFeedback.js";
import { ContextError } from "../../lib/errors.js";
import { ExitCode } from "../../types/exitCode.js";

async function receiptDocument(value: string, cwd: string): Promise<unknown> {
  const source = value.startsWith("@")
    ? await readFile(resolve(cwd, value.slice(1)), "utf8")
    : value;
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new ContextError(
      ExitCode.UserError,
      "resource read receipts must be a JSON object or an @file containing JSON",
      {
        category: ErrorCategory.UserInputInvalid,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

export async function parseWorkflowResourceReceipts(
  value: string,
  cwd: string,
): Promise<ResourceReadReceiptSet> {
  const parsed = await receiptDocument(value, cwd);
  try {
    await validateSchema(
      "resource-read-receipts",
      parsed,
      "resource read receipts",
    );
  } catch (error) {
    throw new ContextError(
      ExitCode.UserError,
      "resource read receipts do not match agent-graph.resource-read-receipts.v1",
      {
        category: ErrorCategory.UserInputInvalid,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
  return parsed as ResourceReadReceiptSet;
}
