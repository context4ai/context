import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import {
  createCapturedCompileProject,
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  sourceRefs,
  stageConfirmedRichStructure,
  writeJsonl,
  writeYaml,
} from "./projectCompileProseV066Helpers.js";

describe("0.6.6 compileProse source-bound runner", () => {
  test("compile Views keep structure confirmed, then validation freezes it before staging candidates", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      expect(refs.length).toBeGreaterThanOrEqual(3);
      await stageConfirmedRichStructure(projectRoot, refs);
      const structureStatus = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        stagedStructure: { state: string };
        routing: { current_state: string; recommended_action: string; command_plan: Array<{ command: string }> };
      };
      expect(structureStatus.state).toBe("route.indexer.lifecycle-required");
      expect(structureStatus.stagedStructure.state).toBe("confirmed");
      expect(structureStatus.routing.current_state).toBe("route.indexer.lifecycle-required");
      expect(structureStatus.routing.recommended_action).toContain(
        "sole registry-and-Provider indexing lifecycle",
      );
      expect(structureStatus.routing.command_plan).toEqual([]);

      const readPlan = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "read-plan",
        "--format",
        "json",
      ])) as {
        result: {
          read_plan: {
            nodes: Array<{
              view_ref: string;
              node_ref: string;
              collection: string;
              title: string;
              sections: number;
              section_ids: string[];
            }>;
            source_overview: { documents: number; spans: number; document_index: Array<{ path: string; spans: number }> };
          };
          semantic_rules: { handle: string; digest: string; required: Array<{ id: string; content_digest: string; content_available: boolean; reason: string }> };
          next_action: { kind: string; command: string };
        };
      };
      expect(readPlan.result.read_plan.nodes.map((node) => node.view_ref)).toContain("architecture:entity/install");
      expect(readPlan.result.read_plan.nodes.map((node) => node.node_ref)).toContain("entity/install");
      expect(readPlan.result.read_plan.nodes[0]?.section_ids).toContain("install-1");
      expect(readPlan.result.read_plan.source_overview.documents).toBeGreaterThanOrEqual(1);
      expect(readPlan.result.read_plan.source_overview.spans).toBeGreaterThanOrEqual(1);
      expect(readPlan.result.read_plan.source_overview.document_index.some((item) => item.path === "guide.md")).toBe(true);
      expect(readPlan.result).not.toHaveProperty("semantic_reference_files");
      expect(readPlan.result.semantic_rules.handle).toMatch(/^context-rules:compile:[a-f0-9]{16}$/u);
      expect(readPlan.result.next_action).toMatchObject({
        kind: "validate_compile_batch",
        command: "context run compile:file:product-docs:architecture --validate --format json",
      });

      const context = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "node-context",
        "--source",
        "architecture:entity/install",
        "--format",
        "json",
      ])) as {
        result: {
          semantic_rules: { handle: string; digest: string; required: Array<{ id: string; content_digest: string; content_available: boolean; reason: string }> };
          node_context: {
            node: { view_ref: string; node_ref: string };
            planned_sections: Array<{ source_refs: string[]; local_source_refs: string[] }>;
            existing: { path: string; present: boolean; sections: unknown[] };
            incremental: { status: string; locator_only_changes: unknown[]; unknown_inputs: unknown[] };
          };
        };
      };
      expect(context.result.node_context.node.view_ref).toBe("architecture:entity/install");
      expect(context.result.node_context.node.node_ref).toBe("entity/install");
      expect(context.result.node_context.planned_sections[0]?.source_refs[0]).toBe(refs[0]);
      expect(context.result.node_context.planned_sections[0]?.local_source_refs[0]).toMatch(/^src-1#span:/u);
      expect(context.result.node_context.existing).toEqual({
        path: "knowledge/architecture/install/overview.md",
        present: false,
        sections: [],
      });
      expect(context.result.node_context.incremental).toEqual({
        status: "changed-only",
        locator_only_changes: [],
        unknown_inputs: [],
      });
      const nodeRuleIds = context.result.semantic_rules.required.map((rule) => rule.id);
      expect(nodeRuleIds).toEqual(["compile-actions", "compile-judgment", "semantic-judgment"]);
      expect(context.result.semantic_rules.required.every((rule) => rule.content_available && rule.content_digest.startsWith("sha256:") && rule.reason.length > 0)).toBe(true);
      const compileRules = JSON.parse(await runCliInDir(projectRoot, [
        "run", "compile:file:product-docs:architecture", "--view", "semantic-rules",
        "--source", "architecture:entity/install", "--format", "json",
      ])) as { result: { required: Array<{ id: string }> } };
      expect(compileRules.result.required.map((rule) => rule.id)).toContain("compile-actions");
      const compileRulePage = JSON.parse(await runCliInDir(projectRoot, [
        "run", "compile:file:product-docs:architecture", "--view", "semantic-rules",
        "--source", "architecture:entity/install", "--rule", "compile-actions",
        "--page-size", "4", "--format", "json",
      ])) as {
        result: {
          rule: {
            resource_id: string;
            content_digest: string;
            resource: { path: string };
          };
        };
      };
      expect(compileRulePage.result.rule.resource_id).toBe("context.semantic.compile.compile-actions");
      expect(compileRulePage.result.rule.content_digest).toMatch(/^sha256:/u);
      expect(compileRulePage.result.rule.resource.path).toEndWith("resources/semantic/compile/compile-actions.md");
      expect(readFileSync(compileRulePage.result.rule.resource.path, "utf8")).toContain("Section Kind Choice");
      expect(JSON.stringify(compileRulePage.result)).not.toContain('"content":');

      const schemaView = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "schema",
        "--format",
        "json",
      ])) as { result: { payload_schema: Record<string, unknown> } };
      expect("notes" in schemaView.result.payload_schema).toBe(false);
      expect(schemaView.result.payload_schema.allowed_ops).toEqual(["add", "update", "skip"]);
      expect(Array.isArray(schemaView.result.payload_schema.actions)).toBe(true);

      const afterViews = YAML.parse(readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), "utf8")) as {
        lifecycle: { state: string; frozen_snapshot_hash?: string };
        user_or_agent_hints?: { grouping_notes?: string[] };
      };
      expect(afterViews.lifecycle.state).toBe("confirmed");
      expect(afterViews.lifecycle.frozen_snapshot_hash).toBeUndefined();
      expect(afterViews.user_or_agent_hints?.grouping_notes).toContain("Keep setup concepts together when evidence supports it.");

      const actionFile = writeYaml(projectRoot, "compile-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-1",
          kind: "description",
          summary: "Install source span",
          source_refs: [context.result.node_context.planned_sections[0]!.local_source_refs[0]],
        }],
      });
      const valid = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        actionFile,
        "--format",
        "json",
      ])) as { result: { state: string; sections: number } };
      expect(valid.result.state).toBe("ready");
      expect(valid.result.sections).toBe(1);
      const compileDiagnostics = JSON.parse(await runCliInDir(projectRoot, [
        "run", "compile:file:product-docs:architecture", "--view", "diagnostics",
        "--input", actionFile, "--format", "json",
      ])) as { result: { diagnostics_summary: { total: number }; next_action: { kind: string } } };
      expect(compileDiagnostics.result.diagnostics_summary.total).toBe(0);
      expect(compileDiagnostics.result.next_action.kind).toBe("diagnostics_complete");
      const frozen = YAML.parse(readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), "utf8")) as {
        lifecycle: { state: string; frozen_snapshot_hash?: string };
      };
      expect(frozen.lifecycle.state).toBe("frozen");
      expect(frozen.lifecycle.frozen_snapshot_hash).toBeTruthy();

      const staged = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--stage",
        "--input",
        actionFile,
        "--format",
        "json",
      ])) as { result: { sections: number; candidateFile: string; candidates: { added: number } } };
      expect(staged.result.sections).toBe(1);
      expect(staged.result.candidateFile).toBe(".tmp/context-runtime/lifecycle/candidates.jsonl");
      expect(staged.result.candidates.added).toBe(1);
      const reviewReadyStatus = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        routing: { current_state: string; recommended_action: string };
      };
      expect(reviewReadyStatus.state).toBe("route.indexer.lifecycle-required");
      expect(reviewReadyStatus.routing.current_state).toBe("route.indexer.lifecycle-required");
      expect(reviewReadyStatus.routing.recommended_action).toContain("registry-and-Provider indexing lifecycle");
      const entryPath = join(projectRoot, "src", "index.ts");
      const collectionReviewEntry = readFileSync(entryPath, "utf8");
      writeFileSync(entryPath, collectionReviewEntry.replace('reviewValidity({ collection: "architecture" })', 'reviewValidity({ scope: "all" })'), "utf8");
      const allScopeStatus = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        routing: { recommended_action: string; command_plan: Array<{ command: string }> };
      };
      expect(allScopeStatus.state).toBe("route.indexer.lifecycle-required");
      expect(allScopeStatus.routing.recommended_action).toContain("registry-and-Provider indexing lifecycle");
      expect(allScopeStatus.routing.command_plan).toEqual([]);
      writeFileSync(entryPath, collectionReviewEntry, "utf8");
      const ledger = readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), "utf8");
      expect(ledger).toContain('"candidate_id":"architecture/entity/install"');
      expect(ledger).toContain('"node_ref":"entity/install"');
      expect(ledger).toContain('"view_ref":"architecture:entity/install"');
      expect(ledger).toContain('"path":"architecture/install/overview.md"');
      expect(JSON.parse(ledger.trim()) as Record<string, unknown>).not.toHaveProperty("id");
      expect(ledger).toContain("Alpha opening paragraph");
      expect(existsSync(join(projectRoot, "knowledge", "architecture", "install", "overview.md"))).toBe(false);
      const beforeUpdated = (JSON.parse(ledger.split("\n")[0]!) as { updated: string }).updated;
      const restaged = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--stage",
        "--input",
        actionFile,
        "--format",
        "json",
      ])) as { result: { candidates: { added: number; updated: number; unchanged: number } } };
      expect(restaged.result.candidates).toMatchObject({ added: 0, updated: 0, unchanged: 1 });
      const unchangedLedger = readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), "utf8");
      expect((JSON.parse(unchangedLedger.split("\n")[0]!) as { updated: string }).updated).toBe(beforeUpdated);

      const reviewHtml = JSON.parse(await runCliInDir(projectRoot, ["review", "html", "architecture", "--format", "json"])) as {
        path: string;
        absolute_path: string;
        file_url: string;
        url: string;
      };
      expect(reviewHtml.absolute_path).toBe(reviewHtml.path);
      expect(reviewHtml.file_url).toBe(reviewHtml.url);
      expect(reviewHtml.file_url).toMatch(/^file:\/\//u);
      const html = readFileSync(reviewHtml.path, "utf8");
      expect(html).toContain("Install source span");
      expect(html).toContain("Alpha opening paragraph");
      expect(html).toContain("content_mode");
      expect(html).toContain("source_refs");
      expect(html).toContain("description");

      const payload = writeJsonl(projectRoot, "review-payload.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      const approved = readFileSync(join(projectRoot, "knowledge", "architecture", "install", "overview.md"), "utf8");
      expect(approved).toContain("resource: file:product-docs/guide.md");
      expect(approved).toContain("node_ref: entity/install");
      expect(approved).toContain("view_ref: architecture:entity/install");
      expect(approved).toContain("node_type: entity");
      expect(approved).toContain("- entity");
      expect(approved).toContain('context:section id="install-1"');
      expect(approved).toContain('content_mode="verbatim"');
      expect(approved).toContain("<!-- context:summary");
      expect(approved).toContain('"text":"Install source span"');
      expect(approved).not.toContain("> Install source span");
      expect(approved).toContain("Alpha opening paragraph");

      const refreshContext = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "node-context",
        "--source",
        "architecture:entity/install",
        "--format",
        "json",
      ])) as {
        result: {
          node_context: {
            existing: {
              present: boolean;
              sections: Array<{
                id: string;
                kind: string;
                status: string;
                summary?: string;
                content_mode?: string;
                source_refs: string[];
                reader_visible_body: string;
                body_sha256: string;
                body_char_count: number;
              }>;
            };
          };
        };
      };
      expect(refreshContext.result.node_context.existing.present).toBe(true);
      expect(refreshContext.result.node_context.existing.sections[0]).toMatchObject({
        id: "install-1",
        kind: "description",
        status: "active",
        summary: "Install source span",
        content_mode: "verbatim",
      });
      expect(refreshContext.result.node_context.existing.sections[0]?.source_refs[0]).toBe(refs[0]);
      expect(refreshContext.result.node_context.existing.sections[0]?.reader_visible_body).toContain("Alpha opening paragraph");
      expect(refreshContext.result.node_context.existing.sections[0]?.body_sha256).toMatch(/^sha256:/u);
      expect(refreshContext.result.node_context.existing.sections[0]?.body_char_count).toBeGreaterThan(0);

      const addExistingFile = writeYaml(projectRoot, "compile-actions-add-existing.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-1",
          kind: "description",
          summary: "Must use update for existing section",
          source_refs: [context.result.node_context.planned_sections[0]!.local_source_refs[0]],
        }],
      });
      const addExisting = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        addExistingFile,
        "--format",
        "json",
      ])) as { result: { state: string; diagnostics: Array<{ code: string }> } };
      expect(addExisting.result.state).toBe("invalid");
      expect(addExisting.result.diagnostics.map((item) => item.code)).toContain("action.add_existing_section");

      const updateMissingFile = writeYaml(projectRoot, "compile-actions-update-missing.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "update",
          section_id: "install-2",
          kind: "spec",
          summary: "Must use add for new section",
          source_refs: [context.result.node_context.planned_sections[1]!.local_source_refs[0]],
        }],
      });
      const updateMissing = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        updateMissingFile,
        "--format",
        "json",
      ])) as { result: { state: string; diagnostics: Array<{ code: string }> } };
      expect(updateMissing.result.state).toBe("invalid");
      expect(updateMissing.result.diagnostics.map((item) => item.code)).toContain("action.update_missing_section");

      const secondActionFile = writeYaml(projectRoot, "compile-actions-second-section.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-2",
          kind: "spec",
          summary: "Runtime matrix source span",
          source_refs: [context.result.node_context.planned_sections[1]!.local_source_refs[0]],
        }],
      });
      const secondStaged = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--stage",
        "--input",
        secondActionFile,
        "--format",
        "json",
      ])) as { result: { sections: number; candidates: { added: number; updated: number } } };
      expect(secondStaged.result.sections).toBe(2);
      expect(secondStaged.result.candidates.updated).toBe(0);
      const secondLedger = readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), "utf8");
      expect(secondLedger).toContain("Alpha opening paragraph");
      expect(secondLedger).toContain("| runtime | edge |");
      const secondPayload = writeJsonl(projectRoot, "review-payload-second.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", secondPayload, "--format", "json"]);
      const updatedApproved = readFileSync(join(projectRoot, "knowledge", "architecture", "install", "overview.md"), "utf8");
      expect(updatedApproved).toContain('context:section id="install-1"');
      expect(updatedApproved).toContain('context:section id="install-2"');
      expect(updatedApproved).toContain("Alpha opening paragraph");
      expect(updatedApproved).toContain("| runtime | edge |");

      const statusBeforeClose = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        close: { state: string };
        routing: { current_state: string; recommended_action: string; command_plan: Array<{ command: string }>; do_not: string[] };
      };
      expect(statusBeforeClose.state).toBe("route.indexer.lifecycle-required");
      expect(statusBeforeClose.close.state).toBe("missing");
      expect(statusBeforeClose.routing.current_state).toBe("route.indexer.lifecycle-required");
      expect(statusBeforeClose.routing.recommended_action).toContain("registry-and-Provider indexing lifecycle");
      expect(statusBeforeClose.routing.command_plan).toEqual([]);
      expect(statusBeforeClose.routing.do_not).toEqual([]);

      const close = JSON.parse(await runCliInDir(projectRoot, ["close", "--format", "json"])) as {
        structure: string;
        nodes: number;
        views: number;
        edges: number;
        edgeContract: { validationScope: string; valid: boolean; checked: number };
        references: { status: string; rewritesVerbatim: boolean };
        verifyErrors: number;
      };
      expect(close.structure).toBe("knowledge/structure.yaml");
      expect(close.nodes).toBe(1);
      expect(close.views).toBe(1);
      expect(close.edges).toBe(0);
      expect(close.edgeContract).toMatchObject({ validationScope: "structure", valid: true, checked: 0 });
      expect(close.references).toMatchObject({ status: "deferred", rewritesVerbatim: false });
      expect(close.verifyErrors).toBe(0);
      const structure = YAML.parse(readFileSync(join(projectRoot, "knowledge", "structure.yaml"), "utf8")) as {
        input_hash: string;
        source_inputs: Record<string, Record<string, string>>;
        nodes: Array<{ node_ref: string; node_type: string }>;
        views: Array<{ view_ref: string; node_ref: string; node_type: string; path: string; sections: Array<{ source_refs: string[] }> }>;
      };
      expect(structure.input_hash).toMatch(/^sha256:/u);
      expect(structure.source_inputs).toEqual({
        "file:product-docs": {
          architecture: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        },
      });
      expect("verified_input_hash" in (structure as unknown as Record<string, unknown>)).toBe(false);
      expect(structure.nodes[0]).toMatchObject({
        node_ref: "entity/install",
        node_type: "entity",
      });
      expect(structure.views[0]).toMatchObject({
        view_ref: "architecture:entity/install",
        node_ref: "entity/install",
        node_type: "entity",
        path: "architecture/install/overview.md",
      });
      expect(structure.views[0]?.sections[0]?.source_refs[0]).toMatch(/^file:product-docs\//u);
      const structureText = readFileSync(join(projectRoot, "knowledge", "structure.yaml"), "utf8");
      await runCliInDir(projectRoot, ["close", "--format", "json"]);
      expect(readFileSync(join(projectRoot, "knowledge", "structure.yaml"), "utf8")).toBe(structureText);

      const statusAfterClose = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as { state: string; close: { state: string } };
      expect(statusAfterClose.close.state).toBe("ready");
      expect(statusAfterClose.state).toBe("route.indexer.lifecycle-required");

      const repinByOldId = await invokeCliInDir(projectRoot, ["review", "re-pin", "entity/install", "--format", "json"]);
      expect(repinByOldId.status).not.toBe(0);
      expect(repinByOldId.stderr).toContain("approved maintenance target must be a view_ref");

      const repinned = JSON.parse(await runCliInDir(projectRoot, ["review", "re-pin", "architecture:entity/install", "--format", "json"])) as {
        id: string;
        changed: boolean;
        refsUpdated: number;
      };
      expect(repinned.id).toBe("architecture:entity/install");
      expect(repinned.changed).toBe(false);
      expect(repinned.refsUpdated).toBe(0);

      const deprecatedByOldId = await invokeCliInDir(projectRoot, ["review", "deprecate", "entity/install", "--format", "json"]);
      expect(deprecatedByOldId.status).not.toBe(0);
      expect(deprecatedByOldId.stderr).toContain("approved maintenance target must be a view_ref");

      const deprecated = JSON.parse(await runCliInDir(projectRoot, ["review", "deprecate", "architecture:entity/install", "--format", "json"])) as {
        id: string;
        changed: boolean;
      };
      expect(deprecated.id).toBe("architecture:entity/install");
      expect(deprecated.changed).toBe(true);
      const deprecatedApproved = readFileSync(join(projectRoot, "knowledge", "architecture", "install", "overview.md"), "utf8");
      expect(deprecatedApproved).toContain("deprecated: true");
      expect(deprecatedApproved).not.toContain("deprecated_at:");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("review apply rejection keeps source-bound candidates out of knowledge", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedRichStructure(projectRoot, refs);
      const actionFile = writeYaml(projectRoot, "reject-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-1",
          kind: "description",
          summary: "Rejected source span",
          source_refs: [refs[0]],
        }],
      });
      await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--stage",
        "--input",
        actionFile,
        "--format",
        "json",
      ]);

      const payload = writeJsonl(projectRoot, "review-rejected.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "rejected",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      expect(existsSync(join(projectRoot, "knowledge", "architecture", "install", "overview.md"))).toBe(false);
      expect(existsSync(join(projectRoot, "knowledge", "structure.yaml"))).toBe(false);
      const ledger = readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), "utf8");
      expect(ledger).toContain('"status":"rejected"');
      await runCliInDir(projectRoot, ["close", "--format", "json"]);
      expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle"))).toBe(false);
      const structure = YAML.parse(readFileSync(join(projectRoot, "knowledge", "structure.yaml"), "utf8")) as {
        views: unknown[];
        source_inputs: Record<string, Record<string, string>>;
      };
      expect(structure.views).toEqual([]);
      expect(structure.source_inputs).toEqual({
        "file:product-docs": {
          architecture: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        },
      });
      const status = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        pendingStructureTargets: unknown[];
      };
      expect(status.pendingStructureTargets).toEqual([]);
      expect(status.state).not.toBe("route.structure.pending-target");

      writeFileSync(join(root, "docs", "guide.md"), [
        readFileSync(join(root, "docs", "guide.md"), "utf8").trimEnd(),
        "",
        "## Additional Notes",
        "",
        "A newly captured source block.",
        "",
      ].join("\n"), "utf8");
      await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);
      const changedStatus = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        pendingStructureTargets: Array<{ sourceKey: string; collection: string }>;
      };
      expect(changedStatus.state).toBe("route.indexer.lifecycle-required");
      expect(changedStatus.pendingStructureTargets).toEqual([
        expect.objectContaining({ sourceKey: "file:product-docs", collection: "architecture" }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("review apply blocks polluted verbatim candidates before writing approved knowledge", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedRichStructure(projectRoot, refs);
      const context = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "node-context",
        "--source",
        "architecture:entity/install",
        "--format",
        "json",
      ])) as {
        result: { node_context: { planned_sections: Array<{ local_source_refs: string[] }> } };
      };
      const actionFile = writeYaml(projectRoot, "polluted-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-1",
          kind: "description",
          summary: "Install source span",
          source_refs: [context.result.node_context.planned_sections[0]!.local_source_refs[0]],
        }],
      });
      await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--stage",
        "--input",
        actionFile,
        "--format",
        "json",
      ]);

      const ledgerPath = join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl");
      const record = JSON.parse(readFileSync(ledgerPath, "utf8").trim()) as {
        sections: Array<{ body: string }>;
      };
      record.sections[0]!.body = "Tampered body that does not match the source span.";
      writeFileSync(ledgerPath, `${JSON.stringify(record)}\n`, "utf8");

      const payload = writeJsonl(projectRoot, "review-polluted.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      const result = await invokeCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("verbatim candidate body does not match source_ref hash");
      expect(existsSync(join(projectRoot, "knowledge", "architecture", "install", "overview.md"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

});
