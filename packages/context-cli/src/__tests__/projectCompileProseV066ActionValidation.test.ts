import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCapturedCompileProject,
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  sourceRefs,
  sourceRefsForRanges,
  stageConfirmedStructure,
  writeYaml,
} from "./projectCompileProseV066Helpers.js";

describe("0.6.6 compileProse action validation", () => {
  test("routes draft and frozen structure diagnostics before compile", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      const snapshotHash = String((JSON.parse(readFileSync(join(projectRoot, "sources", "file", "product-docs", "manifest.json"), "utf8")) as { snapshot_hash: string }).snapshot_hash);
      const draft = writeYaml(projectRoot, "draft-structure.yaml", {
        schema_version: "context.structure.v1",
        sources: ["file:product-docs"],
        evidence_snapshot_hash: snapshotHash,
        nodes: [{
          node_ref: "entity/install",
          title: "Install",
          node_type: "entity",
          tags: ["module"],
        }],
        views: [{
          view_ref: "architecture:entity/install",
          node_ref: "entity/install",
          collection: "architecture",
          containment: "install",
          slug: "overview",
          title: "Install",
          node_type: "entity",
          path: "architecture/install/overview.md",
          sections: [{ id: "install", kind: "description", source_refs: [refs[0]!] }],
        }],
        edges: [],
        unresolved: [],
        lifecycle: { state: "draft" },
      });
      await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--stage",
        "--input",
        draft,
        "--format",
        "json",
      ]);
      const draftStatus = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        stagedStructure: { state: string };
        routing: { current_state: string; recommended_action: string; command_plan: Array<{ command: string }> };
      };
      expect(draftStatus.state).toBe("route.indexer.lifecycle-required");
      expect(draftStatus.stagedStructure.state).toBe("draft");
      expect(draftStatus.routing.current_state).toBe("route.indexer.lifecycle-required");
      expect(draftStatus.routing.recommended_action).toContain("registry-and-Provider indexing lifecycle");
      const commands = draftStatus.routing.command_plan.map((item) => item.command);
      expect(commands).toEqual([]);

      const blocked = await invokeCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "read-plan",
        "--format",
        "json",
      ]);
      expect(blocked.status).not.toBe(0);
      expect(blocked.stderr).toContain("must be confirmed before compile");

      const frozenWithoutAudit = writeYaml(projectRoot, "frozen-without-audit.yaml", {
        schema_version: "context.structure.v1",
        sources: ["file:product-docs"],
        evidence_snapshot_hash: snapshotHash,
        nodes: [{
          node_ref: "entity/install",
          title: "Install",
          node_type: "entity",
          tags: ["module"],
        }],
        views: [{
          view_ref: "architecture:entity/install",
          node_ref: "entity/install",
          collection: "architecture",
          containment: "install",
          slug: "overview",
          title: "Install",
          node_type: "entity",
          path: "architecture/install/overview.md",
          sections: [{ id: "install", kind: "description", source_refs: [refs[0]!] }],
        }],
        edges: [],
        unresolved: [],
        lifecycle: {
          state: "frozen",
          confirmed_by: "human",
          confirmed_at: "2026-06-24T12:00:00Z",
          structure_digest: "sha256:bad",
        },
      });
      const invalidFrozen = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        frozenWithoutAudit,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string }> } };
      expect(invalidFrozen.result.valid).toBe(false);
      expect(invalidFrozen.result.diagnostics.map((item) => item.code)).toContain("lifecycle.frozen_at_missing");
      expect(invalidFrozen.result.diagnostics.map((item) => item.code)).toContain("lifecycle.frozen_snapshot_hash_missing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects unsupported compile views and invalid action payloads", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedStructure(projectRoot, [refs[0]!, refs[2]!]);

      const blockers = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "blockers",
        "--format",
        "json",
      ])) as {
        result: {
          blockers: {
            section_blockers: Array<{ view_ref: string; section_id: string; mirror_status: string; suggested_splits?: unknown[] }>;
            suggested_structure_repairs: { split_required_sections: Array<{ view_ref: string; suggested_splits: unknown[] }> };
            next_action: { kind: string; command: string };
          };
        };
      };
      expect(blockers.result.blockers.section_blockers).toContainEqual(expect.objectContaining({
        view_ref: "architecture:entity/install",
        section_id: "install",
        mirror_status: "split_required",
      }));
      expect(blockers.result.blockers.section_blockers[0]?.suggested_splits).toHaveLength(2);
      expect(blockers.result.blockers.next_action).toMatchObject({
        kind: "return_to_align",
        command: "context run align:file:product-docs:architecture --view structure-summary --input .tmp/context-runtime/lifecycle/structure.yaml --format json",
      });
      expect(blockers.result.blockers.suggested_structure_repairs.split_required_sections).toContainEqual(expect.objectContaining({
        view_ref: "architecture:entity/install",
      }));

      const schemaView = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "schema",
        "--format",
        "json",
      ])) as {
        result: {
          payload_schema: {
            constraints: {
              max_actions_per_section_id: number;
              source_span_shape: string;
            };
          };
        };
      };
      expect(schemaView.result.payload_schema.constraints.max_actions_per_section_id).toBe(1);
      expect(schemaView.result.payload_schema.constraints.source_span_shape).toBe("one-source-one-continuous-range");

      const contiguousRefs = await sourceRefsForRanges(projectRoot, [
        { lineStart: 3, lineEnd: 5 },
        { lineStart: 6, lineEnd: 8 },
        { lineStart: 3, lineEnd: 8 },
      ]);
      await stageConfirmedStructure(projectRoot, [contiguousRefs[0]!, contiguousRefs[1]!]);
      const contiguousContext = JSON.parse(await runCliInDir(projectRoot, [
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
            planned_sections: Array<{
              source_mirror: { status: string };
            }>;
          };
        };
      };
      expect(contiguousContext.result.node_context.planned_sections[0]?.source_mirror.status).toBe("mirrorable");

      const incompleteContiguousFile = writeYaml(projectRoot, "incomplete-contiguous-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{ op: "add", section_id: "install", kind: "description", summary: "Only half of a contiguous planned section", source_refs: [contiguousRefs[0]] }],
      });
      const incompleteContiguous = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        incompleteContiguousFile,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string }> } };
      expect(incompleteContiguous.result.valid).toBe(false);
      expect(incompleteContiguous.result.diagnostics.map((item) => item.code)).toContain("action.source_refs_incomplete_section");

      const mergedContiguousFile = writeYaml(projectRoot, "merged-contiguous-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{ op: "add", section_id: "install", kind: "description", summary: "Merged contiguous planned section", source_refs: [contiguousRefs[2]] }],
      });
      const mergedContiguous = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        mergedContiguousFile,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string }>; next_action: { command: string } } };
      expect(mergedContiguous.result.valid).toBe(true);
      expect(mergedContiguous.result.diagnostics.map((item) => item.code)).not.toContain("action.source_refs_incomplete_section");
      expect(mergedContiguous.result.next_action.command).toContain(`--stage --input ${mergedContiguousFile} --format json`);

      await stageConfirmedStructure(projectRoot, [refs[0]!]);

      const unknownView = await invokeCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "span-detail",
        "--format",
        "json",
      ]);
      expect(unknownView.status).not.toBe(0);
      expect(unknownView.stderr).toContain("unsupported compile view");

      const cases: Array<{
        file: string;
        payload: Record<string, unknown>;
        code: string;
      }> = [
        {
          file: "missing-section-id-actions.yaml",
          code: "action.section_id_missing",
          payload: {
            schema_version: "context.compile-actions.v1",
            view_ref: "architecture:entity/install",
            actions: [{ op: "add", kind: "description", summary: "Missing section id", source_refs: [refs[0]] }],
          },
        },
        {
          file: "unsupported-op-actions.yaml",
          code: "action.op_invalid",
          payload: {
            schema_version: "context.compile-actions.v1",
            view_ref: "architecture:entity/install",
            actions: [{ op: "supersede", section_id: "install", kind: "description", summary: "Unsupported op", source_refs: [refs[0]] }],
          },
        },
        {
          file: "invalid-kind-actions.yaml",
          code: "action.kind_invalid",
          payload: {
            schema_version: "context.compile-actions.v1",
            view_ref: "architecture:entity/install",
            actions: [{ op: "add", section_id: "install", kind: "body", summary: "Invalid action kind", source_refs: [refs[0]] }],
          },
        },
        {
          file: "template-content-actions.yaml",
          code: "action.content_unsupported",
          payload: {
            schema_version: "context.compile-actions.v1",
            view_ref: "architecture:entity/install",
            actions: [{
              op: "add",
              section_id: "install",
              kind: "description",
              summary: "Template-like content must not compile",
              source_refs: [refs[0]],
              content: "This section describes the installation flow.",
              content_intent: "rewrite",
            }],
          },
        },
        {
          file: "unknown-section-id-actions.yaml",
          code: "action.section_id_unknown",
          payload: {
            schema_version: "context.compile-actions.v1",
            view_ref: "architecture:entity/install",
            actions: [{ op: "add", section_id: "missing-section", kind: "description", summary: "Unknown section id", source_refs: [refs[0]] }],
          },
        },
        {
          file: "duplicate-section-id-actions.yaml",
          code: "action.section_id_duplicate",
          payload: {
            schema_version: "context.compile-actions.v1",
            view_ref: "architecture:entity/install",
            actions: [
              { op: "add", section_id: "install", kind: "description", summary: "First section", source_refs: [refs[0]] },
              { op: "add", section_id: "install", kind: "description", summary: "Duplicate section", source_refs: [refs[0]] },
            ],
          },
        },
        {
          file: "outside-section-actions.yaml",
          code: "action.source_ref_outside_section",
          payload: {
            schema_version: "context.compile-actions.v1",
            view_ref: "architecture:entity/install",
            actions: [{ op: "add", section_id: "install", kind: "description", summary: "Wrong source ref for planned section", source_refs: [refs[1]] }],
          },
        },
        {
          file: "bad-actions.yaml",
          code: "action.source_ref_outside_section",
          payload: {
            schema_version: "context.compile-actions.v1",
            view_ref: "architecture:entity/install",
            actions: [{ op: "add", section_id: "install", kind: "description", summary: "Two separate spans", source_refs: [refs[0], refs[2]] }],
          },
        },
        {
          file: "unsupported-projection-actions.yaml",
          code: "action.content_unsupported",
          payload: {
            schema_version: "context.compile-actions.v1",
            view_ref: "architecture:entity/install",
            actions: [{
              op: "add",
              section_id: "install",
              kind: "description",
              summary: "Explicit content without rewrite intent",
              source_refs: [refs[0]],
              content: "Mechanical projection is not enabled.",
            }],
          },
        },
      ];
      for (const item of cases) {
        const inputFile = writeYaml(projectRoot, item.file, item.payload);
        const result = JSON.parse(await runCliInDir(projectRoot, [
          "run",
          "compile:file:product-docs:architecture",
          "--validate",
          "--input",
          inputFile,
          "--format",
          "json",
          "--verbose",
        ])) as { result: { valid: boolean; diagnostics: Array<{ code: string }> } };
        expect(result.result.valid).toBe(false);
        expect(result.result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(item.code);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports non-blocking summary and near-raw content advisories", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedStructure(projectRoot, [refs[0]!]);
      const cases: Array<{ file: string; payload: Record<string, unknown>; code: string }> = [
        {
          file: "placeholder-summary-actions.yaml",
          code: "action.summary_placeholder",
          payload: {
            schema_version: "context.compile-actions.v1",
            view_ref: "architecture:entity/install",
            actions: [{ op: "add", section_id: "install", kind: "description", summary: "description section covering 2 evidence spans", source_refs: [refs[0]] }],
          },
        },
        {
          file: "formatted-summary-actions.yaml",
          code: "action.summary_format",
          payload: {
            schema_version: "context.compile-actions.v1",
            view_ref: "architecture:entity/install",
            actions: [{ op: "add", section_id: "install", kind: "description", summary: "Installation overview\n- Includes setup", source_refs: [refs[0]] }],
          },
        },
        {
          file: "long-summary-actions.yaml",
          code: "action.summary_too_long",
          payload: {
            schema_version: "context.compile-actions.v1",
            view_ref: "architecture:entity/install",
            actions: [{ op: "add", section_id: "install", kind: "description", summary: "Installation overview ".repeat(20), source_refs: [refs[0]] }],
          },
        },
      ];
      for (const item of cases) {
        const inputFile = writeYaml(projectRoot, item.file, item.payload);
        const result = JSON.parse(await runCliInDir(projectRoot, [
          "run",
          "compile:file:product-docs:architecture",
          "--validate",
          "--input",
          inputFile,
          "--format",
          "json",
          "--verbose",
        ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string }> } };
        expect(result.result.valid).toBe(true);
        expect(result.result.diagnostics).toContainEqual(expect.objectContaining({
          code: item.code,
          severity: "warning",
        }));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("routes node id, unknown field, input, and scalar schema diagnostics", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedStructure(projectRoot, [refs[0]!]);

      const missingNodeIdFile = writeYaml(projectRoot, "missing-node-id-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        actions: [{ op: "add", section_id: "install", kind: "description", summary: "Missing node id", source_refs: [refs[0]] }],
      });
      const missingNodeId = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        missingNodeIdFile,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string }>; next_action: { command: string; available_view_refs: string[] } } };
      expect(missingNodeId.result.valid).toBe(false);
      expect(missingNodeId.result.diagnostics.map((item) => item.code)).toContain("schema.view_ref_missing");
      expect(missingNodeId.result.next_action.command).toBe("context run compile:file:product-docs:architecture --view read-plan --format json");
      expect(missingNodeId.result.next_action.available_view_refs).toContain("architecture:entity/install");

      const unknownNodeIdFile = writeYaml(projectRoot, "unknown-node-id-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/missing",
        actions: [{ op: "add", section_id: "install", kind: "description", summary: "Unknown node id", source_refs: [refs[0]] }],
      });
      const unknownNodeId = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        unknownNodeIdFile,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string }>; next_action: { command: string; available_view_refs: string[] } } };
      expect(unknownNodeId.result.valid).toBe(false);
      expect(unknownNodeId.result.diagnostics.map((item) => item.code)).toContain("schema.view_ref_unknown");
      expect(unknownNodeId.result.next_action.command).toBe("context run compile:file:product-docs:architecture --view read-plan --format json");
      expect(unknownNodeId.result.next_action.available_view_refs).toContain("architecture:entity/install");

      const unknownFieldsFile = writeYaml(projectRoot, "unknown-fields-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        notes: ["Unknown top-level field should be rejected."],
        actions: [{ op: "add", section_id: "install", kind: "description", summary: "Unknown action field", source_refs: [refs[0]], content_mode: "mechanical" }],
      });
      const unknownFields = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        unknownFieldsFile,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; field?: string }> } };
      expect(unknownFields.result.valid).toBe(false);
      expect(unknownFields.result.diagnostics.filter((item) => item.code === "schema.unknown_field").map((item) => item.field)).toEqual(["payload.notes", "actions[0].content_mode"]);

      const invalidSourceRefsFile = writeYaml(projectRoot, "invalid-source-refs-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{ op: "add", section_id: "install", kind: "description", summary: "Invalid source ref item", source_refs: [refs[0], 123] }],
      });
      const invalidSourceRefs = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        invalidSourceRefsFile,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; field?: string }> } };
      expect(invalidSourceRefs.result.valid).toBe(false);
      expect(invalidSourceRefs.result.diagnostics.filter((item) => item.code === "schema.string_array_item").map((item) => item.field)).toEqual(["actions[0].source_refs[1]"]);

      const invalidContentFieldsFile = writeYaml(projectRoot, "invalid-content-fields-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{ op: "add", section_id: "install", kind: "description", summary: "Invalid content fields", source_refs: [refs[0]], content: 123, content_intent: ["rewrite"] }],
      });
      const invalidContentFields = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        invalidContentFieldsFile,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; field?: string }> } };
      expect(invalidContentFields.result.valid).toBe(false);
      expect(invalidContentFields.result.diagnostics.filter((item) => item.code === "schema.string").map((item) => item.field)).toEqual([
        "actions[0].content",
        "actions[0].content_intent",
      ]);

      const missingInput = await invokeCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        "missing-compile-actions.yaml",
        "--format",
        "json",
      ]);
      expect(missingInput.status).not.toBe(0);
      expect(missingInput.stderr).toContain("compile action payload cannot be read");
      expect(missingInput.stderr).toContain("Pass the compile actions YAML/JSON file");

      writeFileSync(join(projectRoot, "invalid-compile-actions.json"), "{", "utf8");
      const invalidInput = await invokeCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        "invalid-compile-actions.json",
        "--format",
        "json",
      ]);
      expect(invalidInput.status).not.toBe(0);
      expect(invalidInput.stderr).toContain("compile action payload is invalid YAML/JSON");
      expect(invalidInput.stderr).toContain("Fix payload syntax");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("compile reports invalid structure yaml with a workspace diagnostic", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedStructure(projectRoot, [refs[0]!]);
      writeFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), "schema_version: [", "utf8");
      const result = await invokeCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "read-plan",
        "--format",
        "json",
      ]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(".tmp/context-runtime/lifecycle/structure.yaml is invalid YAML");
      expect(result.stderr).toContain("Fix .tmp/context-runtime/lifecycle/structure.yaml");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
