import { readFile } from "node:fs/promises";
import type { Readable } from "node:stream";
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

function isCompleteJsonLine(raw: string): boolean {
  if (!raw.endsWith("\n") && !raw.endsWith("\r")) return false;
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

export async function readPayloadTextFromStdin(stdin: Readable): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      stdin.off("error", onError);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      stdin.pause();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.from(chunk);
      chunks.push(buffer);
      const last = buffer.at(-1);
      if (last !== 10 && last !== 13) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (isCompleteJsonLine(raw)) finish();
    };
    const onEnd = () => finish();
    const onError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("error", onError);
  });
}

async function readPayloadText(path: string): Promise<string> {
  if (path !== "-") return readFile(path, "utf8");
  return readPayloadTextFromStdin(process.stdin);
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
