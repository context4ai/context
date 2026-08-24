import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyCodeIndexAuditDecision,
  buildCodeIndexAuditReport,
  collectCodeIndexAuditStatus,
  CODE_INDEX_AUDIT_PATH,
  effectiveMarkdownChars,
} from "../project/codeIndexAudit.js";

const roots: string[] = [];

async function projectWithThinAggregate(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-code-index-audit-"));
  roots.push(root);
  const path = join(root, "knowledge", "codegraph", "service", "module-map.md");
  await mkdir(join(root, "knowledge", "codegraph", "service"), { recursive: true });
  const symbols = Array.from({ length: 100 }, (_, index) => `  - "service|src/file-${index}.ts|symbol-${index}"`);
  await writeFile(path, [
    "---",
    'title: "Service module map"',
    'type: "Wiki"',
    'node_ref: "codegraph:service/module-map"',
    'view_ref: "codegraph:service/module-map"',
    'visibility: "exported"',
    "code_symbols:",
    ...symbols,
    "---",
    "# Service module map",
    "",
    "## Responsibilities",
    "",
    '<!-- context:section id="responsibility" source_ref="repo:service#symbol:entry" -->',
    "Thin summary.",
    "<!-- /context:section -->",
    "",
  ].join("\n"), "utf8");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("0.6.18 code-index Agent audit", () => {
  test("detects evidence-heavy thin aggregate content without hard-rejecting it", async () => {
    const projectRoot = await projectWithThinAggregate();
    const report = await buildCodeIndexAuditReport(projectRoot);
    expect(report?.summary.pages).toBe(1);
    expect(report?.pages).toHaveLength(1);
    expect(report?.signals.map((signal) => signal.code)).toContain("evidence-heavy-thin-body");
    expect(report?.review_requirements.choose).toEqual(["accept", "revise", "request-input"]);
    expect(effectiveMarkdownChars("# Heading\n\nUseful explanation.")).toBeGreaterThan(0);
  });

  test("persists a revise decision and invalidates it when approved content changes", async () => {
    const projectRoot = await projectWithThinAggregate();
    const report = await buildCodeIndexAuditReport(projectRoot);
    if (report === undefined) throw new Error("expected audit report");
    const record = await applyCodeIndexAuditDecision({
      projectRoot,
      payload: {
        schema: "context.code-index-audit-decision.v1",
        report_digest: report.digest,
        decision: "revise",
        summary: "The module map is too thin for its evidence scope.",
        reviewed_units: report.units.map((unit) => unit.id),
        scope_assessment: {
          matches_requested_scope: true,
          omissions: [],
          summary: "The registered source is represented, but its explanation is insufficient.",
        },
        signal_assessments: report.signals
          .filter((signal) => signal.severity === "elevated")
          .map((signal) => ({ signal_id: signal.id, disposition: "fix", reason: "Narrow and explain the affected section." })),
        revision_plan: {
          units: report.units.map((unit) => unit.id),
          actions: ["Aggregate evidence into source-backed responsibility and contract sections."],
        },
      },
    });
    expect(record.decision.decision).toBe("revise");
    expect((await collectCodeIndexAuditStatus(projectRoot)).revision_required).toBe(true);
    expect(JSON.parse(await readFile(join(projectRoot, CODE_INDEX_AUDIT_PATH), "utf8")).schema)
      .toBe("context.code-index-audit.v1");

    const page = join(projectRoot, "knowledge", "codegraph", "service", "module-map.md");
    await writeFile(page, `${await readFile(page, "utf8")}\nA new source-backed explanation changes the report.\n`, "utf8");
    const status = await collectCodeIndexAuditStatus(projectRoot);
    expect(status.current).toBe(false);
    expect(status.revision_required).toBe(false);
    expect(status.resolved).toBe(false);
  });
});
