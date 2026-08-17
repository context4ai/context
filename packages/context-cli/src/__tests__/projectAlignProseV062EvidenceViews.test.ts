import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCapturedAlignProject,
  firstSourceRef,
  makeTmp,
  runCliInDir,
  writeApprovedStructure,
} from "./projectAlignProseV062Helpers.js";

describe("0.6.6 prose align structure gate", () => {
  test("align:file exposes structure-oriented evidence views", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);

      const readPlan = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "read-plan",
        "--format",
        "json",
      ])) as {
        result: Record<string, unknown> & {
          read_plan: {
            body_resources: Array<{ path: string; digest: string }>;
            supporting_commands: { structure_summary: string };
            authoring_spans: Array<{ source_ref: string; line_range: string }>;
            authoring_spans_truncated: boolean;
            authoring_contract: {
              schema_version: string;
              source: string;
              collection: string;
              required_fields: { section: string[] };
              lifecycle: { state: string };
            };
          };
          next_action: {
            kind: string;
            effect: string;
            command: string;
            required_source_bodies: Array<{ path: string; digest: string }>;
          };
          payload_target: { path: string; policy: string; lifecycle: string; retention: string };
          semantic_rules: {
            handle: string;
            digest: string;
            rules_version: string;
            required: Array<{ id: string; path: string; applies_to: string[]; content_digest: string; content_available: boolean; reason: string }>;
          };
        };
      };
      expect(readPlan.result).toMatchObject({
        kind: "prose.align.view.result",
        view: "read-plan",
        state: "evidence-ready",
        payload_target: {
          path: ".tmp/agent-payloads/align-file-product-docs-architecture-structure.yaml",
          policy: "recommended",
          lifecycle: "transient",
          retention: "discard-after-successful-stage",
        },
      });
      expect(readPlan.result).not.toHaveProperty("payload_schema");
      expect(readPlan.result).not.toHaveProperty("semantic_reference_files");
      expect(readPlan.result).not.toHaveProperty("views");
      const verboseReadPlan = JSON.parse(await runCliInDir(projectRoot, [
        "run", "align:file:product-docs:architecture", "--view", "read-plan", "--verbose", "--format", "json",
      ])) as { result: { payload_schema: { schema_version: string }; views: unknown[]; semantic_reference_files: unknown[] } };
      expect(verboseReadPlan.result.payload_schema.schema_version).toBe("context.structure.v1");
      expect(verboseReadPlan.result.views.length).toBeGreaterThan(0);
      expect(verboseReadPlan.result.semantic_reference_files.length).toBeGreaterThan(0);
      expect(JSON.stringify(readPlan.result)).toContain("source-index");
      expect(readPlan.result.read_plan.body_resources).toContainEqual(
        expect.objectContaining({
          path: "sources/file/product-docs/guide.md",
          digest: expect.stringMatching(/^sha256:/u),
        }),
      );
      expect(readPlan.result.read_plan.authoring_spans_truncated).toBe(false);
      expect(readPlan.result.read_plan.authoring_contract).toMatchObject({
        schema_version: "context.structure.v1",
        source: "file:product-docs",
        collection: "architecture",
        required_fields: {
          section: ["id", "kind", "source_refs"],
        },
        lifecycle: { state: "draft" },
      });
      expect(readPlan.result.read_plan.authoring_spans[0]?.source_ref).toMatch(
        /^file:product-docs\/guide\.md#span:/u,
      );
      expect(readPlan.result.next_action).toMatchObject({
        kind: "author_structure",
        effect: "write",
        command:
          "context run align:file:product-docs:architecture --stage --input .tmp/agent-payloads/align-file-product-docs-architecture-structure.yaml --format json",
      });
      expect(readPlan.result.next_action.required_source_bodies).toContainEqual(
        expect.objectContaining({
          path: "sources/file/product-docs/guide.md",
        }),
      );
      expect(readPlan.result.read_plan.supporting_commands.structure_summary).toBe(
        "context run align:file:product-docs:architecture --view structure-summary --input .tmp/agent-payloads/align-file-product-docs-architecture-structure.yaml --format json",
      );
      const semanticReferenceIds = readPlan.result.semantic_rules.required.map((item) => item.id);
      expect(semanticReferenceIds).toContain("structure-planning");
      expect(semanticReferenceIds).not.toContain("align-workflow");
      expect(readPlan.result.semantic_rules.handle).toMatch(/^context-rules:align:[a-f0-9]{16}$/u);
      expect(readPlan.result.semantic_rules.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(readPlan.result.semantic_rules.rules_version).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(readPlan.result.semantic_rules.required.every((rule) => rule.content_available && rule.content_digest.startsWith("sha256:") && rule.reason.length > 0)).toBe(true);
      const schema = JSON.parse(await runCliInDir(projectRoot, [
        "run", "align:file:product-docs:architecture", "--view", "schema", "--format", "json",
      ])) as {
        result: {
          payload_schema: { schema_version: string };
          payload_target: { path: string; policy: string; lifecycle: string; retention: string };
          minimal: { validate_command: string; stage_command: string };
          next_action: { command: string };
        };
      };
      expect(schema.result.payload_schema.schema_version).toBe("context.structure.v1");
      expect(schema.result.payload_target).toEqual({
        path: ".tmp/agent-payloads/align-file-product-docs-architecture-structure.yaml",
        policy: "recommended",
        lifecycle: "transient",
        retention: "discard-after-successful-stage",
      });
      expect(schema.result.minimal.validate_command).toContain(schema.result.payload_target.path);
      expect(schema.result.minimal.stage_command).toContain(schema.result.payload_target.path);
      expect(schema.result.next_action.command).toContain(schema.result.payload_target.path);

      const rules = JSON.parse(await runCliInDir(projectRoot, [
        "run", "align:file:product-docs:architecture", "--view", "semantic-rules", "--format", "json",
      ])) as {
        result: {
          required: Array<{ id: string; resource: { id: string; path: string } }>;
          next_action: { kind: string; resource_ids: string[] };
        };
      };
      expect(rules.result.required.map((rule) => rule.id)).toContain("structure-planning");
      expect(rules.result.next_action.kind).toBe("read_required_resources");
      const ruleLocation = JSON.parse(await runCliInDir(projectRoot, [
        "run", "align:file:product-docs:architecture", "--view", "semantic-rules",
        "--rule", "structure-planning", "--page-size", "5", "--format", "json",
      ])) as {
        result: {
          rule: {
            content_digest: string;
            resource_id: string;
            resource: { id: string; path: string };
          };
        };
      };
      expect(ruleLocation.result.rule.content_digest).toMatch(/^sha256:/u);
      expect(ruleLocation.result.rule.resource_id).toBe("context.semantic.align.structure-planning");
      expect(ruleLocation.result.rule.resource.path).toEndWith("resources/semantic/align/structure-planning.md");
      expect(readFileSync(ruleLocation.result.rule.resource.path, "utf8")).toContain("Structure Planning Procedure");
      expect(JSON.stringify(ruleLocation.result)).not.toContain('"content":');
      expect(JSON.stringify(readPlan.result)).not.toContain([
        "context",
        ["prose", "candidate", "intent"].join("-"),
        "v1",
      ].join("."));

      const sourceIndex = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "source-index",
        "--format",
        "json",
      ])) as {
        result: {
          source_index: {
            documents: Array<{
              document_path: string;
              heading_tree: Array<{ title: string }>;
              relation_hints?: Array<{ quote?: string }>;
            }>;
            spans: Array<{
              source_ref: string;
              boundary_role: string;
              section_candidate: boolean;
              text_preview?: string;
              relation_hints?: Array<{ quote?: string }>;
            }>;
          };
          next_action: { kind: string; effect: string; command: string; required_source_bodies: Array<{ path: string; digest: string }> };
        };
      };
      expect(sourceIndex.result.source_index.documents.map((document) => document.document_path)).toContain("guide.md");
      expect(sourceIndex.result.source_index.spans.some((span) => "text_preview" in span)).toBe(false);
      expect(JSON.stringify(sourceIndex.result.source_index)).not.toContain('"quote"');
      expect(sourceIndex.result.source_index.spans[0]?.source_ref).toMatch(/^file:product-docs\/guide\.md#span:/u);
      expect(sourceIndex.result.source_index.spans[0]).toMatchObject({
        boundary_role: "markdown-ast-block",
        section_candidate: true,
      });
      expect(sourceIndex.result.next_action).toMatchObject({
        kind: "author_structure",
        effect: "write",
      });
      expect(sourceIndex.result.next_action.required_source_bodies).toContainEqual(
        expect.objectContaining({
          path: "sources/file/product-docs/guide.md",
          digest: expect.stringMatching(/^sha256:/u),
        }),
      );
      const compactSourceIndex = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "source-index",
        "--compact",
        "--format",
        "json",
      ])) as {
        result: {
          compact: boolean;
          source_index: {
            documents: Array<{ heading_tree?: unknown; relation_hints?: unknown }>;
            spans: Array<{ relation_hints?: Array<{ source_ref?: string; quote?: string }>; text_preview?: unknown }>;
          };
        };
      };
      expect(compactSourceIndex.result.compact).toBe(true);
      expect(compactSourceIndex.result.source_index.documents.some((document) => "heading_tree" in document || "relation_hints" in document)).toBe(false);
      expect(compactSourceIndex.result.source_index.spans.some((span) => "text_preview" in span)).toBe(false);
      expect(compactSourceIndex.result.source_index.spans.flatMap((span) => span.relation_hints ?? []).some((hint) => "quote" in hint)).toBe(false);
      expect(compactSourceIndex.result.source_index.spans.flatMap((span) => span.relation_hints ?? []).every((hint) => typeof hint.source_ref === "string")).toBe(true);
      const smallBudgetSourceIndex = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "source-index",
        "--byte-budget",
        "1000",
        "--format",
        "json",
      ])) as {
        result: {
          source_index: {
            byte_budget: number;
            documents_byte_budget: number;
            spans_byte_budget: number;
          };
        };
      };
      expect(
        smallBudgetSourceIndex.result.source_index.documents_byte_budget +
        smallBudgetSourceIndex.result.source_index.spans_byte_budget,
      ).toBeLessThanOrEqual(smallBudgetSourceIndex.result.source_index.byte_budget);

      const spanDetail = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "span-detail",
        "--span",
        sourceIndex.result.source_index.spans[0]!.source_ref,
        "--format",
        "json",
      ])) as { result: { view: string; span_detail: { text: string; requested_range_role: string; range_role: string; section_candidate: boolean } } };
      expect(spanDetail.result.view).toBe("span-detail");
      expect(spanDetail.result.span_detail.text).toContain("Alpha");
      expect(spanDetail.result.span_detail).toMatchObject({
        requested_range_role: "evidence-span",
        range_role: "transport-page",
        section_candidate: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("align exposes a paged existing knowledge lookup without storage paths", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = await firstSourceRef(projectRoot);
      await writeApprovedStructure(projectRoot, sourceRef);

      const lookup = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "existing-knowledge",
        "--query",
        "Install",
        "--collection",
        "architecture",
        "--node-type",
        "entity",
        "--format",
        "json",
      ])) as {
        result: {
          view: string;
          state: string;
          existing_knowledge: {
            counts: { nodes: number; views: number; sections: number };
            available: { collections: string[]; node_types: string[]; tags: string[] };
            filters: { query: string; collection: string; node_type: string };
            matched_total: number;
            returned: number;
            nodes: Array<{
              node_ref: string;
              title: string;
              node_type: string;
              tags: string[];
              collections: string[];
              view_refs: string[];
              section_count: number;
              matched_by: string;
              path?: string;
            }>;
          };
          next_action: { kind: string; reason_code: string };
        };
      };
      expect(lookup.result).toMatchObject({
        view: "existing-knowledge",
        state: "evidence-ready",
      });
      expect(lookup.result.existing_knowledge.counts).toMatchObject({
        nodes: 2,
        views: 2,
        sections: 2,
      });
      expect(lookup.result.existing_knowledge.available).toMatchObject({
        collections: ["architecture"],
        node_types: ["domain", "entity"],
      });
      expect(lookup.result.existing_knowledge.available.tags).toContain("module");
      expect(lookup.result.existing_knowledge.filters).toEqual({
        query: "Install",
        collection: "architecture",
        node_type: "entity",
      });
      expect(lookup.result.existing_knowledge).toMatchObject({
        matched_total: 1,
        returned: 1,
      });
      expect(lookup.result.existing_knowledge.nodes[0]).toMatchObject({
        node_ref: "entity/setup",
        title: "Install",
        node_type: "entity",
        collections: ["architecture"],
        view_refs: ["architecture:entity/setup"],
        section_count: 1,
        matched_by: "title_exact",
      });
      expect(lookup.result.existing_knowledge.nodes[0]).not.toHaveProperty("path");
      expect(JSON.stringify(lookup.result)).not.toContain(projectRoot);
      expect(lookup.result.next_action).toMatchObject({
        kind: "existing_knowledge_ready",
        reason_code: "prose-align-existing-knowledge-ready",
      });

      const firstPage = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "existing-knowledge",
        "--page-size",
        "1",
        "--format",
        "json",
      ])) as {
        result: {
          existing_knowledge: {
            matched_total: number;
            returned: number;
            page: { has_more: boolean; next_command: string };
          };
          next_action: { kind: string; command: string };
        };
      };
      expect(firstPage.result.existing_knowledge).toMatchObject({
        matched_total: 2,
        returned: 1,
        page: { has_more: true },
      });
      expect(firstPage.result.next_action.kind).toBe("read_next_page");
      expect(firstPage.result.next_action.command).toContain("--view existing-knowledge");
      expect(firstPage.result.next_action.command).toContain("--page-size 1");
      expect(firstPage.result.next_action.command).toContain("--page-token 1");
      expect(firstPage.result.existing_knowledge.page.next_command).toBe(firstPage.result.next_action.command);

      writeFileSync(join(
        projectRoot,
        "knowledge",
        "architecture",
        "product-docs",
        "setup-advanced.md",
      ), [
        "---",
        "title: Install Advanced",
        "type: Guide",
        "description: A second approved identity sharing a title prefix and tag.",
        "tags:",
        "  - module",
        "timestamp: 2026-06-24T12:00:00Z",
        "node_ref: entity/setup-advanced",
        "view_ref: architecture:entity/setup-advanced",
        "node_type: entity",
        "---",
        "",
      ].join("\n"), "utf8");

      const exactTier = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "existing-knowledge",
        "--query",
        "Install",
        "--page-size",
        "1",
        "--format",
        "json",
      ])) as {
        result: {
          existing_knowledge: {
            matched_total: number;
            returned: number;
            match_tier: string;
            broader_identity_matches: number;
            nodes: Array<{ node_ref: string }>;
            page: { has_more: boolean };
          };
        };
      };
      expect(exactTier.result.existing_knowledge).toMatchObject({
        matched_total: 1,
        returned: 1,
        match_tier: "exact",
        broader_identity_matches: 1,
        nodes: [{ node_ref: "entity/setup" }],
      });
      expect(exactTier.result.existing_knowledge.page.has_more).toBe(false);

      const relatedOnly = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "existing-knowledge",
        "--query",
        "module",
        "--page-size",
        "1",
        "--format",
        "json",
      ])) as {
        result: {
          existing_knowledge: {
            matched_total: number;
            returned: number;
            nodes: unknown[];
            related: {
              tag_matches: {
                matched_total: number;
                match_tier: string;
                by_node_type: Record<string, number>;
                by_collection: Record<string, number>;
              };
            };
            page: { has_more: boolean };
          };
          next_action: { kind: string; message: string };
        };
      };
      expect(relatedOnly.result.existing_knowledge).toMatchObject({
        matched_total: 0,
        returned: 0,
        nodes: [],
        related: {
          tag_matches: {
            matched_total: 2,
            match_tier: "exact",
            by_node_type: { entity: 2 },
            by_collection: { architecture: 2 },
          },
        },
      });
      expect(relatedOnly.result.existing_knowledge.page.has_more).toBe(false);
      expect(relatedOnly.result.next_action).toMatchObject({
        kind: "existing_knowledge_ready",
        message: expect.stringContaining("summarized without expanding"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
