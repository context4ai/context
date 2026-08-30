import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { invokeCliInDir, runCliInDir } from "./projectBuildVerifyV060Helpers.js";

const DIGEST = `sha256:${"a".repeat(64)}`;

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "context-indexer-requirement-v070-"));
  mkdirSync(join(root, "sources", "repo"), { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    name: "requirement-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`);
  writeFileSync(join(root, "sources", "repo", "index.yaml"), YAML.stringify({
    sources: [{
      name: "20260827",
      modules: [{
        name: "service",
        git: {
          remote: "https://example.com/service.git",
          ref: "0123456789abcdef0123456789abcdef01234567",
        },
      }],
    }],
  }));
  return root;
}

function writePayload(root: string, name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function requirementInput(readerGoals = ["understand"]) {
  return {
    protocol: "context.indexer.requirement-inspection-input/v1",
    project_ref: "project:requirement-fixture",
    requirements: [{
      id: "service-understanding",
      reader_goals: readerGoals,
      coverage_domains: {
        architecture: "required",
        operations: "optional",
      },
      target_scope: {
        targets: [{ source_ref: "repo:service", module_refs: [] }],
      },
      evidence_source_scope: {
        targets: [{ source_ref: "repo:service", module_refs: [] }],
      },
    }],
  };
}

describe("0.7.0 project Indexer requirement lifecycle", () => {
  test("runs inspect, summary, compare, confirm, and atomic first apply through CLI", async () => {
    const root = fixture();
    const requestPath = writePayload(root, "request.json", requirementInput());

    const inspection = JSON.parse(await runCliInDir(root, [
      "indexer",
      "inspect-index-requirements",
      "--input",
      requestPath,
      "--format",
      "json",
    ]));
    expect(inspection.requirement_set.requirements[0].target_scope.targets[0].source_ref)
      .toBe("repo:20260827/service");

    const summary = JSON.parse(await runCliInDir(root, [
      "indexer",
      "inspect-index-requirements",
      "--input",
      requestPath,
      "--view",
      "summary",
      "--format",
      "json",
    ]));
    expect(summary.protocol).toBe("context.indexer.requirement-summary-view/v1");
    expect(summary.scenarios[0].scenario).toBe("service-understanding");
    expect(summary.scenarios[0].capabilities).toEqual([
      { coverage_domain: "architecture", obligation: "required" },
      { coverage_domain: "operations", obligation: "optional" },
    ]);
    expect(summary.scenarios[0].evidence_kinds).toEqual([]);

    const inspectionPath = writePayload(root, "inspection.json", inspection);
    const report = JSON.parse(await runCliInDir(root, [
      "indexer",
      "compare-index-requirements",
      "--input",
      inspectionPath,
      "--format",
      "json",
    ]));
    expect(report.relation).toBe("strengthening");
    expect(report.base_requirement_set).toBeNull();
    expect(report.changes[0].kind).toBe("added");

    const reportPath = writePayload(root, "report.json", report);
    const confirmation = JSON.parse(await runCliInDir(root, [
      "indexer",
      "confirm-index-requirements",
      "--input",
      reportPath,
      "--authority",
      "managed",
      "--confirmed-by",
      "context-agent",
      "--confirmed-at",
      "2026-08-27T10:00:00+08:00",
      "--format",
      "json",
    ]));
    expect(confirmation.gate).toBe("confirm-index-requirements");

    const confirmationPath = writePayload(root, "confirmation.json", confirmation);
    const receipt = JSON.parse(await runCliInDir(root, [
      "indexer",
      "apply-index-requirements",
      "--inspection",
      inspectionPath,
      "--report",
      reportPath,
      "--confirmation",
      confirmationPath,
      "--format",
      "json",
    ]));
    expect(receipt.outcome).toBe("indexer-provider-required");
    expect(receipt.stale_propagation).toMatchObject({
      requirement_digest_changed: true,
      invalidated_indexer_count: 0,
      previous_indexer_selection_digest: null,
      reason: "requirement-digest-changed",
    });
    expect(YAML.parse(readFileSync(join(root, "src", "indexers.yaml"), "utf8")))
      .toMatchObject({
        protocol: "context.indexer.registry/v1",
        indexers: [],
      });
  });

  test("rejects a draft after its registered source boundary changes", async () => {
    const root = fixture();
    const requestPath = writePayload(root, "request.json", requirementInput());
    const inspection = JSON.parse(await runCliInDir(root, [
      "indexer",
      "inspect-index-requirements",
      "--input",
      requestPath,
      "--format",
      "json",
    ]));
    const inspectionPath = writePayload(root, "inspection.json", inspection);

    const registryPath = join(root, "sources", "repo", "index.yaml");
    const registry = YAML.parse(readFileSync(registryPath, "utf8"));
    registry.sources[0].modules[0].git.ref = "fedcba9876543210fedcba9876543210fedcba98";
    writeFileSync(registryPath, YAML.stringify(registry));

    const result = await invokeCliInDir(root, [
      "indexer",
      "compare-index-requirements",
      "--input",
      inspectionPath,
      "--format",
      "json",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("source boundary is stale");
  });

  test("clears stale Provider ownership when the requirement digest changes", async () => {
    const root = fixture();
    const initialPath = writePayload(root, "initial.json", requirementInput());
    const initialInspection = JSON.parse(await runCliInDir(root, [
      "indexer", "inspect-index-requirements", "--input", initialPath, "--format", "json",
    ]));
    const initialInspectionPath = writePayload(root, "initial-inspection.json", initialInspection);
    const initialReport = JSON.parse(await runCliInDir(root, [
      "indexer", "compare-index-requirements", "--input", initialInspectionPath, "--format", "json",
    ]));
    const initialReportPath = writePayload(root, "initial-report.json", initialReport);
    const initialConfirmation = JSON.parse(await runCliInDir(root, [
      "indexer", "confirm-index-requirements", "--input", initialReportPath,
      "--authority", "managed", "--confirmed-by", "context-agent",
      "--confirmed-at", "2026-08-27T10:00:00+08:00", "--format", "json",
    ]));
    const initialConfirmationPath = writePayload(root, "initial-confirmation.json", initialConfirmation);
    await runCliInDir(root, [
      "indexer", "apply-index-requirements",
      "--inspection", initialInspectionPath,
      "--report", initialReportPath,
      "--confirmation", initialConfirmationPath,
      "--format", "json",
    ]);

    const registryPath = join(root, "src", "indexers.yaml");
    const selected = YAML.parse(readFileSync(registryPath, "utf8"));
    selected.indexers = [{
      id: "service-indexer",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "service-understanding",
        coverage_domains: ["architecture"],
        owned_scope: { ref: "requirement:service-understanding#target_scope" },
        role: "primary",
      }],
      read_scope: {
        refs: ["requirement:service-understanding#target_scope"],
      },
      profile: {
        primary: { id: "service", provider: "community" },
        additional: [],
        composers: [],
      },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-code-indexer",
        version: "0.7.0",
        integrity: DIGEST,
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-code-indexer",
        },
      }],
    }];
    writeFileSync(registryPath, YAML.stringify(selected));

    const strengthenedPath = writePayload(
      root,
      "strengthened.json",
      requirementInput(["operate", "understand"]),
    );
    const strengthenedInspection = JSON.parse(await runCliInDir(root, [
      "indexer", "inspect-index-requirements", "--input", strengthenedPath, "--format", "json",
    ]));
    const strengthenedInspectionPath = writePayload(
      root,
      "strengthened-inspection.json",
      strengthenedInspection,
    );
    const strengthenedReport = JSON.parse(await runCliInDir(root, [
      "indexer", "compare-index-requirements", "--input", strengthenedInspectionPath,
      "--format", "json",
    ]));
    expect(strengthenedReport.relation).toBe("strengthening");
    const strengthenedReportPath = writePayload(
      root,
      "strengthened-report.json",
      strengthenedReport,
    );
    const strengthenedConfirmation = JSON.parse(await runCliInDir(root, [
      "indexer", "confirm-index-requirements", "--input", strengthenedReportPath,
      "--authority", "managed", "--confirmed-by", "context-agent",
      "--confirmed-at", "2026-08-27T10:10:00+08:00", "--format", "json",
    ]));
    const strengthenedConfirmationPath = writePayload(
      root,
      "strengthened-confirmation.json",
      strengthenedConfirmation,
    );
    const receipt = JSON.parse(await runCliInDir(root, [
      "indexer", "apply-index-requirements",
      "--inspection", strengthenedInspectionPath,
      "--report", strengthenedReportPath,
      "--confirmation", strengthenedConfirmationPath,
      "--format", "json",
    ]));

    expect(receipt.outcome).toBe("indexer-provider-required");
    expect(receipt.stale_propagation.requirement_digest_changed).toBe(true);
    expect(receipt.stale_propagation.invalidated_indexer_count).toBe(1);
    expect(receipt.stale_propagation.previous_indexer_selection_digest).toStartWith("sha256:");
    expect(YAML.parse(readFileSync(registryPath, "utf8")).indexers).toEqual([]);
  });

  test("does not delegate a contraction confirmation", async () => {
    const root = fixture();
    const initialPath = writePayload(root, "initial.json", requirementInput([
      "operate",
      "understand",
    ]));
    const initialInspection = JSON.parse(await runCliInDir(root, [
      "indexer", "inspect-index-requirements", "--input", initialPath, "--format", "json",
    ]));
    const initialInspectionPath = writePayload(root, "initial-inspection.json", initialInspection);
    const initialReport = JSON.parse(await runCliInDir(root, [
      "indexer", "compare-index-requirements", "--input", initialInspectionPath, "--format", "json",
    ]));
    const initialReportPath = writePayload(root, "initial-report.json", initialReport);
    const initialConfirmation = JSON.parse(await runCliInDir(root, [
      "indexer", "confirm-index-requirements", "--input", initialReportPath,
      "--authority", "managed", "--confirmed-by", "context-agent",
      "--confirmed-at", "2026-08-27T10:00:00+08:00", "--format", "json",
    ]));
    const initialConfirmationPath = writePayload(
      root,
      "initial-confirmation.json",
      initialConfirmation,
    );
    await runCliInDir(root, [
      "indexer", "apply-index-requirements",
      "--inspection", initialInspectionPath,
      "--report", initialReportPath,
      "--confirmation", initialConfirmationPath,
      "--format", "json",
    ]);

    const reducedPath = writePayload(root, "reduced.json", requirementInput(["understand"]));
    const reducedInspection = JSON.parse(await runCliInDir(root, [
      "indexer", "inspect-index-requirements", "--input", reducedPath, "--format", "json",
    ]));
    const reducedInspectionPath = writePayload(root, "reduced-inspection.json", reducedInspection);
    const contraction = JSON.parse(await runCliInDir(root, [
      "indexer", "compare-index-requirements", "--input", reducedInspectionPath, "--format", "json",
    ]));
    expect(contraction.requires_human_confirmation).toBe(true);
    const contractionPath = writePayload(root, "contraction.json", contraction);
    const result = await invokeCliInDir(root, [
      "indexer", "confirm-index-requirements", "--input", contractionPath,
      "--authority", "managed", "--confirmed-by", "context-agent", "--format", "json",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("cannot be delegated");
  });

  test("rejects an unknown source before producing an inspection digest", async () => {
    const root = fixture();
    const request = requirementInput();
    request.requirements[0]!.target_scope.targets[0]!.source_ref = "repo:missing";
    const requestPath = writePayload(root, "unknown.json", request);
    const result = await invokeCliInDir(root, [
      "indexer", "inspect-index-requirements", "--input", requestPath, "--format", "json",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("source_ref is not registered");
  });
});
