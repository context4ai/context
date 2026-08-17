import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";
import {
  createCapturedCompileProject,
  enableKbPackage,
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  sourceRefs,
  sourceRefsForRanges,
  stageConfirmedMultiCollectionStructure,
  stageConfirmedStructure,
  stageConfirmedParentIndexStructure,
  writeJsonl,
  writeYaml,
} from "./projectCompileProseV066Helpers.js";
import { collectProjectStatus } from "../project/status.js";

interface MutableConfirmedStructure {
  edges: Array<{ type: string; note?: string }>;
  lifecycle: { structure_digest: string };
}

async function stageStructureRevision(
  projectRoot: string,
  mutate: (structure: MutableConfirmedStructure) => void,
  seed?: MutableConfirmedStructure,
): Promise<MutableConfirmedStructure> {
  const structurePath = join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml");
  if (!existsSync(structurePath)) {
    if (seed === undefined) throw new Error("structure revision requires an explicit lifecycle seed");
    mkdirSync(dirname(structurePath), { recursive: true });
    writeFileSync(structurePath, YAML.stringify(seed), "utf8");
  }
  const structure = YAML.parse(readFileSync(structurePath, "utf8")) as MutableConfirmedStructure;
  mutate(structure);
  structure.lifecycle.structure_digest = "sha256:stale";
  writeFileSync(structurePath, YAML.stringify(structure), "utf8");
  const validated = JSON.parse(await runCliInDir(projectRoot, [
    "run",
    "align:file:product-docs:architecture",
    "--validate",
    "--input",
    ".tmp/context-runtime/lifecycle/structure.yaml",
    "--format",
    "json",
  ])) as { result: { structure_digest: string } };
  structure.lifecycle.structure_digest = validated.result.structure_digest;
  writeFileSync(structurePath, YAML.stringify(structure), "utf8");
  await runCliInDir(projectRoot, [
    "run",
    "align:file:product-docs:architecture",
    "--stage",
    "--input",
    ".tmp/context-runtime/lifecycle/structure.yaml",
    "--format",
    "json",
  ]);
  return structure;
}

describe("0.6.6 compileProse edge projection", () => {
  test("close projects confirmed source-backed edges for approved nodes", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      const [edgeRef] = await sourceRefsForRanges(projectRoot, [{ lineStart: 7, lineEnd: 7 }]);
      await stageConfirmedStructure(projectRoot, [refs[0]!]);

      for (const node of [
        { id: "entity/install", section: "install", summary: "Install source span" },
        { id: "entity/configure", section: "configure", summary: "Configure source span" },
      ]) {
        const actionFile = writeYaml(projectRoot, `${node.section}-actions.yaml`, {
          schema_version: "context.compile-actions.v1",
          view_ref: `architecture:${node.id}`,
          actions: [{
            op: "add",
            section_id: node.section,
            kind: "description",
            ...(node.section === "install" ? { summary: node.summary } : {}),
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
      }

      const ledgerRows = readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as {
          candidate_id: string;
          shared_source_refs?: string[];
          review: { summary: string; behavior_summary?: string; edge_summary?: string };
        });
      const installCandidate = ledgerRows.find((row) => row.candidate_id === "architecture/entity/install");
      const configureCandidate = ledgerRows.find((row) => row.candidate_id === "architecture/entity/configure");
      const sharedRef = refs[0]!;
      expect(installCandidate?.shared_source_refs).toEqual([sharedRef]);
      expect(configureCandidate?.shared_source_refs).toEqual([sharedRef]);
      expect(installCandidate?.review.behavior_summary).toBe("Install knowledge.");
      expect(installCandidate?.review.edge_summary).toBe("Reachable edges: contains <- domain/product-docs; prerequisite -> entity/configure.");
      expect(installCandidate?.review.summary).toContain("Install knowledge.");
      expect(installCandidate?.review.summary).toContain("Reachable edges: contains <- domain/product-docs; prerequisite -> entity/configure.");
      expect(configureCandidate?.review.edge_summary).toBe("Reachable edges: prerequisite <- entity/install.");
      expect(configureCandidate?.review.summary).toContain("Configure knowledge.");

      const reviewHtml = JSON.parse(await runCliInDir(projectRoot, ["review", "html", "architecture", "--format", "json"])) as { path: string };
      const html = readFileSync(reviewHtml.path, "utf8");
      const scopeMatch = /const payloadScope = (\{[^\n]+\});/u.exec(html);
      expect(scopeMatch).not.toBeNull();
      const scope = JSON.parse(scopeMatch![1]!) as Record<string, unknown>;
      expect(scope).toMatchObject({ kind: "collection", collection: "architecture", count: 2 });
      expect(scope.ids_sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(scope).not.toHaveProperty("visible_candidate_ids");
      expect(html).toContain("Edge preview");
      expect(html).toContain("Shared source refs");
      expect(html).toContain("shared source");
      expect(html).toContain("prerequisite");
      expect(html).toContain("entity/install");
      expect(html).toContain("entity/configure");
      expect(html).toContain("Edge preview（2 个关系）");
      expect(html).toContain("1 条证据");
      expect(html).toContain("Technical details（ID 与 ");
      expect(html).toContain("Evidence（");
      expect(html).not.toContain('<details class="edge-preview" open');
      expect(html).toContain("html(item.display_summary || item.review.summary)");
      const script = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1];
      expect(script).toBeDefined();
      expect(() => new Function(script!)).not.toThrow();

      const payload = writeJsonl(projectRoot, "review-edge-nodes.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      const approvedInstall = readFileSync(join(projectRoot, "knowledge", "architecture", "install", "overview.md"), "utf8");
      expect(approvedInstall).toContain("description: Install knowledge.");
      expect(approvedInstall).not.toContain("description: Install knowledge. Reachable edges:");

      const confirmedStructure = YAML.parse(readFileSync(
        join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"),
        "utf8",
      )) as MutableConfirmedStructure;
      const close = JSON.parse(await runCliInDir(projectRoot, ["close", "--format", "json"])) as {
        nodes: number;
        views: number;
        edges: number;
        edgeContract: { validationScope: string; valid: boolean; checked: number };
      };
      expect(close.nodes).toBe(2);
      expect(close.views).toBe(2);
      expect(close.edges).toBe(1);
      expect(close.edgeContract).toMatchObject({ validationScope: "structure", valid: true, checked: 1 });
      const structure = YAML.parse(readFileSync(join(projectRoot, "knowledge", "structure.yaml"), "utf8")) as {
        nodes: Array<{ node_ref: string; node_type: string }>;
        edges: Array<{ type: string; from: string; to: string; source_refs: string[]; note?: string }>;
      };
      expect(structure.nodes.map((node) => node.node_ref).sort()).toEqual(["entity/configure", "entity/install"]);
      expect(structure.edges).toEqual([{
        type: "prerequisite",
        from: "entity/install",
        to: "entity/configure",
        source_refs: [edgeRef!],
        note: "Install comes before configure.",
      }]);
      expect((await collectProjectStatus(projectRoot)).close.state).toBe("ready");
      expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle"))).toBe(false);

      const prerequisiteEdge = confirmedStructure.edges.find((edge) => edge.type === "prerequisite");
      expect(prerequisiteEdge).toBeDefined();
      await stageStructureRevision(projectRoot, (structure) => {
        structure.edges.find((edge) => edge.type === "prerequisite")!.note = "Install must still be reviewed before configure.";
      }, confirmedStructure);

      expect((await collectProjectStatus(projectRoot)).close.state).toBe("stale");
      const staleVerify = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(staleVerify.status).not.toBe(0);
      expect(staleVerify.stdout).toContain("approved-structure-input-hash-mismatch");

      prerequisiteEdge!.note = "Install comes before configure.";
      const withoutEdgeStructure = await stageStructureRevision(projectRoot, (structure) => {
        structure.edges = structure.edges.filter((edge) => edge.type !== "prerequisite");
      });
      const deletedEdgeClose = JSON.parse(await runCliInDir(projectRoot, ["close", "--format", "json"])) as {
        edges: number;
      };
      expect(deletedEdgeClose.edges).toBe(0);
      const deletedEdgeStructure = YAML.parse(readFileSync(join(projectRoot, "knowledge", "structure.yaml"), "utf8")) as {
        edges: Array<{ type: string }>;
      };
      expect(deletedEdgeStructure.edges).toEqual([]);

      await stageStructureRevision(projectRoot, (structure) => {
        structure.edges.push(prerequisiteEdge!);
      }, withoutEdgeStructure);
      const reclose = JSON.parse(await runCliInDir(projectRoot, ["close", "--format", "json"])) as {
        edges: number;
      };
      expect(reclose.edges).toBe(1);
      const reclosedStructure = YAML.parse(readFileSync(join(projectRoot, "knowledge", "structure.yaml"), "utf8")) as {
        edges: Array<{ type: string; note?: string }>;
      };
      expect(reclosedStructure.edges).toContainEqual(expect.objectContaining({
        type: "prerequisite",
        note: "Install comes before configure.",
      }));
      await enableKbPackage(projectRoot);
      await runCliInDir(projectRoot, ["build", "--format", "json"]);
      const inventory = JSON.parse(readFileSync(join(projectRoot, "dist", "sample-kb", "context-build-inventory.json"), "utf8")) as {
        structure: {
          edges: number;
          edge_contract: {
            validation_scope: string;
            valid: boolean;
            checked: number;
            allowed_types: string[];
            source_ref_validation: { status: string; evidence_status?: string };
          };
        };
      };
      expect(inventory.structure.edges).toBe(1);
      expect(inventory.structure.edge_contract).toMatchObject({
        validation_scope: "structure",
        valid: true,
        checked: 1,
        source_ref_validation: { status: "verified-by-context-verify", evidence_status: "pass" },
      });
      expect(inventory.structure.edge_contract.allowed_types).toContain("prerequisite");
      rmSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle"), { recursive: true, force: true });
      const structurePath = join(projectRoot, "knowledge", "structure.yaml");
      const structureWithForeignSource = YAML.parse(readFileSync(structurePath, "utf8")) as {
        nodes: Array<Record<string, unknown>>;
        views: Array<Record<string, unknown> & { view_ref?: string; sections?: Array<Record<string, unknown>> }>;
      };
      const installView = structureWithForeignSource.views.find((view) => view.view_ref === "architecture:entity/install");
      installView?.sections?.push({
        id: "foreign-source-note",
        section_ref: "architecture:entity/install#foreign-source-note",
        kind: "description",
        source_refs: ["file:other-docs/guide.md#span:overview L1-1@deadbeef"],
      });
      structureWithForeignSource.nodes.push({
        node_ref: "entity/foreign-source",
        title: "Foreign Source",
        node_type: "entity",
        tags: ["module"],
      });
      structureWithForeignSource.views.push({
        view_ref: "architecture:entity/foreign-source",
        node_ref: "entity/foreign-source",
        collection: "architecture",
        containment: "foreign",
        slug: "overview",
        title: "Foreign Source",
        node_type: "entity",
        path: "architecture/foreign/overview.md",
        tags: ["module"],
        sections: [{
          id: "overview",
          section_ref: "architecture:entity/foreign-source#overview",
          kind: "description",
          source_refs: ["file:other-docs/guide.md#span:overview L1-1@deadbeef"],
        }],
      });
      writeFileSync(structurePath, YAML.stringify(structureWithForeignSource), "utf8");
      const restoredReadPlan = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "read-plan",
        "--format",
        "json",
      ])) as {
        result: { read_plan: { nodes: Array<{ view_ref: string; section_ids: string[] }> } };
      };
      expect(restoredReadPlan.result.read_plan.nodes.map((node) => node.view_ref)).not.toContain("architecture:entity/foreign-source");
      expect(restoredReadPlan.result.read_plan.nodes.find((node) => node.view_ref === "architecture:entity/install")?.section_ids).toContain("foreign-source-note");
      const restoredContext = JSON.parse(await runCliInDir(projectRoot, [
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
            node: { view_ref: string; node_ref: string };
            planned_sections: Array<{ source_refs: string[] }>;
            existing: { present: boolean; sections: Array<{ id: string; source_refs: string[] }> };
          };
        };
      };
      expect(restoredContext.result.node_context.node.view_ref).toBe("architecture:entity/install");
      expect(restoredContext.result.node_context.node.node_ref).toBe("entity/install");
      expect(restoredContext.result.node_context.planned_sections[0]?.source_refs[0]).toBe(refs[0]);
      expect(restoredContext.result.node_context.existing.present).toBe(true);
      expect(restoredContext.result.node_context.existing.sections[0]?.id).toBe("install");
      expect(restoredContext.result.node_context.existing.sections[0]?.source_refs[0]).toBe(refs[0]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("one captured source can produce multiple collections through compile review close and build", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedMultiCollectionStructure(projectRoot, refs);

      const views = [
        { viewRef: "architecture:entity/install", sectionId: "overview", kind: "description", summary: "Install architecture overview" },
        { viewRef: "decision:entity/install", sectionId: "choice", kind: "decision", summary: "Install decision rationale" },
        { viewRef: "sop:action/install-runbook", sectionId: "commands", kind: "spec", summary: "Install command runbook" },
      ];
      for (const view of views) {
        const context = JSON.parse(await runCliInDir(projectRoot, [
          "run",
          "compile:file:product-docs:architecture",
          "--view",
          "node-context",
          "--source",
          view.viewRef,
          "--format",
          "json",
        ])) as {
          result: { node_context: { planned_sections: Array<{ local_source_refs: string[] }> } };
        };
        const actionFile = writeYaml(projectRoot, `${view.sectionId}-multi-collection-actions.yaml`, {
          schema_version: "context.compile-actions.v1",
          view_ref: view.viewRef,
          actions: [{
            op: "add",
            section_id: view.sectionId,
            kind: view.kind,
            summary: view.summary,
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
      }

      const structurePath = join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml");
      const originalStructureText = readFileSync(structurePath, "utf8");
      const structureWithIrrelevantEdge = YAML.parse(originalStructureText) as { edges: unknown[] };
      structureWithIrrelevantEdge.edges.push({
        type: "related",
        from: "entity/unrelated",
        to: "entity/other",
        source_refs: ["repo:unrelated#symbol:Other:function@deadbeef"],
        note: "irrelevant edge must not render in candidate review",
      });
      writeFileSync(structurePath, YAML.stringify(structureWithIrrelevantEdge), "utf8");

      const reviewHtml = JSON.parse(await runCliInDir(projectRoot, ["review", "html", "--all", "--format", "json"])) as {
        path: string;
        candidates: number;
      };
      expect(reviewHtml.candidates).toBe(3);
      const html = readFileSync(reviewHtml.path, "utf8");
      expect(html).toContain("architecture/entity/install");
      expect(html).toContain("decision/entity/install");
      expect(html).toContain("sop/action/install-runbook");
      expect(html).toContain('"collection":"architecture"');
      expect(html).toContain('"collection":"decision"');
      expect(html).toContain('"collection":"sop"');
      expect(html).toContain("architecture / ");
      expect(html).toContain("decision / ");
      expect(html).toContain("sop / ");
      expect(html).toContain("candidate_id=");
      expect(html).toContain("node_ref=");
      expect(html).toContain("view_ref=");
      expect(html).toContain('"related_edges"');
      expect(html).toContain("Related edges");
      expect(html).toContain("Decision view qualifies the architecture view.");
      expect(html).not.toContain("irrelevant edge must not render in candidate review");
      writeFileSync(structurePath, originalStructureText, "utf8");

      for (const candidateId of ["architecture/entity/install", "decision/entity/install", "sop/action/install-runbook"]) {
        await runCliInDir(projectRoot, ["review", "approve", candidateId, "--all", "--format", "json"]);
      }

      expect(readFileSync(join(projectRoot, "knowledge", "architecture", "install", "overview.md"), "utf8")).toContain("view_ref: architecture:entity/install");
      expect(readFileSync(join(projectRoot, "knowledge", "decision", "install", "choice.md"), "utf8")).toContain("view_ref: decision:entity/install");
      expect(readFileSync(join(projectRoot, "knowledge", "sop", "install", "runbook.md"), "utf8")).toContain("view_ref: sop:action/install-runbook");

      const close = JSON.parse(await runCliInDir(projectRoot, ["close", "--format", "json"])) as {
        nodes: number;
        views: number;
        edges: number;
        edgeContract: { valid: boolean; checked: number };
      };
      expect(close.nodes).toBe(2);
      expect(close.views).toBe(3);
      expect(close.edges).toBe(3);
      expect(close.edgeContract).toMatchObject({ valid: true, checked: 3 });

      writeFileSync(join(projectRoot, "src", "index.ts"), [
        'import { alignProse, captureFile, compileProse, defineProject, kbPackage, reviewValidity, source } from "@c4a/context";',
        "",
        'const productDocs = source("product-docs");',
        "",
        "export default defineProject({",
        "  sources: [productDocs],",
        "  phases: [",
        "    captureFile({ source: productDocs }),",
        '    alignProse({ source: productDocs, collection: "architecture" }),',
        '    compileProse({ source: productDocs, collection: "architecture" }),',
        '    reviewValidity({ scope: "all" }),',
        "  ],",
        "  packages: [",
        "    kbPackage({",
        '      name: "sample-kb",',
        '      template: { path: "src/package-templates/kb", vars: { displayName: "Sample KB" } },',
        "    }),",
        "  ],",
        "});",
        "",
      ].join("\n"), "utf8");
      await runCliInDir(projectRoot, ["package", "template", "accept", "--all", "--format", "json"]);
      await runCliInDir(projectRoot, ["build", "--format", "json"]);

      for (const path of [
        ["architecture", "install", "overview.md"],
        ["decision", "install", "choice.md"],
        ["sop", "install", "runbook.md"],
      ]) {
        const page = readFileSync(join(projectRoot, "dist", "sample-kb", "guides", ...path), "utf8");
        expect(page).not.toContain("node_ref:");
        expect(page).not.toContain("view_ref:");
        expect(page).not.toContain("resource:");
        expect(page).not.toContain("sources:");
        expect(page).not.toContain("context:section");
        expect(page).not.toContain("context:summary");
      }
      const inventory = YAML.parse(readFileSync(join(projectRoot, "knowledge", "structure.yaml"), "utf8")) as {
        edges: Array<{ type: string; from: string; to: string }>;
      };
      expect(inventory.edges).toHaveLength(3);
      expect(inventory.edges.map((edge) => [edge.type, edge.from, edge.to])).toEqual(expect.arrayContaining([
        ["contains", "entity/install", "action/install-runbook"],
        ["supersedes", "decision:entity/install#choice", "architecture:entity/install"],
        ["applies_to", "sop:action/install-runbook", "architecture:entity/install"],
      ]));
      const buildInventory = JSON.parse(readFileSync(join(projectRoot, "dist", "sample-kb", "context-build-inventory.json"), "utf8")) as {
        approved_knowledge: {
          files: Array<{ internal_collection: string; okf_root: string; dist_path: string; view_ref: string }>;
          groups: Array<{ internal_collection: string; okf_root: string; edge_count: number; edge_contract: { validation_scope: string; valid: boolean; checked: number } }>;
          collections: Array<{ internal_collection: string; okf_root: string; count: number; edge_count: number; edge_contract: { validation_scope: string; valid: boolean; checked: number } }>;
        };
      };
      expect(buildInventory.approved_knowledge.files).toEqual(expect.arrayContaining([
        expect.objectContaining({
          internal_collection: "architecture",
          okf_root: "guides",
          dist_path: "guides/architecture/install/overview.md",
          view_ref: "architecture:entity/install",
        }),
        expect.objectContaining({
          internal_collection: "decision",
          okf_root: "guides",
          dist_path: "guides/decision/install/choice.md",
          view_ref: "decision:entity/install",
        }),
        expect.objectContaining({
          internal_collection: "sop",
          okf_root: "guides",
          dist_path: "guides/sop/install/runbook.md",
          view_ref: "sop:action/install-runbook",
        }),
      ]));
      for (const collection of ["architecture", "decision", "sop"]) {
        const group = buildInventory.approved_knowledge.groups.find((candidate) => candidate.internal_collection === collection);
        expect(group).toBeDefined();
        expect(group?.edge_count).toBeGreaterThan(0);
        expect(group?.edge_contract).toMatchObject({
          validation_scope: "collection",
          valid: true,
          checked: group?.edge_count,
        });
        const collectionSummary = buildInventory.approved_knowledge.collections.find((candidate) => candidate.internal_collection === collection);
        expect(collectionSummary).toBeDefined();
        expect(collectionSummary).toMatchObject({
          okf_root: "guides",
          count: 1,
          edge_count: group?.edge_count,
          edge_contract: {
            validation_scope: "collection",
            valid: true,
            checked: group?.edge_count,
          },
        });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("parent-index views materialize as generated directory pages backed by contains edges", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedParentIndexStructure(projectRoot, refs);

      const parentContext = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "node-context",
        "--source",
        "architecture:action/runbook",
        "--format",
        "json",
      ])) as {
        result: {
          node_context: {
            generated: string;
            planned_sections: unknown[];
            parent_index: { children: Array<{ view_ref: string; path: string }>; source_refs: string[] };
            next_action: { kind: string; command: string };
          };
        };
      };
      expect(parentContext.result.node_context.generated).toBe("parent_index");
      expect(parentContext.result.node_context.planned_sections).toEqual([]);
      expect(parentContext.result.node_context.parent_index.children.map((child) => child.view_ref)).toEqual([
        "architecture:action/runbook/install",
        "architecture:action/runbook/commands",
      ]);
      expect(parentContext.result.node_context.parent_index.source_refs).toHaveLength(2);
      expect(parentContext.result.node_context.next_action).toMatchObject({
        kind: "validate_compile_batch",
        command: "context run compile:file:product-docs:architecture --validate --format json",
      });

      const parentStage = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--stage",
        "--format",
        "json",
      ])) as { result: { views: number; sections: number; candidates: { added: number } } };
      expect(parentStage.result.views).toBe(3);
      expect(parentStage.result.sections).toBe(4);
      expect(parentStage.result.candidates.added).toBe(3);

      const payload = writeJsonl(projectRoot, "review-parent-index.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);

      const parentMarkdown = readFileSync(join(projectRoot, "knowledge", "architecture", "runbook", "index.md"), "utf8");
      expect(parentMarkdown).toContain("generated: parent_index");
      expect(parentMarkdown).toContain("children:");
      expect(parentMarkdown).toContain("- [Install Steps](install.md) — Install steps.");
      expect(parentMarkdown).toContain("- [Command Steps](commands.md) — Command steps.");
      expect(parentMarkdown).not.toContain("context:section");
      expect(readFileSync(join(projectRoot, "knowledge", "architecture", "runbook", "install.md"), "utf8")).toContain("context:section");

      const close = JSON.parse(await runCliInDir(projectRoot, ["close", "--format", "json"])) as {
        nodes: number;
        edges: number;
      };
      expect(close.nodes).toBe(3);
      expect(close.edges).toBe(2);
      const verify = JSON.parse(await runCliInDir(projectRoot, ["verify", "--format", "json"])) as {
        ok: boolean;
        evidence_status: string;
      };
      expect(verify).toMatchObject({ ok: true, evidence_status: "pass" });
      const structure = YAML.parse(readFileSync(join(projectRoot, "knowledge", "structure.yaml"), "utf8")) as {
        views: Array<{ view_ref: string; generated?: string; sections: unknown[]; children?: unknown[] }>;
        edges: Array<{ type: string; from: string; to: string; source_refs: string[] }>;
      };
      const parentView = structure.views.find((view) => view.view_ref === "architecture:action/runbook");
      expect(parentView).toMatchObject({
        generated: "parent_index",
        sections: [],
      });
      expect(parentView?.children).toHaveLength(2);
      expect(structure.edges.filter((edge) => edge.type === "contains").map((edge) => [edge.from, edge.to])).toEqual(expect.arrayContaining([
        ["architecture:action/runbook", "architecture:action/runbook/install"],
        ["architecture:action/runbook", "architecture:action/runbook/commands"],
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
