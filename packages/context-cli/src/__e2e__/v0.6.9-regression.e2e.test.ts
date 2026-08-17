import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import {
  createCapturedCompileProject,
  invokeCliInDir,
  makeTmp,
  multiCollectionStructurePayload,
  runCliInDir,
  sourceRefs,
  sourceRefsForRanges,
  stageConfirmedStructure,
  stageConfirmedRichStructure,
  writeJsonl,
  writeYaml,
} from "../__tests__/projectCompileProseV066Helpers.js";
import { readCandidateRecords, writeCandidateRecords } from "../project/candidateLedger.js";
import { parseAlignPayload } from "../project/proseAlignPayloadParse.js";
import type { AlignPayload } from "../project/proseAlignTypes.js";
import { writeStructureSnapshot } from "../project/proseStructureStore.js";

function localSourceRef(canonical: string): string {
  return canonical.replace(/^file:product-docs\/guide\.md/u, "src-1");
}

function writeApprovedPage(input: {
  projectRoot: string;
  collection: "architecture" | "product";
  type: "Wiki" | "Rule";
  viewRef: string;
  nodeRef: string;
  relPath: string;
  sourceRef: string;
}): void {
  const absPath = join(input.projectRoot, "knowledge", input.relPath);
  mkdirSync(join(absPath, ".."), { recursive: true });
  writeFileSync(absPath, [
    "---",
    "title: Install",
    `type: ${input.type}`,
    "description: Install source span.",
    "tags:",
    "  - module",
    "timestamp: 2026-06-24T12:00:00Z",
    "resource: file:product-docs/guide.md",
    "sources:",
    "  - file:product-docs/guide.md",
    `node_ref: ${input.nodeRef}`,
    `view_ref: ${input.viewRef}`,
    "node_type: entity",
    "---",
    "",
    `<!-- context:section id="overview" kind="description" source_ref="${localSourceRef(input.sourceRef)}" content_mode="verbatim" -->`,
    "Alpha opening paragraph for compile.",
    "<!-- /context:section -->",
    "",
  ].join("\n"), "utf8");
}

describe("0.6.9 regression E2E", () => {
  test("approved ViewRef path coordination resumes through compile Review and close", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedStructure(projectRoot, [refs[0]!]);
      const baselineStructure = YAML.parse(readFileSync(join(
        projectRoot,
        ".tmp",
        "context-runtime",
        "lifecycle",
        "structure.yaml",
      ), "utf8")) as AlignPayload;
      await runCliInDir(projectRoot, [
        "run", "compile:file:product-docs:architecture", "--stage", "--format", "json",
      ]);
      const baselineCandidates = await readCandidateRecords(projectRoot);
      const firstReview = writeJsonl(projectRoot, "view-path-e2e-first-review.json", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", firstReview, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);

      const movedViewRef = "architecture:entity/install";
      const movedPath = "architecture/alternate/install.md";
      const movedBody = {
        ...baselineStructure,
        views: baselineStructure.views.map((view) => view.view_ref === movedViewRef
          ? { ...view, containment: "alternate", path: movedPath }
          : view),
        lifecycle: { state: "draft" as const },
      };
      const draft = parseAlignPayload(movedBody).payload!;
      const conflicted = parseAlignPayload({
        ...movedBody,
        lifecycle: {
          state: "confirmed",
          phase_collection: "architecture",
          confirmed_by: "legacy-runtime",
          confirmed_at: "structure-snapshot",
          structure_digest: draft.structure_digest,
        },
      }).payload!;
      await writeStructureSnapshot(projectRoot, conflicted);
      await writeCandidateRecords(projectRoot, baselineCandidates.map((record) => ({
        ...record,
        status: "draft" as const,
        structure_digest: conflicted.structure_digest,
        ...(record.view_ref === movedViewRef ? { path: movedPath } : {}),
      })));

      const conflict = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as {
        state: string;
        reviewIdentityConflicts: { conflicts: Array<{ kind: string }> };
      };
      expect(conflict.state).toBe("route.review.identity-conflict");
      expect(conflict.reviewIdentityConflicts.conflicts).toContainEqual(expect.objectContaining({
        kind: "approved-identity-at-other-path",
      }));
      await runCliInDir(projectRoot, [
        "review",
        "reconcile-identities",
        "--source",
        "file:product-docs",
        "--strategy",
        "preserve-approved",
        "--format",
        "json",
      ]);
      const compile = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as { state: string };
      expect(compile.state).toBe("route.compile.pending-target");
      await runCliInDir(projectRoot, [
        "run", "compile:file:product-docs:architecture", "--stage", "--format", "json",
      ]);
      const finalReview = writeJsonl(projectRoot, "view-path-e2e-final-review.json", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", finalReview, "--format", "json"]);
      const close = JSON.parse(await runCliInDir(projectRoot, ["close", "--format", "json"])) as {
        edgeContract: { valid: boolean };
      };
      expect(close.edgeContract.valid).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("align identity coordination resumes through compile Review and close", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedStructure(projectRoot, [refs[0]!]);
      const baselineStructure = YAML.parse(readFileSync(join(
        projectRoot,
        ".tmp",
        "context-runtime",
        "lifecycle",
        "structure.yaml",
      ), "utf8")) as AlignPayload;
      await runCliInDir(projectRoot, [
        "run", "compile:file:product-docs:architecture", "--stage", "--format", "json",
      ]);
      const baselineCandidates = await readCandidateRecords(projectRoot);
      const firstReview = writeJsonl(projectRoot, "identity-e2e-first-review.json", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", firstReview, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);

      const draftBody = {
        ...baselineStructure,
        nodes: baselineStructure.nodes.map((node) =>
          node.node_ref === "entity/install"
            ? { ...node, node_ref: "entity/install-replacement" }
            : node
        ),
        views: baselineStructure.views.map((view) =>
          view.view_ref === "architecture:entity/install"
            ? {
                ...view,
                node_ref: "entity/install-replacement",
                view_ref: "architecture:entity/install-replacement",
                sections: view.sections.map((section) => ({
                  ...section,
                  section_ref: section.section_ref.replace(
                    "architecture:entity/install",
                    "architecture:entity/install-replacement",
                  ),
                })),
              }
            : view
        ),
        edges: baselineStructure.edges.map((edge) => ({
          ...edge,
          from: edge.from === "entity/install" ? "entity/install-replacement" : edge.from,
          to: edge.to === "entity/install" ? "entity/install-replacement" : edge.to,
        })),
        lifecycle: { state: "draft" as const },
      };
      const draft = parseAlignPayload(draftBody).payload!;
      const conflicted = parseAlignPayload({
        ...draftBody,
        lifecycle: {
          state: "confirmed",
          phase_collection: "architecture",
          confirmed_by: "legacy-runtime",
          confirmed_at: "structure-snapshot",
          structure_digest: draft.structure_digest,
        },
      }).payload!;
      await writeStructureSnapshot(projectRoot, conflicted);
      await writeCandidateRecords(projectRoot, baselineCandidates.map((record) => {
        const identityChanged = record.view_ref === "architecture:entity/install";
        return {
          ...record,
          status: "draft" as const,
          structure_digest: conflicted.structure_digest,
          ...(identityChanged
            ? {
                candidate_id: record.candidate_id.replace("entity/install", "entity/install-replacement"),
                node_ref: "entity/install-replacement",
                view_ref: "architecture:entity/install-replacement",
              }
            : {}),
        };
      }));

      const conflict = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as { state: string };
      expect(conflict.state).toBe("route.review.identity-conflict");
      await runCliInDir(projectRoot, [
        "review",
        "reconcile-identities",
        "--source",
        "file:product-docs",
        "--strategy",
        "preserve-approved",
        "--format",
        "json",
      ]);
      const compile = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as { state: string };
      expect(compile.state).toBe("route.compile.pending-target");
      await runCliInDir(projectRoot, [
        "run", "compile:file:product-docs:architecture", "--stage", "--format", "json",
      ]);
      const finalReview = writeJsonl(projectRoot, "identity-e2e-final-review.json", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", finalReview, "--format", "json"]);
      const close = JSON.parse(await runCliInDir(projectRoot, ["close", "--format", "json"])) as {
        edgeContract: { valid: boolean };
      };
      expect(close.edgeContract.valid).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("one captured source produces architecture decision and sop knowledge through build", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      const structureInput = writeYaml(projectRoot, "multi-collection-e2e-structure.yaml", await multiCollectionStructurePayload(projectRoot, refs));
      const staged = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--stage",
        "--input",
        structureInput,
        "--format",
        "json",
      ])) as {
        result: {
          phase_collection: string;
          collections: string[];
          lifecycle_state: string;
          views: number;
          structureFile: string;
          next_action: {
            kind: string;
            command: string;
            completed_operation: string;
            reason_code: string;
          };
        };
      };
      expect(staged.result).toMatchObject({
        phase_collection: "architecture",
        collections: ["architecture", "decision", "sop"],
        lifecycle_state: "confirmed",
        views: 3,
        structureFile: ".tmp/context-runtime/lifecycle/structure.yaml",
        next_action: {
          kind: "reevaluate_workspace_route",
          command: "context status --format json",
          completed_operation: "align:file:product-docs:architecture",
          reason_code: "prose-align-structure-confirmed",
        },
      });
      const status = JSON.parse(await runCliInDir(projectRoot, [
        "status",
        "--format",
        "json",
        "--view",
        "full",
      ])) as {
        alignPhaseResolution: {
          requestedCollections: string[];
        };
        compilePhaseResolution: {
          requestedCollections: string[];
          requestedTargets: Array<{
            sourceKey: string;
            collections: string[];
            phaseCollection?: string;
          }>;
        };
        workflow: {
          current: {
            node: string;
            reason_code: string;
            commands: Array<{ command: string }>;
          };
        };
      };
      expect(status.workflow.current).toMatchObject({
        node: "compile-next",
        reason_code: "route.compile.pending-target",
      });
      expect(status.workflow.current.commands[0]?.command).toContain(
        "run compile:file:product-docs:architecture --stage --format json",
      );
      expect(status.alignPhaseResolution.requestedCollections).toEqual(["architecture"]);
      expect(status.compilePhaseResolution).toMatchObject({
        requestedCollections: ["architecture"],
        requestedTargets: [{
          sourceKey: "file:product-docs",
          collections: ["architecture", "decision", "sop"],
          phaseCollection: "architecture",
        }],
      });

      const compile = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--stage",
        "--format",
        "json",
      ])) as {
        result: {
          views: number;
          sections: number;
          candidates: { added: number };
          next_action: {
            kind: string;
            command: string;
          };
        };
      };
      expect(compile.result).toMatchObject({
        views: 3,
        sections: 4,
        candidates: { added: 3 },
        next_action: {
          kind: "reevaluate_workspace_route",
          command: "context status --format json",
        },
      });

      for (const candidateId of ["architecture/entity/install", "decision/entity/install", "sop/action/install-runbook"]) {
        await runCliInDir(projectRoot, ["review", "approve", candidateId, "--all", "--format", "json"]);
      }

      const close = JSON.parse(await runCliInDir(projectRoot, ["close", "--format", "json"])) as {
        nodes: number;
        views: number;
        edgeContract: { valid: boolean };
      };
      expect(close).toMatchObject({ nodes: 2, views: 3, edgeContract: { valid: true } });

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

      const architecturePage = readFileSync(
        join(projectRoot, "dist", "sample-kb", "guides", "architecture", "install", "overview.md"),
        "utf8",
      );
      const decisionPage = readFileSync(
        join(projectRoot, "dist", "sample-kb", "guides", "decision", "install", "choice.md"),
        "utf8",
      );
      const sopPage = readFileSync(
        join(projectRoot, "dist", "sample-kb", "guides", "sop", "install", "runbook.md"),
        "utf8",
      );
      expect(architecturePage).toContain("title: Install Architecture");
      expect(decisionPage).toContain("title: Install Decision");
      expect(sopPage).toContain("title: Install Runbook");
      for (const page of [architecturePage, decisionPage, sopPage]) {
        expect(page).not.toContain("node_ref:");
        expect(page).not.toContain("view_ref:");
        expect(page).not.toContain("resource:");
        expect(page).not.toContain("sources:");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("prose align rejects codegraph and feats collection payloads", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const [sourceRef] = await sourceRefs(projectRoot);
      const manifest = JSON.parse(readFileSync(join(projectRoot, "sources", "file", "product-docs", "manifest.json"), "utf8")) as {
        snapshot_hash: string;
      };

      for (const collection of ["codegraph", "feats"]) {
        const payloadPath = writeYaml(projectRoot, `${collection}-e2e-structure.yaml`, {
          schema_version: "context.structure.v1",
          sources: ["file:product-docs"],
          evidence_snapshot_hash: manifest.snapshot_hash,
          nodes: [{
            node_ref: "entity/install",
            title: "Install",
            node_type: "entity",
            tags: ["module"],
          }],
          views: [{
            view_ref: `${collection}:entity/install`,
            node_ref: "entity/install",
            collection,
            containment: "approved",
            slug: "install",
            title: "Install",
            node_type: "entity",
            path: `${collection}/approved/install.md`,
            sections: [{
              id: "overview",
              section_ref: `${collection}:entity/install#overview`,
              kind: "description",
              source_refs: [sourceRef],
            }],
          }],
          edges: [],
          unresolved: [],
          lifecycle: { state: "draft" },
        });

        const result = JSON.parse(await runCliInDir(projectRoot, [
          "run",
          "align:file:product-docs:architecture",
          "--validate",
          "--input",
          payloadPath,
          "--format",
          "json",
        ])) as {
          result: {
            valid: boolean;
            diagnostics: Array<{ code: string; field?: string; repair?: Record<string, unknown> }>;
            next_action: { reason_code: string; command: string };
          };
        };

        expect(result.result.valid).toBe(false);
        expect(result.result.next_action).toMatchObject({ reason_code: "prose-align-structure-invalid" });
        expect(result.result.next_action.command).toContain("--view read-plan");
        expect(result.result.diagnostics).toContainEqual(expect.objectContaining({
          code: "schema.collection_invalid",
          field: "views[0].collection",
          repair: expect.objectContaining({ action: "choose_document_mainline_collection" }),
        }));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("source drift reports affected collection views and blocks stale candidate apply", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const [sourceRef] = await sourceRefsForRanges(projectRoot, [{ lineStart: 3, lineEnd: 3 }]);
      if (sourceRef === undefined) throw new Error("expected source ref");

      writeApprovedPage({
        projectRoot,
        collection: "architecture",
        type: "Wiki",
        viewRef: "architecture:entity/install",
        nodeRef: "entity/install",
        relPath: "architecture/install/overview.md",
        sourceRef,
      });
      writeApprovedPage({
        projectRoot,
        collection: "product",
        type: "Rule",
        viewRef: "product:entity/install-requirement",
        nodeRef: "entity/install-requirement",
        relPath: "product/install/requirement.md",
        sourceRef,
      });

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
      const actionFile = writeYaml(projectRoot, "stale-candidate-e2e-actions.yaml", {
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

      writeFileSync(join(root, "docs", "guide.md"), [
        "# Guide",
        "",
        "Changed opening paragraph for compile.",
        "",
        "## Install",
        "",
        "- Keep the first install step.",
        "- Preserve the second install step.",
        "",
      ].join("\n"), "utf8");
      await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);

      const verify = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      const result = JSON.parse(verify.stdout) as {
        issues: Array<{ code: string; collection?: string; view_ref?: string; node_ref?: string }>;
      };
      const staleIssues = result.issues.filter((issue) => issue.code === "approved-source-ref-stale");
      expect(staleIssues).toContainEqual(expect.objectContaining({
        collection: "architecture",
        view_ref: "architecture:entity/install",
        node_ref: "entity/install",
      }));
      expect(staleIssues).toContainEqual(expect.objectContaining({
        collection: "product",
        view_ref: "product:entity/install-requirement",
        node_ref: "entity/install-requirement",
      }));

      const status = await invokeCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"]);
      expect(status.status).toBe(0);
      const statusJson = JSON.parse(status.stdout) as {
        state: string;
        diagnostics: string[];
        compileBatch: { staleViewRefs: string[]; staleSourceKeys: string[] };
      };
      expect(statusJson.state).toBe("route.verify.failed");
      expect(statusJson.compileBatch.staleViewRefs).toContain("architecture:entity/install");
      expect(statusJson.compileBatch.staleSourceKeys).toContain("file:product-docs");
      expect(statusJson.diagnostics.join("\n")).toContain("collection=architecture view_ref=architecture:entity/install");
      expect(statusJson.diagnostics.join("\n")).toContain("collection=product view_ref=product:entity/install-requirement");

      const staleApply = await invokeCliInDir(projectRoot, [
        "review",
        "approve",
        "architecture/entity/install",
        "--collection",
        "architecture",
        "--format",
        "json",
      ]);
      expect(staleApply.status).not.toBe(0);
      expect(staleApply.stderr).toContain("review is blocked because prose candidates target an older source snapshot");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
