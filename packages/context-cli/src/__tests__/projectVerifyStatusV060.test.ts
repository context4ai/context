import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import {
  appendDraftCandidate,
  acceptCurrentCodeIndexAudit,
  commitAll,
  createApprovedProject,
  invokeCliInDir,
  runCliInDir,
  writePackageTemplates,
} from "./projectBuildVerifyV060Helpers.js";

describe("0.6.0 project verify and status", () => {
  test("status excludes Markdown source assets from approved page counts", async () => {
    const fixture = await createApprovedProject();
    try {
      const assetDir = join(fixture.project, "knowledge", "assets", "synced-reference");
      mkdirSync(assetDir, { recursive: true });
      writeFileSync(join(assetDir, "reference.md"), "# Captured reference\n", "utf8");

      const status = JSON.parse(
        await runCliInDir(fixture.project, ["status", "--format", "json"]),
      ) as { counts: { approvedPages: number } };

      expect(status.counts.approvedPages).toBe(1);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("verify reports source-ref problems and status tracks package freshness", async () => {
    const fixture = await createApprovedProject();
    try {
      await runCliInDir(fixture.project, ["build"]);
      const verify = await runCliInDir(fixture.project, ["verify"]);
      expect(verify).toContain("✓ verified context project");

      const builtStatus = await runCliInDir(fixture.project, ["status"]);
      expect(builtStatus).toContain("state: workflow.complete");
      expect(builtStatus).toContain("package sample-kb: ready");
      expect(builtStatus).toContain("verify: 0 error(s), 0 warning(s)");

      rmSync(join(fixture.project, ".tmp", "context-runtime", "extract", "source-symbols.json"), { force: true });
      const missingSymbolIndexVerify = await runCliInDir(fixture.project, ["verify"]);
      expect(missingSymbolIndexVerify).toContain("extract-symbol-index-missing");
      expect(missingSymbolIndexVerify).toContain("1 warning");

      rmSync(join(fixture.project, ".tmp", "context-runtime", "extract", "source-fingerprints.json"), { force: true });
      const unknownBaselineStatus = await runCliInDir(fixture.project, ["status"]);
      expect(unknownBaselineStatus).toContain("state: route.extract.pending-target");
      expect(unknownBaselineStatus).toContain("source freshness: unknown");
      expect(unknownBaselineStatus).toContain("evidence status: pass-with-unverifiable-evidence");
      expect(unknownBaselineStatus).toContain("evidence warning: degraded");
      expect(unknownBaselineStatus).toContain("run extract:20260712/sample-a:codeindex");

      await runCliInDir(fixture.project, ["run", "extract:20260712/sample-a:codeindex"]);
      await runCliInDir(fixture.project, ["build"]);
      const builtAgentPath = join(fixture.project, "dist", "sample-kb", "AGENTS.md");
      writeFileSync(builtAgentPath, `${readFileSync(builtAgentPath, "utf8")}tampered=true\n`, "utf8");
      const tamperedOutputStatus = await runCliInDir(fixture.project, ["status"]);
      expect(tamperedOutputStatus).toContain("state: route.build.package-stale");
      expect(tamperedOutputStatus).toContain("package sample-kb: stale");

      await runCliInDir(fixture.project, ["build"]);
      appendDraftCandidate(fixture.project, fixture.sourceRef);
      writeFileSync(join(fixture.repo, "src", "Button.ts"), [
        "/** Primary button used by product screens after source update. */",
        "export function Button(label: string) {",
        "  return label;",
        "}",
        "",
      ].join("\n"), "utf8");
      const nextHead = commitAll(fixture.repo, "update button docs");
      await runCliInDir(fixture.project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "sample-a",
        "--local",
        "../repo-a",
        "--remote",
        "https://git.example.com/repo-a.git",
        "--ref",
        nextHead,
      ]);
      const sourceStaleStatus = await runCliInDir(fixture.project, ["status"]);
      expect(sourceStaleStatus).toContain("state: route.extract.preview-required");
      expect(sourceStaleStatus).toContain("source freshness: stale");
      expect(sourceStaleStatus).toContain("--workflow-revision");
      expect(sourceStaleStatus).toContain("run --preview-extraction-batch");
      expect(sourceStaleStatus).not.toContain("state: route.review.decision-required");

      await runCliInDir(fixture.project, [
        "run", "extract:20260712/sample-a:codeindex", "--auto-promote",
      ]);
      await acceptCurrentCodeIndexAudit(fixture.project);
      await runCliInDir(fixture.project, ["build"]);
      const templatePath = join(fixture.project, "src", "package-templates", "kb", "AGENTS.md");
      writeFileSync(templatePath, `${readFileSync(templatePath, "utf8")}template-changed=true\n`, "utf8");
      const staleStatus = await runCliInDir(fixture.project, ["status"]);
      expect(staleStatus).toContain("state: route.build.package-stale");
      expect(staleStatus).toContain("package sample-kb: stale");
      expect(staleStatus).toContain("--workflow-revision");
      expect(staleStatus).toContain("build --format json");

      rmSync(join(fixture.project, "src", "package-templates", "llms"), { recursive: true, force: true });
      const missingTemplateStatus = await runCliInDir(fixture.project, ["status"]);
      expect(missingTemplateStatus).toContain("state: route.workspace.state-invalid");
      expect(missingTemplateStatus).toContain("package template path is missing: src/package-templates/llms");
      writePackageTemplates(fixture.project);

      const approvedPath = join(fixture.project, "knowledge", `${fixture.approvedId}.md`);
      const approved = readFileSync(approvedPath, "utf8");
      const structurePath = join(fixture.project, "knowledge", "structure.yaml");
      const originalStructure = readFileSync(structurePath, "utf8");
      const structure = YAML.parse(originalStructure) as {
        views: Array<{ path: string; machine?: Record<string, unknown> }>;
      };
      const approvedView = structure.views.find((view) => view.path === `${fixture.approvedId}.md`);
      if (approvedView?.machine === undefined) throw new Error("expected approved machine metadata");
      delete approvedView.machine.code_symbols;
      delete approvedView.machine.code_symbol_table;
      writeFileSync(structurePath, YAML.stringify(structure), "utf8");
      const missingCodeSymbols = await invokeCliInDir(fixture.project, ["verify"]);
      expect(missingCodeSymbols.status).not.toBe(0);
      expect(missingCodeSymbols.stdout).toContain("approved-code-symbols-invalid");
      writeFileSync(structurePath, originalStructure, "utf8");

      writeFileSync(approvedPath, approved.replace("repo:20260712/sample-a", "repo:20260712/missing"), "utf8");
      const missingSource = await invokeCliInDir(fixture.project, ["verify"]);
      expect(missingSource.status).not.toBe(0);
      expect(missingSource.stdout).toContain("approved-source-missing");

      writeFileSync(approvedPath, approved.replace("sources:\n  - repo:20260712/sample-a\n", "sources:\n  - repo:20260712/sample-a\nsource_refs:\n  - src-1#block:document L1-1@abcdef12\n"), "utf8");
      const frontmatterSourceRefs = await invokeCliInDir(fixture.project, ["verify"]);
      expect(frontmatterSourceRefs.status).not.toBe(0);
      expect(frontmatterSourceRefs.stdout).toContain("approved-frontmatter-reserved-field");
      expect(frontmatterSourceRefs.stdout).toContain("source_refs");

      writeFileSync(approvedPath, approved.replace(/source_ref="src-1#symbol:[^"]+"/u, 'source_ref="src-1#block:document L1-1@abcdef12"'), "utf8");
      const blockRef = await invokeCliInDir(fixture.project, ["verify"]);
      expect(blockRef.status).not.toBe(0);
      expect(blockRef.stdout).toContain("approved-source-ref-invalid");

      writeFileSync(approvedPath, approved, "utf8");
      const symbolIndexPath = join(fixture.project, ".tmp", "context-runtime", "extract", "source-symbols.json");
      const symbolIndex = JSON.parse(readFileSync(symbolIndexPath, "utf8")) as Record<string, unknown>;
      writeFileSync(symbolIndexPath, `${JSON.stringify({ ...symbolIndex, symbols: [] }, null, 2)}\n`, "utf8");
      const missingIndexedSource = await invokeCliInDir(fixture.project, ["verify"]);
      expect(missingIndexedSource.status).not.toBe(0);
      expect(missingIndexedSource.stdout).toContain("approved-source-ref-stale");
      writeFileSync(symbolIndexPath, `${JSON.stringify(symbolIndex, null, 2)}\n`, "utf8");

      writeFileSync(approvedPath, approved.replace(/@[a-f0-9]+/u, "@000000000000"), "utf8");
      const staleRef = await invokeCliInDir(fixture.project, ["verify"]);
      expect(staleRef.status).not.toBe(0);
      expect(staleRef.stdout).toContain("approved-source-ref-stale");

      writeFileSync(approvedPath, approved.replace("src-1#symbol:", "src-2#symbol:"), "utf8");
      const broken = await invokeCliInDir(fixture.project, ["verify"]);
      expect(broken.status).not.toBe(0);
      expect(broken.stdout).toContain("approved-source-ref-source-missing");
      expect(broken.stderr).toContain("schema-invalid");

      const brokenStatus = await runCliInDir(fixture.project, ["status"]);
      expect(brokenStatus).toContain("state: route.verify.failed");
      expect(brokenStatus).toContain("diagnostic project: verify error approved-source-ref-source-missing");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("status reports project configuration errors without stale source guidance", async () => {
    const fixture = await createApprovedProject();
    try {
      const projectEntry = join(fixture.project, "src", "index.ts");
      const originalEntry = readFileSync(projectEntry, "utf8");

      writeFileSync(projectEntry, originalEntry.replace('source("20260712", "sample-a")', 'source("20260712", "missing-a")'), "utf8");
      const missingPhaseSource = await runCliInDir(fixture.project, ["status"]);
      expect(missingPhaseSource).toContain("state: route.workspace.state-invalid");
      expect(missingPhaseSource).toContain("extract phase extract:20260712/missing-a:codeindex has no matching repo source");
      expect(missingPhaseSource).not.toContain("Source inputs changed");

      writeFileSync(projectEntry, originalEntry, "utf8");
      await runCliInDir(fixture.project, ["build"]);
      const existingPackageFile = join(fixture.project, "dist", "sample-kb", "AGENTS.md");
      const existingPackageContent = readFileSync(existingPackageFile, "utf8");

      writeFileSync(projectEntry, originalEntry.replace('displayName: "Sample KB"', 'displayName: "../escape"'), "utf8");
      writeFileSync(
        join(fixture.project, "src", "package-templates", "kb", "{{displayName}}.txt"),
        "unsafe path fixture\n",
        "utf8",
      );
      const unsafeTemplateStatus = await runCliInDir(fixture.project, ["status"]);
      expect(unsafeTemplateStatus).toContain("state: route.workspace.state-invalid");
      expect(unsafeTemplateStatus).toContain("package template path rendered an unsafe path");

      const unsafeTemplateBuild = await invokeCliInDir(fixture.project, ["build"]);
      expect(unsafeTemplateBuild.status).not.toBe(0);
      expect(unsafeTemplateBuild.stderr).toContain("package template path rendered an unsafe path");
      expect(readFileSync(existingPackageFile, "utf8")).toBe(existingPackageContent);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("verify reports approved source refs when registry is empty", async () => {
    const fixture = await createApprovedProject();
    try {
      writeFileSync(join(fixture.project, "sources", "repo", "index.yaml"), "sources: []\n", "utf8");
      const result = await invokeCliInDir(fixture.project, ["verify"]);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("approved-source-missing");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
