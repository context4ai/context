import { describe, expect, test } from "bun:test";
import {
  compactProjectVerifyDiagnostics,
  groupProjectVerifyIssues,
  pagedProjectVerifyIssues,
} from "../project/verifyDiagnostics.js";
import type { ProjectVerifyIssue } from "../project/verifyTypes.js";

const ISSUES: ProjectVerifyIssue[] = [
  {
    severity: "error",
    code: "approved-source-ref-stale",
    path: "guides/one.md",
    line: 10,
    view_ref: "guide:entity/one",
    source_keys: ["file:one"],
    message: "source reference is stale",
  },
  {
    severity: "error",
    code: "approved-source-ref-stale",
    path: "guides/two.md",
    line: 20,
    view_ref: "guide:entity/two",
    source_keys: ["file:two"],
    message: "source reference is stale",
  },
  {
    severity: "warning",
    code: "approved-evidence-unverifiable",
    path: "guides/three.md",
    message: "evidence cannot be verified",
  },
];

describe("project verify diagnostics", () => {
  test("groups repeated findings without dropping deterministic counts or samples", () => {
    expect(groupProjectVerifyIssues(ISSUES)).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "approved-source-ref-stale",
        count: 2,
        affected_paths: 2,
        affected_views: 2,
        affected_sources: 2,
        samples: expect.any(Array),
      }),
      expect.objectContaining({
        severity: "warning",
        code: "approved-evidence-unverifiable",
        count: 1,
      }),
    ]);
    const compact = compactProjectVerifyDiagnostics(ISSUES);
    expect(compact).toHaveLength(2);
    expect(compact[0]).toContain("count=2");
    expect(compact[0]).toContain("sample_path=guides/one.md:10");
  });

  test("pages complete diagnostics with a directly executable continuation", () => {
    const first = pagedProjectVerifyIssues({ issues: ISSUES, pageSize: "2" });
    expect(first).toMatchObject({
      protocol: "context.verify.diagnostics.v1",
      summary: { total: 3, returned: 2, offset: 0, truncated: true },
      next_action: {
        kind: "read_next_diagnostics_page",
        command: "context verify --view diagnostics --page-token 2 --page-size 2 --format json",
      },
    });
    const second = pagedProjectVerifyIssues({
      issues: ISSUES,
      pageSize: "2",
      pageToken: "2",
    });
    expect(second).toMatchObject({
      summary: { total: 3, returned: 1, offset: 2, truncated: false },
      next_action: { kind: "diagnostics_complete" },
    });
  });
});
