import type { ProjectVerifyIssue } from "./verifyTypes.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

export interface ProjectVerifyIssueSample {
  message: string;
  path?: string;
  line?: number;
  collection?: string;
  view_ref?: string;
  node_ref?: string;
  source_keys?: string[];
}

export interface ProjectVerifyIssueGroup {
  severity: ProjectVerifyIssue["severity"];
  code: string;
  count: number;
  affected_paths: number;
  affected_views: number;
  affected_sources: number;
  samples: ProjectVerifyIssueSample[];
}

function issueSample(issue: ProjectVerifyIssue): ProjectVerifyIssueSample {
  return {
    message: issue.message,
    ...(issue.path === undefined ? {} : { path: issue.path }),
    ...(issue.line === undefined ? {} : { line: issue.line }),
    ...(issue.collection === undefined ? {} : { collection: issue.collection }),
    ...(issue.view_ref === undefined ? {} : { view_ref: issue.view_ref }),
    ...(issue.node_ref === undefined ? {} : { node_ref: issue.node_ref }),
    ...(issue.source_keys === undefined ? {} : { source_keys: [...issue.source_keys] }),
  };
}

function compareProjectVerifyIssues(left: ProjectVerifyIssue, right: ProjectVerifyIssue): number {
  const rank = { error: 0, warning: 1 } as const;
  return rank[left.severity] - rank[right.severity] ||
    left.code.localeCompare(right.code) ||
    (left.path ?? "").localeCompare(right.path ?? "") ||
    (left.line ?? 0) - (right.line ?? 0) ||
    (left.view_ref ?? "").localeCompare(right.view_ref ?? "") ||
    left.message.localeCompare(right.message);
}

export function groupProjectVerifyIssues(
  issues: readonly ProjectVerifyIssue[],
  sampleLimit = 3,
): ProjectVerifyIssueGroup[] {
  const groups = new Map<string, ProjectVerifyIssue[]>();
  for (const issue of issues) {
    const key = `${issue.severity}\u0000${issue.code}`;
    const current = groups.get(key) ?? [];
    current.push(issue);
    groups.set(key, current);
  }
  const rank = { error: 0, warning: 1 } as const;
  return [...groups.values()].map((unsortedGroup) => {
    const group = [...unsortedGroup].sort(compareProjectVerifyIssues);
    const first = group[0]!;
    return {
      severity: first.severity,
      code: first.code,
      count: group.length,
      affected_paths: new Set(group.flatMap((issue) => issue.path === undefined ? [] : [issue.path])).size,
      affected_views: new Set(group.flatMap((issue) => issue.view_ref === undefined ? [] : [issue.view_ref])).size,
      affected_sources: new Set(group.flatMap((issue) => issue.source_keys ?? [])).size,
      samples: group.slice(0, sampleLimit).map(issueSample),
    };
  }).sort((left, right) =>
    rank[left.severity] - rank[right.severity] ||
    right.count - left.count ||
    left.code.localeCompare(right.code)
  );
}

export function compactProjectVerifyDiagnostics(
  issues: readonly ProjectVerifyIssue[],
): string[] {
  return groupProjectVerifyIssues(issues, 3).map((group) => {
    const sample = group.samples[0];
    const location = sample?.path === undefined
      ? ""
      : ` sample_path=${sample.path}${sample.line === undefined ? "" : `:${sample.line}`}`;
    const identity = group.samples.map((candidate) =>
      `${candidate.collection === undefined ? "" : `collection=${candidate.collection}`}${candidate.view_ref === undefined ? "" : `${candidate.collection === undefined ? "" : " "}view_ref=${candidate.view_ref}`}`
    ).filter((value) => value.length > 0).join("; ");
    return `verify ${group.severity} ${group.code} count=${group.count}${identity.length === 0 ? "" : ` ${identity}`}${location}: ${sample?.message ?? "verification issue"}`;
  });
}

function nonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  throw new ContextError(ExitCode.UserError, `${name} must be a non-negative integer`, {
    category: ErrorCategory.UserInputInvalid,
    value,
  });
}

export function pagedProjectVerifyIssues(input: {
  issues: readonly ProjectVerifyIssue[];
  pageToken?: string;
  pageSize?: string;
}): {
  protocol: "context.verify.diagnostics.v1";
  summary: { total: number; returned: number; offset: number; truncated: boolean };
  issues: ProjectVerifyIssue[];
  next_action: { kind: "diagnostics_complete" } | { kind: "read_next_diagnostics_page"; command: string };
} {
  const pageSize = Math.min(100, Math.max(1, nonNegativeInteger(input.pageSize, 25, "--page-size")));
  const offset = nonNegativeInteger(input.pageToken, 0, "--page-token");
  if (offset > input.issues.length) {
    throw new ContextError(ExitCode.UserError, "--page-token is beyond diagnostics", {
      category: ErrorCategory.UserInputInvalid,
      offset,
      total: input.issues.length,
    });
  }
  const ordered = [...input.issues].sort(compareProjectVerifyIssues);
  const issues = ordered.slice(offset, offset + pageSize);
  const nextOffset = offset + issues.length < ordered.length ? offset + issues.length : undefined;
  return {
    protocol: "context.verify.diagnostics.v1",
    summary: {
      total: ordered.length,
      returned: issues.length,
      offset,
      truncated: nextOffset !== undefined,
    },
    issues,
    next_action: nextOffset === undefined
      ? { kind: "diagnostics_complete" }
      : {
          kind: "read_next_diagnostics_page",
          command: `context verify --view diagnostics --page-token ${nextOffset} --page-size ${pageSize} --format json`,
        },
  };
}
