import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCapturedAlignProject, firstSourceRef, makeTmp, runCliInDir, sourceRefForLine, sourceRefForRange, structurePayload, writePayload } from "./projectAlignProseV062Helpers.js";

describe("0.6.6 prose align structure gate", () => {
  test("reports node quality tag and section kind diagnostics", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = await firstSourceRef(projectRoot);

      const qualityWarningsPayload = writePayload(projectRoot, "quality-warnings-structure.yaml", {
        ...structurePayload(projectRoot, sourceRef),
        nodes: [{
          node_ref: "entity/thin",
          title: "Thin Entity",
          node_type: "entity",
          tags: ["service"],
        }, {
          node_ref: "entity/term-overgrown",
          title: "Overgrown Term",
          node_type: "entity",
          tags: ["term"],
        }, {
          node_ref: "action/thin-process",
          title: "Thin Process",
          node_type: "action",
          tags: ["runbook"],
        }, {
          node_ref: "domain/no-children",
          title: "No Children Domain",
          node_type: "domain",
        }],
        views: [{
          view_ref: "architecture:entity/thin",
          node_ref: "entity/thin",
          collection: "architecture",
          containment: "quality",
          slug: "thin",
          title: "Thin Entity",
          node_type: "entity",
          path: "architecture/quality/thin.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/thin#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }, {
          view_ref: "architecture:entity/term-overgrown",
          node_ref: "entity/term-overgrown",
          collection: "architecture",
          containment: "quality",
          slug: "term-overgrown",
          title: "Overgrown Term",
          node_type: "entity",
          path: "architecture/quality/term-overgrown.md",
          sections: ["one", "two", "three", "four"].map((id) => ({
            id,
            section_ref: `architecture:entity/term-overgrown#${id}`,
            kind: "description",
            source_refs: [sourceRef],
          })),
        }, {
          view_ref: "architecture:action/thin-process",
          node_ref: "action/thin-process",
          collection: "architecture",
          containment: "quality",
          slug: "thin-process",
          title: "Thin Process",
          node_type: "action",
          path: "architecture/quality/thin-process.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:action/thin-process#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }, {
          view_ref: "architecture:domain/no-children",
          node_ref: "domain/no-children",
          collection: "architecture",
          containment: "quality",
          slug: "no-children",
          title: "No Children Domain",
          node_type: "domain",
          path: "architecture/quality/no-children.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:domain/no-children#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }],
        edges: [],
        unresolved: [],
      });
      const qualityWarnings = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        qualityWarningsPayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string }> } };
      expect(qualityWarnings.result.valid).toBe(false);
      expect(qualityWarnings.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "node.description_dominates",
      }));
      expect(qualityWarnings.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "node.thin_concrete_entity",
      }));
      expect(qualityWarnings.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "node.term_expanded_beyond_definition",
      }));
      expect(qualityWarnings.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "node.action_too_thin",
      }));
      expect(qualityWarnings.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "node.domain_without_children",
      }));

      const duplicateTagPayload = writePayload(projectRoot, "duplicate-tag-structure.yaml", {
        ...structurePayload(projectRoot, sourceRef),
        nodes: [{
          node_ref: "domain/product-docs",
          title: "Product Docs",
          node_type: "domain",
        }, {
          node_ref: "entity/install",
          title: "Install",
          node_type: "entity",
          tags: ["term", "term"],
        }],
      });
      const duplicateTag = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        duplicateTagPayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string }> } };
      expect(duplicateTag.result.valid).toBe(false);
      expect(duplicateTag.result.diagnostics.map((item) => item.code)).toContain("tags.duplicate");

      const singletonSectionRoutePayload = writePayload(projectRoot, "singleton-section-route.yaml", {
        ...structurePayload(projectRoot, sourceRef),
        nodes: [
          ...((structurePayload(projectRoot, sourceRef).nodes ?? []) as object[]),
          {
            node_ref: "entity/install/faq",
            title: "Install FAQ",
            node_type: "entity",
            tags: ["module"],
          },
        ],
        views: [
          ...((structurePayload(projectRoot, sourceRef).views ?? []) as object[]),
          {
            view_ref: "architecture:entity/install/faq",
            node_ref: "entity/install/faq",
            collection: "architecture",
            containment: "product-docs/install",
            slug: "faq",
            title: "Install FAQ",
            node_type: "entity",
            path: "architecture/product-docs/install/faq.md",
            sections: [{
              id: "faq",
              section_ref: "architecture:entity/install/faq#faq",
              kind: "faq",
              source_refs: [sourceRef],
            }],
          },
        ],
        edges: [
          ...((structurePayload(projectRoot, sourceRef).edges ?? []) as object[]),
          {
            type: "contains",
            from: "architecture:entity/install",
            to: "architecture:entity/install/faq",
            source_refs: [sourceRef],
          },
        ],
      });
      const singletonSectionRoute = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        singletonSectionRoutePayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; candidate_id?: string; severity?: string }> } };
      expect(singletonSectionRoute.result.valid).toBe(true);
      expect(singletonSectionRoute.result.diagnostics.map((item) => item.code)).not.toContain("view.section_route_check");

      const thinChildFragmentsPayload = writePayload(projectRoot, "thin-child-fragments.yaml", {
        schema_version: "context.structure.v1",
        sources: ["file:product-docs"],
        evidence_snapshot_hash: structurePayload(projectRoot, sourceRef).evidence_snapshot_hash,
        nodes: [{
          node_ref: "entity/platform",
          title: "Platform",
          node_type: "entity",
          tags: ["system"],
        }, {
          node_ref: "entity/platform/overview",
          title: "Platform Overview",
          node_type: "entity",
          tags: ["system"],
        }, {
          node_ref: "entity/platform/config",
          title: "Platform Config",
          node_type: "entity",
          tags: ["system"],
        }, {
          node_ref: "entity/platform/recovery",
          title: "Platform Recovery",
          node_type: "entity",
          tags: ["system"],
        }],
        views: [{
          view_ref: "architecture:entity/platform",
          node_ref: "entity/platform",
          collection: "architecture",
          containment: "platform",
          slug: "overview",
          title: "Platform",
          node_type: "entity",
          path: "architecture/platform/overview.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/platform#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }, {
          view_ref: "architecture:entity/platform/overview",
          node_ref: "entity/platform/overview",
          collection: "architecture",
          containment: "platform",
          slug: "platform-overview",
          title: "Platform Overview",
          node_type: "entity",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/platform/overview#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }, {
          view_ref: "architecture:entity/platform/config",
          node_ref: "entity/platform/config",
          collection: "architecture",
          containment: "platform",
          slug: "config",
          title: "Platform Config",
          node_type: "entity",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/platform/config#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }, {
          view_ref: "architecture:entity/platform/recovery",
          node_ref: "entity/platform/recovery",
          collection: "architecture",
          containment: "platform",
          slug: "recovery",
          title: "Platform Recovery",
          node_type: "entity",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/platform/recovery#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }],
        edges: [
          {
            type: "contains",
            from: "architecture:entity/platform",
            to: "architecture:entity/platform/overview",
            source_refs: [sourceRef],
          },
          {
            type: "contains",
            from: "architecture:entity/platform",
            to: "architecture:entity/platform/config",
            source_refs: [sourceRef],
          },
          {
            type: "contains",
            from: "architecture:entity/platform",
            to: "architecture:entity/platform/recovery",
            source_refs: [sourceRef],
          },
        ],
        unresolved: [],
        lifecycle: { state: "draft" },
      });
      const thinChildFragments = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        thinChildFragmentsPayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; candidate_id?: string; severity?: string }> } };
      expect(thinChildFragments.result.valid).toBe(true);
      expect(thinChildFragments.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "node.children_should_be_sections",
        candidate_id: "entity/platform",
      }));
      expect(thinChildFragments.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "tags.child_inherits_system",
        candidate_id: "entity/platform/overview",
      }));

      const multiLineRef = sourceRefForRange(projectRoot, "guide.md", 5, 7);
      const parentIndexPayload = writePayload(projectRoot, "parent-index-structure.yaml", {
        schema_version: "context.structure.v1",
        sources: ["file:product-docs"],
        nodes: [{
          node_ref: "action/install-guides",
          title: "Install Guides",
          node_type: "action",
          tags: ["runbook"],
        }, {
          node_ref: "action/install-guides/install",
          title: "Install",
          node_type: "action",
          tags: ["runbook"],
        }],
        views: [{
          view_ref: "architecture:action/install-guides",
          node_ref: "action/install-guides",
          collection: "architecture",
          containment: "runbooks",
          slug: "install-guides",
          title: "Install Guides",
          node_type: "action",
          generated: "parent_index",
          sections: [],
        }, {
          view_ref: "architecture:action/install-guides/install",
          node_ref: "action/install-guides/install",
          collection: "architecture",
          containment: "runbooks/install-guides",
          slug: "install",
          title: "Install",
          node_type: "action",
          sections: [{
            id: "install",
            section_ref: "architecture:action/install-guides/install#install",
            kind: "spec",
            source_refs: [multiLineRef],
          }, {
            id: "configure",
            section_ref: "architecture:action/install-guides/install#configure",
            kind: "warning",
            source_refs: [sourceRefForLine(projectRoot, "guide.md", 11)],
          }],
        }],
        edges: [{
          type: "contains",
          from: "architecture:action/install-guides",
          to: "architecture:action/install-guides/install",
          source_refs: [multiLineRef],
        }],
        unresolved: [],
        lifecycle: { state: "draft" },
      });
      const parentIndex = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        parentIndexPayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ severity: string; code: string; field?: string }> } };
      expect(parentIndex.result.valid).toBe(true);
      expect(parentIndex.result.diagnostics).not.toContainEqual(expect.objectContaining({
        severity: "error",
        code: "edge.source_ref_not_sentence_level",
      }));

      const conflictingTagsPayload = writePayload(projectRoot, "conflicting-tags-structure.yaml", {
        ...structurePayload(projectRoot, sourceRef),
        nodes: [{
          node_ref: "entity/react",
          title: "React",
          node_type: "entity",
          tags: ["lib", "term"],
        }],
        views: [{
          view_ref: "architecture:entity/react",
          node_ref: "entity/react",
          collection: "architecture",
          containment: "react",
          slug: "overview",
          title: "React",
          node_type: "entity",
          path: "architecture/react/overview.md",
          sections: [{
            id: "definition",
            section_ref: "architecture:entity/react#definition",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }],
        edges: [],
        unresolved: [],
      });
      const conflictingTags = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        conflictingTagsPayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string }> } };
      expect(conflictingTags.result.valid).toBe(false);
      expect(conflictingTags.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "tags.term_conflict",
      }));

      const tagContractBase = structurePayload(projectRoot, sourceRef);
      const invalidTagContractPayload = writePayload(projectRoot, "invalid-tag-contract-structure.yaml", {
        ...tagContractBase,
        nodes: [
          ...((tagContractBase.nodes as Array<Record<string, unknown>>)),
          {
            node_ref: "entity/no-tag",
            title: "No Tag Entity",
            node_type: "entity",
          },
          {
            node_ref: "entity/free-label",
            title: "Free Label Entity",
            node_type: "entity",
            tags: ["foobar"],
          },
          {
            node_ref: "entity/multiple-shapes",
            title: "Multiple Shape Entity",
            node_type: "entity",
            tags: ["app", "service"],
          },
          {
            node_ref: "entity/multiple-scopes",
            title: "Multiple Scope Entity",
            node_type: "entity",
            tags: ["application", "system"],
          },
          {
            node_ref: "action/no-kind",
            title: "No Kind Action",
            node_type: "action",
          },
          {
            node_ref: "action/multiple-kinds",
            title: "Multiple Kind Action",
            node_type: "action",
            tags: ["runbook", "howto"],
          },
          {
            node_ref: "action/free-label",
            title: "Free Label Action",
            node_type: "action",
            tags: ["foobar"],
          },
          {
            node_ref: "domain/tagged",
            title: "Tagged Domain",
            node_type: "domain",
            tags: ["service"],
          },
        ],
      });
      const invalidTagContract = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        invalidTagContractPayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string }> } };
      expect(invalidTagContract.result.valid).toBe(false);
      for (const code of [
        "tags.entity_required",
        "tags.entity_unknown",
        "tags.entity_a_multiple",
        "tags.entity_b_multiple",
        "tags.action_kind_required",
        "tags.action_kind_multiple",
        "tags.action_unknown",
        "tags.domain_forbidden",
      ]) {
        expect(invalidTagContract.result.diagnostics).toContainEqual(expect.objectContaining({
          severity: "error",
          code,
        }));
      }

      const invalidKindPayload = writePayload(projectRoot, "invalid-kind-structure.yaml", {
        ...structurePayload(projectRoot, sourceRef),
        nodes: [{
          node_ref: "domain/product-docs",
          title: "Product Docs",
          node_type: "domain",
        }],
        views: [{
          view_ref: "architecture:domain/product-docs",
          node_ref: "domain/product-docs",
          collection: "architecture",
          containment: "product-docs",
          slug: "overview",
          title: "Product Docs",
          node_type: "domain",
          path: "architecture/product-docs/overview.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:domain/product-docs#overview",
            kind: "example",
            source_refs: [sourceRef],
          }, {
            id: "legacy",
            section_ref: "architecture:domain/product-docs#legacy",
            kind: "body",
            source_refs: [sourceRef],
          }],
        }],
        edges: [],
        unresolved: [],
      });
      const invalidKind = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        invalidKindPayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string }> } };
      expect(invalidKind.result.valid).toBe(false);
      expect(invalidKind.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "schema.section_kind_mount_invalid",
      }));
      expect(invalidKind.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "schema.section_kind_invalid",
      }));

      writeFileSync(join(projectRoot, "..", "docs", "story.md"), [
        "# Story",
        "",
        "Acceptance: user can log in with valid credentials.",
        "",
      ].join("\n"), "utf8");
      await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);
      const storyRef = sourceRefForLine(projectRoot, "story.md", 3);
      const sourceBackedStoryPayload = writePayload(projectRoot, "source-backed-story-structure.yaml", {
        schema_version: "context.structure.v1",
        sources: ["file:product-docs"],
        nodes: [{
          node_ref: "action/login-story",
          title: "Login Story",
          node_type: "action",
          tags: ["user-story"],
        }],
        views: [{
          view_ref: "product:action/login-story",
          node_ref: "action/login-story",
          collection: "product",
          containment: "stories",
          slug: "login-story",
          title: "Login Story",
          node_type: "action",
          path: "product/stories/login-story.md",
          sections: [{
            id: "acceptance",
            section_ref: "product:action/login-story#acceptance",
            kind: "spec",
            source_refs: [storyRef],
          }],
        }],
        edges: [],
        unresolved: [],
        lifecycle: { state: "draft" },
      });
      const sourceBackedStory = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        sourceBackedStoryPayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; candidate_id?: string }> } };
      expect(sourceBackedStory.result.valid).toBe(true);
      expect(sourceBackedStory.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "node.action_too_thin",
        candidate_id: "action/login-story",
      }));

      writeFileSync(join(projectRoot, "..", "docs", "history.md"), [
        "# History",
        "",
        "History: user login changed in this release.",
        "",
      ].join("\n"), "utf8");
      await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);
      const historyRef = sourceRefForLine(projectRoot, "history.md", 3);
      const historyStoryPayload = writePayload(projectRoot, "history-story-structure.yaml", {
        schema_version: "context.structure.v1",
        sources: ["file:product-docs"],
        nodes: [{
          node_ref: "action/history-story",
          title: "History Story",
          node_type: "action",
          tags: ["user-story"],
        }],
        views: [{
          view_ref: "product:action/history-story",
          node_ref: "action/history-story",
          collection: "product",
          containment: "stories",
          slug: "history-story",
          title: "History Story",
          node_type: "action",
          path: "product/stories/history-story.md",
          sections: [{
            id: "note",
            section_ref: "product:action/history-story#note",
            kind: "spec",
            source_refs: [historyRef],
          }],
        }],
        edges: [],
        unresolved: [],
        lifecycle: { state: "draft" },
      });
      const historyStory = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        historyStoryPayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; candidate_id?: string }> } };
      expect(historyStory.result.valid).toBe(true);
      expect(historyStory.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "node.action_too_thin",
        candidate_id: "action/history-story",
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
