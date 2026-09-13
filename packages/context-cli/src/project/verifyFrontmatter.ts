import YAML from "yaml";
import { okfTypeForKnowledgePath } from "./okfTypes.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isDeprecatedApprovedMarkdown(content: string): boolean {
  if (!content.startsWith("---\n")) return false;
  const end = content.indexOf("\n---", 4);
  if (end < 0) return false;
  try {
    const parsed = YAML.parse(content.slice(4, end)) as unknown;
    return isRecord(parsed) && parsed.deprecated === true;
  } catch {
    return false;
  }
}

function parseFrontmatter(content: string, path: string, issues: ProjectVerifyIssue[]): Record<string, unknown> | undefined {
  if (!content.startsWith("---\n")) {
    issues.push({ severity: "error", code: "frontmatter-missing", path, line: 1, message: "knowledge markdown must start with YAML frontmatter" });
    return undefined;
  }
  const end = content.indexOf("\n---", 4);
  if (end < 0) {
    issues.push({ severity: "error", code: "frontmatter-unclosed", path, line: 1, message: "knowledge markdown frontmatter is not closed" });
    return undefined;
  }
  try {
    const parsed = YAML.parse(content.slice(4, end)) as unknown;
    if (!isRecord(parsed)) {
      issues.push({ severity: "error", code: "frontmatter-invalid", path, line: 1, message: "frontmatter must be a YAML object" });
      return undefined;
    }
    return parsed;
  } catch (error) {
    issues.push({
      severity: "error",
      code: "frontmatter-invalid",
      path,
      line: 1,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

export function parseFrontmatterLoose(content: string): Record<string, unknown> {
  if (!content.startsWith("---\n")) return {};
  const end = content.indexOf("\n---", 4);
  if (end < 0) return {};
  try {
    const parsed = YAML.parse(content.slice(4, end)) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function bodyWithoutFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return content.trimEnd();
  const end = content.indexOf("\n---", 4);
  if (end < 0) return content.trimEnd();
  return content.slice(end + "\n---".length).replace(/^(?:\r?\n)+/u, "").trimEnd();
}

function validateOkfFrontmatter(input: {
  relPath: string;
  frontmatter: Record<string, unknown>;
  issues: ProjectVerifyIssue[];
}): void {
  const requiredStringFields = ["title", "type", "description", "timestamp"] as const;
  for (const field of requiredStringFields) {
    if (typeof input.frontmatter[field] !== "string" || input.frontmatter[field].trim().length === 0) {
      input.issues.push({
        severity: "error",
        code: "approved-okf-frontmatter-invalid",
        path: input.relPath,
        message: `approved markdown frontmatter must include non-empty ${field}`,
      });
    }
  }
  const timestamp = input.frontmatter.timestamp;
  if (typeof timestamp === "string" && Number.isNaN(Date.parse(timestamp))) {
    input.issues.push({
      severity: "error",
      code: "approved-okf-timestamp-invalid",
      path: input.relPath,
      message: `approved markdown timestamp must be ISO-like date string: ${timestamp}`,
    });
  }
  const tags = input.frontmatter.tags;
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || tag.trim().length === 0))) {
    input.issues.push({
      severity: "error",
      code: "approved-okf-tags-invalid",
      path: input.relPath,
      message: "approved markdown tags must be a non-empty string array",
    });
  }
  const resource = input.frontmatter.resource;
  if (typeof resource === "string" && (/^[a-zA-Z]:[\\/]/u.test(resource) || resource.startsWith("/"))) {
    input.issues.push({
      severity: "error",
      code: "approved-okf-resource-invalid",
      path: input.relPath,
      message: `approved markdown resource must not be a local absolute path: ${resource}`,
    });
  }
}


export async function validateApprovedMarkdown(input: {
  relPath: string;
  content: string;
  issues: ProjectVerifyIssue[];
}): Promise<void> {
  const expected = okfTypeForKnowledgePath(input.relPath);
  if (!expected) {
    input.issues.push({ severity: "error", code: "knowledge-collection-invalid", path: input.relPath,
      message: "Article must be stored under a known knowledge collection" });
    return;
  }
  const frontmatter = parseFrontmatter(input.content, input.relPath, input.issues);
  if (!frontmatter) return;
  validateOkfFrontmatter({ relPath: input.relPath, frontmatter, issues: input.issues });
  if (frontmatter.type !== expected) {
    input.issues.push({ severity: "error", code: "approved-type-collection-mismatch", path: input.relPath,
      message: `Article type must be ${expected} for this collection` });
  }
}
