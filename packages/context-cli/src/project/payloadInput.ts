import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

function userInputError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

function parsePayloadText(raw: string): unknown {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(raw) as unknown;
  return YAML.parse(raw) as unknown;
}

async function readPayloadText(path: string): Promise<string> {
  if (path !== "-") return readFile(path, "utf8");
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

export async function readYamlOrJsonInput(input: {
  path: string | undefined;
  label: string;
  missingNext: string;
  readFailureNext: string;
  parseFailureNext: string;
}): Promise<unknown> {
  if (input.path === undefined) {
    throw userInputError(`${input.label} requires --input <payload.yaml|json> or --input -`, {
      next: input.missingNext,
    });
  }
  let raw: string;
  try {
    raw = await readPayloadText(input.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw userInputError(`${input.label} cannot be read: ${input.path}`, {
      path: input.path,
      reason: message,
      next: input.readFailureNext,
    });
  }
  try {
    return parsePayloadText(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw userInputError(`${input.label} is invalid YAML/JSON: ${message}`, {
      path: input.path,
      next: input.parseFailureNext,
    });
  }
}
