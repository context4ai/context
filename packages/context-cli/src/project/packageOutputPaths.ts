import { posix } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { ErrorCategory } from "../lib/cliFeedback.js";

/** Websites share the KB's parent directory, including during staged builds. */
export function packageSiteOutputDir(pkg: Pick<PackageDefinition, "name" | "outDir">): string {
  return posix.join(posix.dirname(pkg.outDir), `${pkg.name.replace(/-kb$/u, "")}-site`);
}

export function packageOutputDirs(pkg: PackageDefinition): string[] {
  return [pkg.outDir, ...(pkg.kind === "package.kb" && pkg.site ? [packageSiteOutputDir(pkg)] : [])];
}

export function assertDistinctPackageOutputs(packages: readonly PackageDefinition[]): void {
  const owners = new Map<string, string>();
  for (const pkg of packages) for (const path of packageOutputDirs(pkg)) {
    if (owners.has(path)) throw new ContextError(ExitCode.UserError, `Package output directory collision: ${path}`, {
      category: ErrorCategory.UserInputInvalid, packages: [owners.get(path), pkg.name],
      next: "Rename the conflicting package; KB and website outputs must have distinct directories.",
    });
    owners.set(path, pkg.name);
  }
}
