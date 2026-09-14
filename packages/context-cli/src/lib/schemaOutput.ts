import YAML from "yaml";
import { ContextError } from "./errors.js";
import { ErrorCategory } from "./cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";

export function schemaOutputFormat(value: string): "text" | "yaml" | "json" {
  if (value === "text" || value === "yaml" || value === "json") return value;
  throw new ContextError(ExitCode.UserError, "Expected schema format text, json, or yaml", { category: ErrorCategory.UserInputInvalid });
}

export function writeSchemaOutput(value: unknown, format: "text" | "yaml" | "json"): void {
  process.stdout.write(format === "json" ? `${JSON.stringify(value, null, 2)}\n` : YAML.stringify(value));
}
