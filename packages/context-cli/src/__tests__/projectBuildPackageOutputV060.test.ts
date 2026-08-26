import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import {
  appendRejectedCandidate,
  createApprovedProject,
  runCliInDir,
} from "./projectBuildVerifyV060Helpers.js";
import { knowledgeInventory, type ApprovedKnowledgeFile } from "../project/packageIndexes.js";

describe("0.6.0 project package output", () => {
  test("knowledge inventory keeps collection-aware group index paths and template links", () => {
    const files: ApprovedKnowledgeFile[] = [
      {
        relPath: "wikis/entity/rspack.md",
        absPath: "/tmp/wikis/entity/rspack.md",
        content: "---\ntitle: Rspack\ntype: Knowledge\n---\n",
      },
      {
        relPath: "guides/entity/rspack-migration.md",
        absPath: "/tmp/guides/entity/rspack-migration.md",
        content: "---\ntitle: Rspack Migration\ntype: Guide\n---\n",
      },
      {
        relPath: "rules/security.md",
        absPath: "/tmp/rules/security.md",
        content: "---\ntitle: Security Rule\ntype: Rule\n---\n",
      },
    ];

    const inventory = knowledgeInventory(files, "meta/inventory.md");
    const groups = new Map(inventory.groups.map((group) => [`${group.collection}:${group.name}`, group]));

    expect(groups.get("wikis:entity")).toMatchObject({
      collection: "wikis",
      hasIndex: false,
      indexPath: "wikis/entity/index.md",
      indexHrefFromTemplate: "../wikis/entity/index.md",
      indexHrefFromCollectionIndex: "./entity/index.md",
    });
    expect(groups.get("guides:entity")).toMatchObject({
      collection: "guides",
      hasIndex: false,
      indexPath: "guides/entity/index.md",
      indexHrefFromTemplate: "../guides/entity/index.md",
      indexHrefFromCollectionIndex: "./entity/index.md",
    });
    expect(groups.get("rules:root")).toMatchObject({
      collection: "rules",
      title: "Rules",
      hasIndex: true,
      indexPath: "rules/index.md",
      indexHrefFromTemplate: "../rules/index.md",
      indexHrefFromCollectionIndex: "./index.md",
    });
    expect(inventory.groupsMarkdown).toContain("[Wikis](../wikis/index.md)");
    expect(inventory.groupsMarkdown).toContain("[Guides](../guides/index.md)");
    expect(inventory.groupsMarkdown).toContain("[Rules](../rules/index.md)");
  });

  test("build renders declared packages from approved knowledge only", async () => {
    const resourceHash = "a".repeat(64);
    const fixture = await createApprovedProject({
      approvedMarkdownSuffix: `![Example](../../../assets/image/${resourceHash}.png)`,
      beforeClose: (project) => {
        const knowledgeResource = join(project, "knowledge", "assets", "image", `${resourceHash}.png`);
        mkdirSync(join(project, "knowledge", "assets", "image"), { recursive: true });
        writeFileSync(knowledgeResource, "image-bytes", "utf8");
      },
    });
    try {
      appendRejectedCandidate(fixture.project, fixture.sourceRef);
      await runCliInDir(fixture.project, ["close", "--format", "json"]);
      const statusBefore = await runCliInDir(fixture.project, ["status"]);
      expect(statusBefore).toContain("state: route.build.package-stale");
      expect(statusBefore).toContain("package sample-kb: missing");

      const build = await runCliInDir(fixture.project, ["build"]);
      expect(build).toContain("✓ built project packages");
      expect(build).toContain("sample-kb");
      expect(build).toContain("sample-llms");
      expect(build).toContain("sample-kb (kb, created)");
      expect(build).toContain("added:");
      expect(build).toContain("wikis/codeindex: 1 page(s)");
      expect(build).toContain("indexes:");
      expect(build).toContain("resources: 1 file(s)");

      const kbAgent = readFileSync(join(fixture.project, "dist", "sample-kb", "AGENTS.md"), "utf8");
      const querySkill = readFileSync(join(fixture.project, "dist", "sample-kb", "skills", "knowledge-query", "SKILL.md"), "utf8");
      const queryScript = readFileSync(join(
        fixture.project,
        "dist",
        "sample-kb",
        "skills",
        "knowledge-query",
        "scripts",
        "search.mjs",
      ), "utf8");
      expect(kbAgent).toContain("# sample-kb");
      expect(kbAgent).toContain("display=Sample KB");
      expect(kbAgent).toContain("knowledge=1");
      expect(querySkill).toContain("Answer from the approved knowledge");
      expect(querySkill).toContain("Query Procedure");
      expect(querySkill).toContain("Package Roots");
      expect(querySkill).toContain("Evidence Contract");
      expect(querySkill).toContain("Route By Intent");
      expect(querySkill).toContain("Search Fallback");
      expect(querySkill).toContain("context:section");
      expect(querySkill).toContain("Treat every hit as a lead");
      expect(querySkill).toContain("Do not infer a relationship from page co-occurrence");
      expect(querySkill).toContain("Gap: this package does not contain evidence");
      expect(querySkill).toContain("Template Author Recommendation");
      expect(querySkill).toContain("edit it before publishing");
      expect(querySkill).not.toContain("C4A");
      expect(querySkill).toContain("scripts/search.mjs");
      expect(queryScript).toContain('const PACKAGE_NAME = "sample-kb";');
      expect(queryScript).not.toContain("{{packageName}}");
      const kbIndex = readFileSync(join(fixture.project, "dist", "sample-kb", "wikis", "index.md"), "utf8");
      expect(kbIndex).toContain("type: Knowledge Bundle");
      expect(kbIndex).toContain("timestamp:");
      expect(kbIndex).toContain("package: \"sample-kb\"");
      expect(kbIndex).toContain("package_kind: \"kb\"");
      expect(kbIndex).toContain("knowledge_count: 1");
      expect(kbIndex).not.toContain("\ncontext:\n");
      expect(kbIndex).toContain("## Contents");
      expect(kbIndex).toContain("[Button](./codeindex/sample-a/symbol/button.md) - Wiki");
      expect(kbIndex).not.toContain("context:template");
      expect(existsSync(join(fixture.project, "dist", "sample-kb", "wikis", "codeindex", "index.md"))).toBe(false);
      expect(existsSync(join(fixture.project, "dist", "sample-kb", "wikis", "codeindex", "sample-a", "index.md"))).toBe(false);
      expect(existsSync(join(fixture.project, "dist", "sample-kb", "wikis", "codeindex", "sample-a", "symbol", "index.md"))).toBe(false);
      expect(existsSync(join(fixture.project, "dist", "sample-kb", "meta", "sample-kb.txt"))).toBe(true);
      expect(existsSync(join(fixture.project, "dist", "sample-kb", "context-code-index-audit.json"))).toBe(false);
      expect(existsSync(join(fixture.project, "dist", "sample-kb", "wikis", `${fixture.approvedId}.md`))).toBe(true);
      const approvedPage = readFileSync(join(fixture.project, "knowledge", `${fixture.approvedId}.md`), "utf8");
      const distributedPage = readFileSync(join(fixture.project, "dist", "sample-kb", "wikis", `${fixture.approvedId}.md`), "utf8");
      const distributedResource = join(fixture.project, "dist", "sample-kb", "others", "assets", "image", `${resourceHash}.png`);
      expect(readFileSync(distributedResource, "utf8")).toBe("image-bytes");
      expect(distributedPage).toContain(`others/assets/image/${resourceHash}.png`);
      expect(approvedPage).toContain("node_type: entity");
      expect(approvedPage).not.toContain("candidate_fingerprint:");
      const structure = YAML.parse(readFileSync(join(fixture.project, "knowledge", "structure.yaml"), "utf8")) as {
        views: Array<{ path: string; machine?: { candidate_fingerprint?: string } }>;
      };
      expect(structure.views.find((view) => view.path === `${fixture.approvedId}.md`)?.machine?.candidate_fingerprint)
        .toMatch(/^sha256:/u);
      expect(distributedPage).not.toContain("sources:");
      expect(distributedPage).not.toContain("context:section");
      expect(distributedPage).not.toContain("context:summary");
      expect(distributedPage).not.toContain("node_ref:");
      expect(distributedPage).not.toContain("view_ref:");
      expect(distributedPage).not.toContain("resource:");
      expect(distributedPage).not.toContain("node_type:");
      expect(distributedPage).not.toContain("visibility:");
      expect(distributedPage).not.toContain("code_symbols:");
      expect(distributedPage).not.toContain("relationship_mode:");
      expect(distributedPage).not.toContain("code_edges:");
      expect(distributedPage).not.toContain("candidate_fingerprint:");
      const kbInventory = JSON.parse(readFileSync(join(fixture.project, "dist", "sample-kb", "context-build-inventory.json"), "utf8")) as {
        schema_version: string;
        approved_knowledge: {
          count: number;
          files: Array<{
            path: string;
            collection: string;
            path_within_collection: string;
            selected_by: Array<{ kind: string; value: string }>;
            production_metadata?: Record<string, unknown>;
          }>;
          groups: Array<{
            name: string;
            collection: string;
            okf_root: string;
            edge_count: number;
            has_index: boolean;
            index_path: string | null;
            selected_by: Array<{ kind: string; value: string }>;
            edge_contract: { validation_scope: string; valid: boolean; checked: number; source_ref_validation: { status: string; evidence_status?: string } };
          }>;
        };
        structure: {
          path: string;
          present: boolean;
          edge_contract: {
            validation_scope: string;
            valid: boolean;
            checked: number;
            allowed_types: string[];
            allowed_confidence: string[];
            source_ref_validation: { status: string; evidence_status?: string };
          };
        };
        code_index_audit: {
          report_digest: string;
          decision: string;
          code_pages: number;
          signals: number;
        };
      };
      expect(kbInventory.schema_version).toBe("context.package-build-inventory.v1");
      expect(kbInventory.approved_knowledge.count).toBe(1);
      expect(kbInventory.approved_knowledge.files[0]).toMatchObject({
        collection: "codeindex",
        internal_collection: "codeindex",
        okf_root: "wikis",
        approved_path: `${fixture.approvedId}.md`,
        dist_path: `wikis/${fixture.approvedId}.md`,
        path_within_collection: `${fixture.approvedId}.md`,
        node_ref: fixture.approvedId.replace(/^codeindex\//u, ""),
        view_ref: `codeindex:${fixture.approvedId.replace(/^codeindex\//u, "")}`,
        source: "20260712/sample-a",
        selected_by: [{ kind: "default", value: "all" }],
        production_metadata: {
          node_type: "entity",
          visibility: "exported",
          candidate_fingerprint: expect.stringMatching(/^sha256:/u),
        },
      });
      expect(kbInventory.approved_knowledge.groups[0]).toMatchObject({
        name: "codeindex",
        collection: "codeindex",
        internal_collection: "codeindex",
        okf_root: "wikis",
        edge_count: 0,
        has_index: false,
        index_path: null,
        selected_by: [{ kind: "default", value: "all" }],
        edge_contract: {
          validation_scope: "collection",
          valid: true,
          checked: 0,
          source_ref_validation: { status: "verified-by-context-verify" },
        },
      });
      expect(kbInventory.structure).toMatchObject({ path: "knowledge/structure.yaml", present: true, nodes: 1, edges: 0 });
      expect(kbInventory.structure.edge_contract).toMatchObject({
        validation_scope: "structure",
        valid: true,
        checked: 0,
        source_ref_validation: { status: "verified-by-context-verify" },
      });
      expect(kbInventory.structure.edge_contract.allowed_types).toContain("depends_on");
      expect(kbInventory.structure.edge_contract.allowed_confidence).toEqual(["possible", "hypothesis"]);
      expect(kbInventory.code_index_audit).toMatchObject({
        decision: "accept",
        code_pages: 1,
      });
      expect(kbInventory.code_index_audit.report_digest).toMatch(/^sha256:/u);

      const llms = readFileSync(join(fixture.project, "dist", "sample-llms", "llms.txt"), "utf8");
      expect(llms).toContain("# sample-llms");
      expect(llms).toContain(`# wikis/${fixture.approvedId}.md`);
      expect(llms).toContain(`<!-- approved_path: ${fixture.approvedId}.md -->`);
      expect(llms).toContain("Primary button used by product screens");
      expect(llms).toContain(`](./others/assets/image/${resourceHash}.png)`);
      expect(readFileSync(join(fixture.project, "dist", "sample-llms", "others", "assets", "image", `${resourceHash}.png`), "utf8")).toBe("image-bytes");
      expect(llms).not.toContain("Secret");

      const firstInventory = readFileSync(join(fixture.project, "dist", "sample-kb", "context-build-inventory.json"), "utf8");
      rmSync(join(fixture.project, "dist"), { recursive: true, force: true });
      await runCliInDir(fixture.project, ["build"]);
      const rebuiltInventory = readFileSync(join(fixture.project, "dist", "sample-kb", "context-build-inventory.json"), "utf8");
      expect(rebuiltInventory).toBe(firstInventory);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
