import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { importsRegistrySchema, type ImportsRegistry } from "@c4a/context";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";

export function importsError(message: string): ContextError {
  return new ContextError(ExitCode.WorkspaceStateError, `Invalid imports declaration: ${message}`, {
    category: ErrorCategory.WorkspaceStateInvalid,
    next: "Correct imports.yaml or the context:import reference. Registration does not install or capture external content.",
  });
}

/** Local syntax only. Unknown providers and unavailable networks are irrelevant. */
export async function readImportsRegistry(projectRoot: string): Promise<ImportsRegistry | undefined> {
  try {
    const path = join(projectRoot, "imports.yaml");
    if (!(await lstat(path)).isFile()) throw importsError("imports.yaml must be a regular file");
    return importsRegistrySchema.parse(YAML.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof ContextError) throw error;
    throw importsError(error instanceof Error ? error.message : String(error));
  }
}
