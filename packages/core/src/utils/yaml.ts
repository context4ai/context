import yaml from "yaml";
import { C4AError } from "../errors/c4aError.js";
import { ErrorCode } from "../errors/errorCodes.js";

export function serializeYaml(value: unknown): string {
  return yaml.stringify(value);
}

export function parseYaml(value: string): unknown {
  try {
    return yaml.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse YAML";
    throw new C4AError(ErrorCode.PARSE_YAML, message, { input: value });
  }
}
