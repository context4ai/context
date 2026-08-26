import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { writeApprovedStructureProjection } from "../project/close.js";
import { validateStructureEdgeContract } from "../project/structureEdgeContract.js";
import {
  createCapturedCompileProject,
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  sourceRefs,
  stageConfirmedRichStructure,
  stageConfirmedStructure,
  writeJsonl,
  writeYaml,
} from "./projectCompileProseV066Helpers.js";

interface VerifyJson {
  issues: Array<{ code: string; message: string }>;
}

function cloneYaml<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function viewByRef(
  structure: { views: Array<{ view_ref: string; collection?: string; path?: string; node_type?: string; tags?: string[]; sources?: string[]; sections?: Array<Record<string, unknown>> }> },
  viewRef: string,
): { view_ref: string; collection?: string; path?: string; node_type?: string; tags?: string[]; sources?: string[]; sections?: Array<Record<string, unknown>> } {
  const view = structure.views.find((item) => item.view_ref === viewRef);
  if (view === undefined) throw new Error(`missing view fixture: ${viewRef}`);
  return view;
}

describe("0.6.6 close structure projection verification", () => {
  test("close projects current source-backed code relationships and removes stale ones", async () => {
    const root = makeTmp();
    try {
      const projectRoot = join(root, "project");
      const knowledgeRoot = join(projectRoot, "knowledge", "codegraph", "sample", "symbol");
      mkdirSync(knowledgeRoot, { recursive: true });
      const page = (input: { name: string; edge?: boolean }): string => [
        "---",
        `title: ${input.name}`,
        `node_ref: sample/symbol/${input.name.toLowerCase()}`,
        `view_ref: codegraph:sample/symbol/${input.name.toLowerCase()}`,
        "node_type: entity",
        "relationship_mode: source-backed-ast",
        "sources:",
        "  - repo:20260809/sample",
        "visibility: exported",
        "code_symbols:",
        `  - sample|${input.name.toLowerCase()}|function`,
        "candidate_fingerprint: fixture-fingerprint",
        "context_optimization:",
        "  enabled: true",
        "  sections:",
        "    overview:",
        "      policy_digest: policy-a",
        "    details:",
        "      policy_digest: policy-a",
        ...(input.edge ? [
          "code_edges:",
          "  - type: depends_on",
          "    from: sample/symbol/render",
          "    to: sample/symbol/format",
          "    source_refs:",
          "      - repo:20260809/sample#symbol:src/index.ts:render:function@abcdef123456",
          "    relationship_mode: source-backed-ast",
          "    relation_type: calls",
          '    note: "AST relation: calls"',
        ] : ["code_edges: []"]),
        "---",
        "",
        `# ${input.name}`,
        "",
      ].join("\n");
      writeFileSync(join(knowledgeRoot, "render.md"), page({ name: "Render", edge: true }), "utf8");
      writeFileSync(join(knowledgeRoot, "format.md"), page({ name: "Format" }), "utf8");

      await writeApprovedStructureProjection(projectRoot);

      const structurePath = join(projectRoot, "knowledge", "structure.yaml");
      const first = YAML.parse(readFileSync(structurePath, "utf8")) as {
        edges: Array<{ type: string; from: string; to: string }>;
        views: Array<{ view_ref: string; machine?: Record<string, unknown> }>;
        relationship_coverage?: unknown;
      };
      expect(first.edges).toEqual([expect.objectContaining({
        type: "depends_on",
        from: "sample/symbol/render",
        to: "sample/symbol/format",
      })]);
      expect(first.relationship_coverage).toBeUndefined();
      const compactPage = readFileSync(join(knowledgeRoot, "render.md"), "utf8");
      expect(compactPage).not.toContain("code_symbols:");
      expect(compactPage).not.toContain("candidate_fingerprint:");
      expect(compactPage).not.toContain("context_optimization:");
      const machine = first.views.find((view) => view.view_ref.endsWith("/render"))?.machine;
      expect(machine).toMatchObject({
        candidate_fingerprint: "fixture-fingerprint",
        code_symbol_table: { module: "sample", entries: ["render|function"] },
        context_optimization: { policy_digest: "policy-a" },
      });

      writeFileSync(join(knowledgeRoot, "render.md"), page({ name: "Render" }), "utf8");
      await writeApprovedStructureProjection(projectRoot);
      const second = YAML.parse(readFileSync(structurePath, "utf8")) as {
        edges: unknown[];
        relationship_coverage?: unknown;
      };
      expect(second.edges).toEqual([]);
      expect(second.relationship_coverage).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("approved structure projection keeps non-wikis ViewRef and SectionRef endpoints", async () => {
    const root = makeTmp();
    try {
      const projectRoot = join(root, "project");
      mkdirSync(join(projectRoot, "knowledge", "sop", "entity"), { recursive: true });
      writeFileSync(join(projectRoot, "knowledge", "sop", "entity", "install.md"), [
        "---",
        "title: Install",
        "node_ref: entity/install",
        "view_ref: sop:entity/install",
        "node_type: entity",
        "node_tags:",
        "  - module",
        "tags:",
        "  - docs",
        "  - prose",
        "---",
        "",
        "# Install",
        "",
        '<!-- context:section id="overview" kind="description" -->',
        "Install overview.",
        "<!-- /context:section -->",
        "",
      ].join("\n"), "utf8");
      writeFileSync(join(projectRoot, "knowledge", "sop", "entity", "configure.md"), [
        "---",
        "title: Configure",
        "node_ref: entity/configure",
        "view_ref: sop:entity/configure",
        "node_type: entity",
        "node_tags:",
        "  - module",
        "tags:",
        "  - docs",
        "  - prose",
        "---",
        "",
        "# Configure",
        "",
      ].join("\n"), "utf8");
      writeFileSync(join(projectRoot, "knowledge", "structure.yaml"), YAML.stringify({
        schema_version: "context.approved-structure.v1",
        edges: [{
          type: "prerequisite",
          from: "sop:entity/install#overview",
          to: "sop:entity/configure",
          source_refs: ["file:docs/setup.md#span:<approved-edge-evidence>"],
        }],
      }), "utf8");

      await writeApprovedStructureProjection(projectRoot);

      const approved = YAML.parse(readFileSync(join(projectRoot, "knowledge", "structure.yaml"), "utf8")) as {
        input_hash: string;
        nodes: Array<{ node_ref: string }>;
        views: Array<{ view_ref: string }>;
        edges: Array<{ type: string; from: string; to: string; source_refs: string[] }>;
      };
      expect(approved.input_hash).toMatch(/^sha256:/u);
      expect(approved.nodes.map((node) => node.node_ref).sort()).toEqual(["entity/configure", "entity/install"]);
      expect(approved.views.map((view) => view.view_ref).sort()).toEqual(["sop:entity/configure", "sop:entity/install"]);
      expect(approved.edges).toEqual([{
        type: "prerequisite",
        from: "sop:entity/install#overview",
        to: "sop:entity/configure",
        source_refs: ["file:docs/setup.md#span:<approved-edge-evidence>"],
      }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("edge contract accepts NodeRef, ViewRef, and SectionRef endpoints", () => {
    const contract = validateStructureEdgeContract({
      nodes: [{ node_ref: "entity/install" }],
      views: [{
        view_ref: "sop:entity/install",
        sections: [{ section_ref: "sop:entity/install#overview" }],
      }],
      edges: [{
        type: "depends_on",
        from: "sop:entity/install#overview",
        to: "entity/install",
        source_refs: ["file:docs/setup.md#span:overview L1-1@abcdef123456"],
      }],
    });
    expect(contract.valid).toBe(true);

    const invalid = validateStructureEdgeContract({
      nodes: [{ node_ref: "entity/install" }],
      views: [{ view_ref: "sop:entity/install", sections: [] }],
      edges: [{
        type: "depends_on",
        from: "sop:entity/install#missing",
        to: "entity/install",
        source_refs: ["file:docs/setup.md#span:overview L1-1@abcdef123456"],
      }],
    });
    expect(invalid.valid).toBe(false);
  });

  test("verify rejects ready approved structures with missing or drifted node projection", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedStructure(projectRoot, [refs[0]!]);
      for (const node of [
        { id: "entity/install", section: "install" },
        { id: "entity/configure", section: "configure" },
      ]) {
        const actionFile = writeYaml(projectRoot, `${node.section}-structure-projection-actions.yaml`, {
          schema_version: "context.compile-actions.v1",
          view_ref: `architecture:${node.id}`,
          actions: [{
            op: "add",
            section_id: node.section,
            kind: "description",
            summary: `${node.section} source span`,
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
      const payload = writeJsonl(projectRoot, "review-structure-projection.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);

      const structurePath = join(projectRoot, "knowledge", "structure.yaml");
      const original = YAML.parse(readFileSync(structurePath, "utf8")) as {
        nodes: Array<Record<string, unknown> & { node_ref?: string; title?: string; node_type?: string; tags?: string[] }>;
        views: Array<{ view_ref: string; path?: string; node_type?: string; tags?: string[] }>;
      };

      const oldShape = cloneYaml(original) as Record<string, unknown>;
      delete oldShape.input_hash;
      writeFileSync(structurePath, YAML.stringify(oldShape), "utf8");
      const oldShapeVerify = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(oldShapeVerify.status).not.toBe(0);
      expect(oldShapeVerify.stdout).toContain("approved-structure-input-hash-invalid");

      const missingNodeProjection = cloneYaml(original);
      missingNodeProjection.nodes = [];
      writeFileSync(structurePath, YAML.stringify(missingNodeProjection), "utf8");
      const missingNodeVerify = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(missingNodeVerify.status).not.toBe(0);
      expect((JSON.parse(missingNodeVerify.stdout) as VerifyJson).issues.map((issue) => issue.code))
        .toContain("approved-structure-node-missing");

      const malformedNodeProjection = cloneYaml(original);
      malformedNodeProjection.nodes[0] = { title: "Missing Node Ref", node_type: "entity" };
      writeFileSync(structurePath, YAML.stringify(malformedNodeProjection), "utf8");
      const malformedNodeVerify = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(malformedNodeVerify.status).not.toBe(0);
      expect((JSON.parse(malformedNodeVerify.stdout) as VerifyJson).issues.map((issue) => issue.code))
        .toContain("approved-structure-node-invalid");

      const wrongNodeTitle = cloneYaml(original);
      wrongNodeTitle.nodes.find((node) => node.node_ref === "entity/install")!.title = "Wrong title";
      writeFileSync(structurePath, YAML.stringify(wrongNodeTitle), "utf8");
      const nodeTitleMismatch = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(nodeTitleMismatch.status).not.toBe(0);
      expect((JSON.parse(nodeTitleMismatch.stdout) as VerifyJson).issues.map((issue) => issue.message).join("\n"))
        .toContain("node entity/install title must be Install");

      const wrongNodeTags = cloneYaml(original);
      wrongNodeTags.nodes.find((node) => node.node_ref === "entity/install")!.tags = ["wrong"];
      writeFileSync(structurePath, YAML.stringify(wrongNodeTags), "utf8");
      const nodeTagsMismatch = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(nodeTagsMismatch.status).not.toBe(0);
      expect((JSON.parse(nodeTagsMismatch.stdout) as VerifyJson).issues.map((issue) => issue.message).join("\n"))
        .toContain("node entity/install tags must match approved Markdown frontmatter");

      const missingNode = cloneYaml(original);
      missingNode.views = missingNode.views.filter((view) => view.view_ref !== "architecture:entity/configure");
      writeFileSync(structurePath, YAML.stringify(missingNode), "utf8");
      const missing = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(missing.status).not.toBe(0);
      expect((JSON.parse(missing.stdout) as VerifyJson).issues.map((issue) => issue.code))
        .toContain("approved-structure-node-missing");

      const wrongPath = cloneYaml(original);
      viewByRef(wrongPath, "architecture:entity/install").path = "architecture/entity/wrong.md";
      writeFileSync(structurePath, YAML.stringify(wrongPath), "utf8");
      const pathMismatch = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(pathMismatch.status).not.toBe(0);
      expect((JSON.parse(pathMismatch.stdout) as VerifyJson).issues.map((issue) => issue.message).join("\n"))
        .toContain("path must be architecture/install/overview.md");

      const wrongType = cloneYaml(original);
      viewByRef(wrongType, "architecture:entity/install").node_type = "domain";
      writeFileSync(structurePath, YAML.stringify(wrongType), "utf8");
      const typeMismatch = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(typeMismatch.status).not.toBe(0);
      expect((JSON.parse(typeMismatch.stdout) as VerifyJson).issues.map((issue) => issue.message).join("\n"))
        .toContain("node_type must be entity");

      const wrongTags = cloneYaml(original);
      viewByRef(wrongTags, "architecture:entity/install").tags = ["wrong"];
      writeFileSync(structurePath, YAML.stringify(wrongTags), "utf8");
      const tagsMismatch = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(tagsMismatch.status).not.toBe(0);
      expect((JSON.parse(tagsMismatch.stdout) as VerifyJson).issues.map((issue) => issue.message).join("\n"))
        .toContain("tags must match approved Markdown frontmatter");

      const wrongCollection = cloneYaml(original);
      viewByRef(wrongCollection, "architecture:entity/install").collection = "product";
      writeFileSync(structurePath, YAML.stringify(wrongCollection), "utf8");
      const collectionMismatch = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(collectionMismatch.status).not.toBe(0);
      expect((JSON.parse(collectionMismatch.stdout) as VerifyJson).issues.map((issue) => issue.message).join("\n"))
        .toContain("collection must be architecture");

      const wrongSources = cloneYaml(original);
      viewByRef(wrongSources, "architecture:entity/install").sources = ["file:other/index.md"];
      writeFileSync(structurePath, YAML.stringify(wrongSources), "utf8");
      const sourcesMismatch = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(sourcesMismatch.status).not.toBe(0);
      expect((JSON.parse(sourcesMismatch.stdout) as VerifyJson).issues.map((issue) => issue.message).join("\n"))
        .toContain("sources must match approved Markdown frontmatter");

      const missingSections = cloneYaml(original);
      viewByRef(missingSections, "architecture:entity/install").sections = [];
      writeFileSync(structurePath, YAML.stringify(missingSections), "utf8");
      const sectionMismatch = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(sectionMismatch.status).not.toBe(0);
      expect((JSON.parse(sectionMismatch.stdout) as VerifyJson).issues.map((issue) => issue.code))
        .toContain("approved-structure-view-section-projection-mismatch");

      const wrongSectionKind = cloneYaml(original);
      viewByRef(wrongSectionKind, "architecture:entity/install").sections![0]!.kind = "usage";
      writeFileSync(structurePath, YAML.stringify(wrongSectionKind), "utf8");
      const sectionKindMismatch = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(sectionKindMismatch.status).not.toBe(0);
      expect((JSON.parse(sectionKindMismatch.stdout) as VerifyJson).issues.map((issue) => issue.code))
        .toContain("approved-structure-view-section-projection-mismatch");

      const wrongSectionSourceRef = cloneYaml(original);
      viewByRef(wrongSectionSourceRef, "architecture:entity/install").sections![0]!.source_refs = ["file:product-docs/index.md#span:wrong L1-1@deadbeef"];
      writeFileSync(structurePath, YAML.stringify(wrongSectionSourceRef), "utf8");
      const sectionSourceMismatch = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(sectionSourceMismatch.status).not.toBe(0);
      expect((JSON.parse(sectionSourceMismatch.stdout) as VerifyJson).issues.map((issue) => issue.code))
        .toContain("approved-structure-view-section-projection-mismatch");

      const malformedSections = cloneYaml(original);
      viewByRef(malformedSections, "architecture:entity/install").sections = [{}];
      writeFileSync(structurePath, YAML.stringify(malformedSections), "utf8");
      const malformedSection = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(malformedSection.status).not.toBe(0);
      expect((JSON.parse(malformedSection.stdout) as VerifyJson).issues.map((issue) => issue.code))
        .toContain("approved-structure-view-section-invalid");

      writeFileSync(structurePath, YAML.stringify(original), "utf8");
      const approvedPagePath = join(projectRoot, "knowledge", "architecture", "install", "overview.md");
      const approvedPage = readFileSync(approvedPagePath, "utf8");
      writeFileSync(approvedPagePath, approvedPage.replace(/^node_type: entity\r?\n/mu, ""), "utf8");
      const missingNodeType = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(missingNodeType.status).not.toBe(0);
      expect(missingNodeType.stdout).toContain("approved-frontmatter-node-type-invalid");
      const closeMissingNodeType = await invokeCliInDir(projectRoot, ["close", "--format", "json"]);
      expect(closeMissingNodeType.status).not.toBe(0);
      expect(`${closeMissingNodeType.stdout}\n${closeMissingNodeType.stderr}`).toContain("node_type");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);

  test("close rebuilds a stale ready structure projection instead of being blocked by it", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedStructure(projectRoot, [refs[0]!]);
      for (const node of [
        { id: "entity/install", section: "install" },
        { id: "entity/configure", section: "configure" },
      ]) {
        const actionFile = writeYaml(projectRoot, `${node.section}-close-rebuild-actions.yaml`, {
          schema_version: "context.compile-actions.v1",
          view_ref: `architecture:${node.id}`,
          actions: [{
            op: "add",
            section_id: node.section,
            kind: "description",
            summary: `${node.section} source span`,
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
      const payload = writeJsonl(projectRoot, "review-close-rebuild.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);

      const structurePath = join(projectRoot, "knowledge", "structure.yaml");
      const broken = YAML.parse(readFileSync(structurePath, "utf8")) as {
        views: Array<{ view_ref: string; path?: string; node_type?: string; tags?: string[] }>;
      };
      viewByRef(broken, "architecture:entity/install").path = "architecture/entity/wrong.md";
      writeFileSync(structurePath, YAML.stringify(broken), "utf8");
      const verifyBroken = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(verifyBroken.status).not.toBe(0);
      expect(verifyBroken.stdout).toContain("approved-structure-node-projection-mismatch");
      const brokenStatus = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        next: string;
      };
      expect(brokenStatus.state).toBe("route.close.projection-stale");
      expect(brokenStatus.next).toContain("--workflow-revision");
      expect(brokenStatus.next).toContain("close --format json");
      expect(brokenStatus.next).not.toContain("review/knowledge gate");

      await runCliInDir(projectRoot, ["close", "--format", "json"]);
      const rebuilt = YAML.parse(readFileSync(structurePath, "utf8")) as {
        views: Array<{ view_ref: string; path?: string }>;
      };
      expect(viewByRef(rebuilt, "architecture:entity/install").path).toBe("architecture/install/overview.md");
      const verifyRebuilt = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(verifyRebuilt.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("close rebuilds invalid approved structure yaml and reports dropped edges", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedRichStructure(projectRoot, refs);
      const actionFile = writeYaml(projectRoot, "invalid-structure-yaml-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-1",
          kind: "description",
          summary: "Install source span",
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
      const payload = writeJsonl(projectRoot, "review-invalid-structure-yaml.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);

      const structurePath = join(projectRoot, "knowledge", "structure.yaml");
      writeFileSync(structurePath, "schema_version: [", "utf8");
      const brokenStatus = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        next: string;
      };
      expect(brokenStatus.state).toBe("route.close.projection-stale");
      expect(brokenStatus.next).toContain("--workflow-revision");
      expect(brokenStatus.next).toContain("close --format json");

      const close = JSON.parse(await runCliInDir(projectRoot, ["close", "--format", "json"])) as {
        edgeWarnings: string[];
      };
      expect(close.edgeWarnings.join("\n")).toContain("Dropped existing approved edges");
      expect(close.edgeWarnings.join("\n")).toContain("knowledge/structure.yaml");
      const rebuilt = YAML.parse(readFileSync(structurePath, "utf8")) as {
        views: Array<{ view_ref: string; path?: string }>;
        edges: unknown[];
      };
      expect(viewByRef(rebuilt, "architecture:entity/install").path).toBe("architecture/install/overview.md");
      expect(rebuilt.edges).toEqual([]);
      const verifyRebuilt = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(verifyRebuilt.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("close rejects existing approved edges whose endpoints are no longer approved", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedRichStructure(projectRoot, refs);
      const actionFile = writeYaml(projectRoot, "missing-edge-endpoint-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-1",
          kind: "description",
          summary: "Install source span",
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
      const payload = writeJsonl(projectRoot, "review-missing-edge-endpoint.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);

      const structurePath = join(projectRoot, "knowledge", "structure.yaml");
      const structure = YAML.parse(readFileSync(structurePath, "utf8")) as Record<string, unknown>;
      writeFileSync(structurePath, YAML.stringify({
        ...structure,
        edges: [{
          type: "depends_on",
          from: "entity/install",
          to: "entity/missing",
          source_refs: ["file:unmanaged-docs/guide.md#span:missing L1-1@abcdef123456"],
        }],
      }), "utf8");
      rmSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), { force: true });

      const close = await invokeCliInDir(projectRoot, ["close", "--format", "json"]);
      expect(close.status).not.toBe(0);
      expect(close.stderr).toContain("structure edge endpoint is not present");
      const unchanged = YAML.parse(readFileSync(structurePath, "utf8")) as { edges: Array<{ to: string }> };
      expect(unchanged.edges[0]?.to).toBe("entity/missing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
