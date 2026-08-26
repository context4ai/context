import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyCodeIndexAuditDecision,
  buildCodeIndexAuditReport,
  collectCodeIndexAuditStatus,
  CODE_INDEX_AUDIT_STATE_PATH,
  effectiveMarkdownChars,
} from "../project/codeIndexAudit.js";
import { stableHash } from "../project/extractCandidateArtifacts.js";

const roots: string[] = [];

async function projectWithThinAggregate(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-code-index-audit-"));
  roots.push(root);
  const path = join(root, "knowledge", "codegraph", "service", "module-map.md");
  await mkdir(join(root, "knowledge", "codegraph", "service"), { recursive: true });
  const symbols = Array.from({ length: 100 }, (_, index) => `  - "service|src/file-${index}.ts|symbol-${index}"`);
  const evidence = Array.from({ length: 100 }, (_, index) => `  - "repo:service#symbol:symbol-${index}"`);
  await writeFile(path, [
    "---",
    'title: "Service module map"',
    'type: "Wiki"',
    'node_ref: "codegraph:service/module-map"',
    'view_ref: "codegraph:service/module-map"',
    'visibility: "exported"',
    "code_symbols:",
    ...symbols,
    "code_evidence:",
    ...evidence,
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

  test("treats reader-facing sections without scoped evidence as an absolute gate", async () => {
    const projectRoot = await projectWithThinAggregate();
    const page = join(projectRoot, "knowledge", "codegraph", "service", "module-map.md");
    const content = await readFile(page, "utf8");
    await writeFile(page, content.replace(
      '<!-- context:section id="responsibility" source_ref="repo:service#symbol:entry" -->',
      '<!-- context:section id="responsibility" -->',
    ), "utf8");
    const report = await buildCodeIndexAuditReport(projectRoot);
    expect(report?.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "section-without-evidence", absolute_gate: true }),
      expect.objectContaining({ code: "page-level-evidence-overbroad", absolute_gate: true }),
    ]));
    expect(report?.units[0]?.action_guidance).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "scope-section-evidence",
        failed_dimensions: expect.arrayContaining(["section-without-evidence"]),
        affected_pages: ["codegraph:service/module-map"],
        configuration_fields: ["indexUnits[].sections[].evidence"],
        template_paths: expect.any(Array),
      }),
    ]));
  });

  test("rejects repeating the complete page evidence set on every Section", async () => {
    const projectRoot = await projectWithThinAggregate();
    const page = join(projectRoot, "knowledge", "codegraph", "service", "module-map.md");
    const content = await readFile(page, "utf8");
    const refs = Array.from({ length: 100 }, (_, index) => `repo:service#symbol:symbol-${index}`);
    const sections = ["responsibility", "contract"].flatMap((id) => [
      `## ${id}`,
      "",
      `<!-- context:section id="${id}" source_ref="${refs[0]}" -->`,
      "",
      "<!-- context:source_refs",
      JSON.stringify(refs),
      "/context:source_refs -->",
      "",
      `${id} explanation.`,
      "<!-- /context:section -->",
      "",
    ]).join("\n");
    await writeFile(page, content.replace(/## Responsibilities[\s\S]*$/u, sections), "utf8");
    const report = await buildCodeIndexAuditReport(projectRoot);
    expect(report?.signals).toContainEqual(expect.objectContaining({
      code: "section-evidence-not-scoped",
      absolute_gate: true,
      recommended_actions: ["scope-section-evidence"],
    }));
  });

  test("persists a revise decision and invalidates it when approved content changes", async () => {
    const projectRoot = await projectWithThinAggregate();
    const report = await buildCodeIndexAuditReport(projectRoot);
    if (report === undefined) throw new Error("expected audit report");
    const result = await applyCodeIndexAuditDecision({
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
    expect(result.record.decision.decision).toBe("revise");
    expect((await collectCodeIndexAuditStatus(projectRoot)).revision_required).toBe(true);
    const stateText = await readFile(join(projectRoot, CODE_INDEX_AUDIT_STATE_PATH), "utf8");
    const state = JSON.parse(stateText) as Record<string, unknown>;
    expect(state.schema).toBe("context.code-index-audit.v3");
    expect(state.report).toBeUndefined();
    expect(state.history).toBeUndefined();
    expect(state.retry_history).toBeArray();
    expect(Buffer.byteLength(stateText)).toBeLessThan(Buffer.byteLength(JSON.stringify(report)));
    expect(CODE_INDEX_AUDIT_STATE_PATH.startsWith(".tmp/context-runtime/")).toBe(true);
    expect(existsSync(join(projectRoot, "knowledge", "code-index-audit.json"))).toBe(false);

    const page = join(projectRoot, "knowledge", "codegraph", "service", "module-map.md");
    await writeFile(page, `${await readFile(page, "utf8")}\nA new source-backed explanation changes the report.\n`, "utf8");
    const status = await collectCodeIndexAuditStatus(projectRoot);
    expect(status.current).toBe(false);
    expect(status.revision_required).toBe(false);
    expect(status.resolved).toBe(false);
  });

  test("recomputes the audit after disposable runtime state is removed", async () => {
    const projectRoot = await projectWithThinAggregate();
    const report = await buildCodeIndexAuditReport(projectRoot);
    if (report === undefined) throw new Error("expected audit report");
    await applyCodeIndexAuditDecision({
      projectRoot,
      payload: {
        schema: "context.code-index-audit-decision.v1",
        report_digest: report.digest,
        decision: "revise",
        summary: "The intentionally narrow fixture requires revision.",
        reviewed_units: report.units.map((unit) => unit.id),
        scope_assessment: { matches_requested_scope: true, omissions: [], summary: "Complete." },
        signal_assessments: report.signals
          .filter((signal) => signal.severity === "elevated")
          .map((signal) => ({ signal_id: signal.id, disposition: "fix", reason: "Revise the fixture." })),
        revision_plan: { units: report.units.map((unit) => unit.id), actions: ["add source-backed explanation"] },
      },
    });
    expect((await collectCodeIndexAuditStatus(projectRoot)).current).toBe(true);

    await rm(join(projectRoot, ".tmp"), { recursive: true, force: true });
    const status = await collectCodeIndexAuditStatus(projectRoot);
    expect(status.applicable).toBe(true);
    expect(status.current).toBe(false);
    expect(status.resolved).toBe(false);
    expect(status.report?.digest).toBe(report.digest);
  });

  test("requires one human guidance gate after three revisions of the same module problem", async () => {
    const projectRoot = await projectWithThinAggregate();
    const page = join(projectRoot, "knowledge", "codegraph", "service", "module-map.md");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const report = await buildCodeIndexAuditReport(projectRoot);
      if (report === undefined) throw new Error("expected audit report");
      await applyCodeIndexAuditDecision({
        projectRoot,
        payload: {
          schema: "context.code-index-audit-decision.v1",
          report_digest: report.digest,
          decision: "revise",
          summary: `Revision ${attempt} remains below the absolute quality bounds.`,
          reviewed_units: report.units.map((unit) => unit.id),
          scope_assessment: {
            matches_requested_scope: true,
            omissions: [],
            summary: "The current scope remains unchanged.",
          },
          signal_assessments: report.signals
            .filter((signal) => signal.severity === "elevated")
            .map((signal) => ({ signal_id: signal.id, disposition: "fix", reason: "Apply the reported mechanical action." })),
          revision_plan: {
            units: report.units.map((unit) => unit.id),
            actions: ["add-module-explanation"],
          },
        },
      });
      if (attempt < 3) {
        await writeFile(page, `${await readFile(page, "utf8")}\nRevision ${attempt} changes wording but not the failed dimensions.\n`, "utf8");
      }
    }
    const status = await collectCodeIndexAuditStatus(projectRoot);
    expect(status.guidance_required).toBe(true);
    expect(status.revision_required).toBe(false);
    expect(status.guidance_units).toEqual([
      expect.objectContaining({
        unit_id: "service",
        attempts: 3,
        dimension_deltas: expect.arrayContaining([
          expect.objectContaining({ dimension: "semantic-fact-lines" }),
        ]),
      }),
    ]);
    expect(status.report?.units[0]?.action_guidance).toEqual(expect.arrayContaining([
      expect.objectContaining({
        affected_pages: ["codegraph:service/module-map"],
        configuration_fields: expect.any(Array),
        template_paths: expect.any(Array),
      }),
    ]));
    expect(status.report?.units[0]?.dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dimension: "explanatory-lines",
        previous_observed: expect.any(Number),
        delta: expect.any(Number),
      }),
    ]));
  });

  test("counts repeated revisions when wording and mechanical metrics do not change", async () => {
    const projectRoot = await projectWithThinAggregate();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const report = await buildCodeIndexAuditReport(projectRoot);
      if (report === undefined) throw new Error("expected audit report");
      await applyCodeIndexAuditDecision({
        projectRoot,
        payload: {
          schema: "context.code-index-audit-decision.v1",
          report_digest: report.digest,
          decision: "revise",
          summary: `Revision ${attempt} did not change the measured problem.`,
          reviewed_units: report.units.map((unit) => unit.id),
          scope_assessment: {
            matches_requested_scope: true,
            omissions: [],
            summary: "The source scope and report digest remain unchanged.",
          },
          signal_assessments: report.signals
            .filter((signal) => signal.severity === "elevated")
            .map((signal) => ({ signal_id: signal.id, disposition: "fix", reason: "Retry the same reported action." })),
          revision_plan: {
            units: report.units.map((unit) => unit.id),
            actions: ["add-module-explanation"],
          },
        },
      });
    }
    const status = await collectCodeIndexAuditStatus(projectRoot);
    expect(status.guidance_required).toBe(true);
    expect(status.guidance_units).toEqual([
      expect.objectContaining({ unit_id: "service", attempts: 3 }),
    ]);
    const state = JSON.parse(await readFile(join(projectRoot, CODE_INDEX_AUDIT_STATE_PATH), "utf8")) as {
      retry_history: unknown[];
    };
    expect(state.retry_history).toHaveLength(3);
  });

  test("rechecks absolute gates after formal review narrows an accepted candidate set", async () => {
    const projectRoot = await projectWithThinAggregate();
    const currentReport = await buildCodeIndexAuditReport(projectRoot);
    if (currentReport === undefined) throw new Error("expected audit report");
    const acceptedCandidateReport = {
      ...currentReport,
      source: "draft-and-approved" as const,
      scope_digest: "sha256:accepted-candidate-superset",
      pages: [
        ...currentReport.pages,
        {
          ...currentReport.pages[0]!,
          view_ref: "codegraph:service/rejected-detail",
          path: "codegraph/service/rejected-detail.md",
          candidate_fingerprint: "candidate-rejected-by-review",
        },
      ],
    };
    await mkdir(join(projectRoot, ".tmp", "context-runtime", "code-index-audit"), { recursive: true });
    await writeFile(join(projectRoot, CODE_INDEX_AUDIT_STATE_PATH), JSON.stringify({
      schema: "context.code-index-audit.v3",
      scope_digest: acceptedCandidateReport.scope_digest,
      decision: {
        schema: "context.code-index-audit-decision.v1",
        report_digest: acceptedCandidateReport.digest,
        decision: "accept",
        summary: "The candidate superset passed before formal review.",
        reviewed_units: acceptedCandidateReport.units.map((unit) => unit.id),
        scope_assessment: { matches_requested_scope: true, omissions: [], summary: "Complete." },
        signal_assessments: [],
      },
      retry_history: [],
      accepted_draft_page_digests: acceptedCandidateReport.pages.map((page) => stableHash({
          candidate_fingerprint: page.candidate_fingerprint,
          view_ref: page.view_ref,
      })),
    }, null, 2), "utf8");

    const status = await collectCodeIndexAuditStatus(projectRoot);
    expect(status.report?.source).toBe("approved");
    expect(status.report?.units.some((unit) => unit.absolute_failure_count > 0)).toBe(true);
    expect(status.current).toBe(false);
    expect(status.resolved).toBe(false);
  });

  test("subtracts repeated generic boilerplate from semantic facts on every affected page", async () => {
    const projectRoot = await projectWithThinAggregate();
    const originalPath = join(projectRoot, "knowledge", "codegraph", "service", "module-map.md");
    const original = await readFile(originalPath, "utf8");
    const repeated = "This module provides stable application behavior for downstream consumers while keeping operational responsibilities explicit and observable across supported execution environments.";
    await writeFile(originalPath, `${original.trimEnd()}\n\n${repeated}\n`, "utf8");
    for (const name of ["runtime", "contracts"]) {
      const directory = join(projectRoot, "knowledge", "codegraph", name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "module-map.md"),
        `${original.replaceAll("service", name).trimEnd()}\n\n${repeated}\n`,
        "utf8",
      );
    }

    const report = await buildCodeIndexAuditReport(projectRoot);
    expect(report?.signals.filter((signal) => signal.code === "cross-page-boilerplate")).toHaveLength(3);
    expect(report?.pages).toEqual(expect.arrayContaining([
      expect.objectContaining({ repeated_boilerplate_fact_lines: 1 }),
      expect.objectContaining({ repeated_boilerplate_fact_lines: 1 }),
      expect.objectContaining({ repeated_boilerplate_fact_lines: 1 }),
    ]));
    const boilerplateGuidance = report?.units.flatMap((unit) =>
      unit.action_guidance.filter((guidance) => guidance.action === "remove-template-residue")
    ) ?? [];
    expect(boilerplateGuidance).toHaveLength(3);
    expect(boilerplateGuidance.every((guidance) =>
      guidance.failed_dimensions.includes("cross-page-boilerplate")
    )).toBe(true);
    expect(boilerplateGuidance.flatMap((guidance) => guidance.affected_pages).sort()).toEqual([
      "codegraph:contracts/module-map",
      "codegraph:runtime/module-map",
      "codegraph:service/module-map",
    ]);
  });
});
