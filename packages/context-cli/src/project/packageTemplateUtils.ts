import type { PackageDefinition, TemplateVarValue } from "@c4a/context";
import Handlebars from "handlebars";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

export interface TemplateFile {
  relPath: string;
  absPath: string;
  content: string;
}

const TEMPLATE_ENGINE = Handlebars.create();

TEMPLATE_ENGINE.registerHelper("inc", (value: unknown) =>
  typeof value === "number" ? value + 1 : ""
);
TEMPLATE_ENGINE.registerHelper("json", (value: unknown) =>
  JSON.stringify(value, null, 2)
);

export function toPosixPath(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}

export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(path)) return false;
  return path.split(/[\\/]+/u).every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function assertSafeRenderedPath(path: string, label: string): void {
  if (!isSafeRelativePath(path)) {
    throw new ContextError(ExitCode.WorkspaceStateError, `${label} rendered an unsafe path: ${path}`, {
      category: ErrorCategory.SchemaInvalid,
      path,
    });
  }
}

export function stripTemplateComments(text: string): string {
  return text.replace(/<!--\s*context:template[\s\S]*?-->\n?/gu, "");
}

export function renderTemplateText(text: string, vars: Record<string, TemplateVarValue>): string {
  const compiled = TEMPLATE_ENGINE.compile(stripTemplateComments(text), { noEscape: true });
  return compiled(vars);
}

export function packageKind(pkg: PackageDefinition): "kb" | "llms" {
  return pkg.kind === "package.kb" ? "kb" : "llms";
}
