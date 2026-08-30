import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  flattenDiagnosticMessageText,
  parseConfigFileTextToJson,
} from "typescript";

export function parseRushJsonc<T>(file: string, text: string): T {
  const result = parseConfigFileTextToJson(file, text);
  if (result.error) {
    throw new Error(
      `${file}: ${flattenDiagnosticMessageText(result.error.messageText, "\n")}`,
    );
  }
  return result.config as T;
}

export function parseRushJsoncValue<T>(file: string, text: string): T {
  const wrapped = parseRushJsonc<{ value: T }>(file, `{\n"value": ${text}\n}`);
  return wrapped.value;
}

export async function readOptionalRushJsonc<T>(
  root: string,
  file: string,
): Promise<T | null> {
  try {
    return parseRushJsonc<T>(file, await readFile(path.join(root, file), "utf8"));
  } catch (error) {
    if (
      error !== null && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export async function readOptionalRushJsoncValue<T>(
  root: string,
  file: string,
): Promise<T | null> {
  try {
    return parseRushJsoncValue<T>(file, await readFile(path.join(root, file), "utf8"));
  } catch (error) {
    if (
      error !== null && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}
