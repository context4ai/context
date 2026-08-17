import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentSourceSpan, formatCanonicalProseSourceRef } from "@c4a/extract";
import YAML from "yaml";
import { createCliProgram, handleCliFailure } from "../cli.js";
import { initContextProject } from "../project/workspace.js";

async function runCliInDir(dir: string, args: string[]): Promise<string> {
  const originalCwd = process.cwd();
  const originalStdoutWrite = process.stdout.write;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  process.chdir(dir);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await createCliProgram().parseAsync(["node", "context", ...args]);
    return stdoutChunks.join("");
  } catch (error) {
    const status = handleCliFailure(error, {
      stderr: {
        write: ((chunk: string | Uint8Array) => {
          stderrChunks.push(String(chunk));
          return true;
        }) as typeof process.stderr.write,
      },
      exit: (code) => code,
    });
    throw new Error(`CLI exited ${status}: ${stderrChunks.join("") || stdoutChunks.join("")}`);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.chdir(originalCwd);
  }
}

async function createProject(): Promise<{ projectRoot: string; docsDir: string }> {
  const root = mkdtempSync(join(tmpdir(), "ctx-align-orphan-v069-"));
  const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
  const projectRoot = result.projectRoot;
  const docsDir = join(projectRoot, "..", "docs");
  await mkdir(docsDir, { recursive: true });
  writeFileSync(join(docsDir, "guide.md"), [
    "# Guide",
    "",
    "Install the package before configuring it.",
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(projectRoot, "src", "index.ts"), [
    'import { alignProse, captureFile, defineProject, source } from "@c4a/context";',
    'const docs = source("product-docs");',
    "export default defineProject({",
    "  sources: [docs],",
    "  phases: [captureFile({ source: docs }), alignProse({ source: docs, collection: \"standards\" })],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
  await runCliInDir(projectRoot, ["source", "add", "file", "product-docs", "--local", docsDir, "--format", "json"]);
  await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);
  return { projectRoot, docsDir };
}

function snapshotHash(projectRoot: string): string {
  return String((JSON.parse(readFileSync(join(projectRoot, "sources", "file", "product-docs", "manifest.json"), "utf8")) as { snapshot_hash: string }).snapshot_hash);
}

function sourceRefForLine(projectRoot: string, line: number): string {
  const markdown = readFileSync(join(projectRoot, "..", "docs", "guide.md"), "utf8");
  return formatCanonicalProseSourceRef({
    sourceType: "file",
    sourceName: "product-docs",
    documentPath: "guide.md",
    span: createDocumentSourceSpan(markdown, { lineStart: line, lineEnd: line }),
  });
}

function writePayload(projectRoot: string, name: string, payload: Record<string, unknown>): string {
  const path = join(projectRoot, name);
  writeFileSync(path, `${YAML.stringify({ evidence_snapshot_hash: snapshotHash(projectRoot), ...payload })}\n`, "utf8");
  return path;
}

function writeApprovedEntityInstall(projectRoot: string, sourceRef: string): void {
  mkdirSync(join(projectRoot, "knowledge", "architecture", "approved"), { recursive: true });
  writeFileSync(join(projectRoot, "knowledge", "architecture", "approved", "install.md"), [
    "---",
    "title: Approved Install",
    "type: Guide",
    "description: Approved install page.",
    "tags:",
    "  - module",
    "timestamp: 2026-06-24T12:00:00Z",
    "resource: file:product-docs/guide.md",
    "sources:",
    "  - file:product-docs/guide.md",
    "node_ref: entity/install",
    "view_ref: architecture:entity/install",
    "node_type: entity",
    "---",
    "",
    `<!-- context:section id="overview" kind="description" source_ref="${sourceRef}" content_mode="verbatim" -->`,
    "Install the package before configuring it.",
    "<!-- /context:section -->",
    "",
  ].join("\n"), "utf8");
}

describe("0.6.9 prose align orphan gate", () => {
  test("allows confirmed independent collection-root views without edges", async () => {
    const { projectRoot } = await createProject();
    const sourceRef = sourceRefForLine(projectRoot, 3);

    const payload = {
      schema_version: "context.structure.v1",
      sources: ["file:product-docs"],
      nodes: [{
        node_ref: "entity/install",
        title: "Install",
        node_type: "entity",
        tags: ["module"],
      }],
      views: [{
        view_ref: "standards:entity/install",
        node_ref: "entity/install",
        collection: "standards",
        containment: "approved",
        slug: "install",
        title: "Install",
        node_type: "entity",
        path: "standards/approved/install.md",
        sections: [{
          id: "overview",
          section_ref: "standards:entity/install#overview",
          kind: "description",
          source_refs: [sourceRef],
        }],
      }],
      edges: [],
      unresolved: [],
      lifecycle: { state: "draft" },
    };

    const draftPath = writePayload(projectRoot, "independent-draft.yaml", payload);
    const draft = JSON.parse(await runCliInDir(projectRoot, [
      "run",
      "align:file:product-docs:standards",
      "--validate",
      "--input",
      draftPath,
      "--format",
      "json",
    ])) as { result: { valid: boolean; structure_digest: string; diagnostics: Array<{ code: string }> } };
    expect(draft.result.valid).toBe(true);
    expect(draft.result.diagnostics.map((item) => item.code)).not.toContain("view.orphan_risk");

    const confirmedPath = writePayload(projectRoot, "independent-confirmed.yaml", {
      ...payload,
      lifecycle: {
        state: "confirmed",
        confirmed_by: "human",
        confirmed_at: "2026-06-24T12:00:00Z",
        structure_digest: draft.result.structure_digest,
      },
    });
    const confirmed = JSON.parse(await runCliInDir(projectRoot, [
      "run",
      "align:file:product-docs:standards",
      "--validate",
      "--input",
      confirmedPath,
      "--format",
      "json",
    ])) as { result: { valid: boolean; diagnostics: Array<{ code: string }> } };
    expect(confirmed.result.valid).toBe(true);
    expect(confirmed.result.diagnostics.map((item) => item.code)).not.toContain("view.orphan_risk");
  });

  test("rejects codegraph and feats as prose align view collections with repair guidance", async () => {
    const { projectRoot } = await createProject();
    const sourceRef = sourceRefForLine(projectRoot, 3);

    for (const collection of ["codegraph", "feats"]) {
      const payloadPath = writePayload(projectRoot, `${collection}-collection.yaml`, {
        schema_version: "context.structure.v1",
        sources: ["file:product-docs"],
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
        "align:file:product-docs:standards",
        "--validate",
        "--input",
        payloadPath,
        "--format",
        "json",
      ])) as {
        result: {
          valid: boolean;
          diagnostics: Array<{
            code: string;
            field?: string;
            repair?: Record<string, unknown>;
          }>;
          next_action: { kind: string; reason_code: string; command: string };
        };
      };

      expect(result.result.valid).toBe(false);
      expect(result.result.next_action).toMatchObject({
        kind: "repair_payload",
        reason_code: "prose-align-structure-invalid",
      });
      expect(result.result.next_action.command).toContain("--view read-plan");
      expect(result.result.diagnostics).toContainEqual(expect.objectContaining({
        code: "schema.collection_invalid",
        field: "views[0].collection",
        repair: expect.objectContaining({
          action: "choose_document_mainline_collection",
        }),
      }));
    }
  });

  test("allows a new collection ViewRef to reuse an approved NodeRef when identity matches", async () => {
    const { projectRoot } = await createProject();
    const sourceRef = sourceRefForLine(projectRoot, 3);
    writeApprovedEntityInstall(projectRoot, sourceRef);

    const payload = {
      schema_version: "context.structure.v1",
      sources: ["file:product-docs"],
      nodes: [{
        node_ref: "entity/install",
        title: "Approved Install",
        node_type: "entity",
        tags: ["module"],
      }],
      views: [{
        view_ref: "standards:entity/install",
        node_ref: "entity/install",
        collection: "standards",
        containment: "approved",
        slug: "install-standard",
        title: "Install Standard",
        node_type: "entity",
        path: "standards/approved/install-standard.md",
        sections: [{
          id: "overview",
          section_ref: "standards:entity/install#overview",
          kind: "description",
          source_refs: [sourceRef],
        }],
      }],
      edges: [],
      unresolved: [],
      lifecycle: { state: "draft" },
    };

    const draftPath = writePayload(projectRoot, "draft.yaml", payload);
    const draft = JSON.parse(await runCliInDir(projectRoot, [
      "run",
      "align:file:product-docs:standards",
      "--validate",
      "--input",
      draftPath,
      "--format",
      "json",
    ])) as { result: { valid: boolean; structure_digest: string; diagnostics: Array<{ code: string; severity: string; candidate_id?: string }> } };
    expect(draft.result.valid).toBe(true);
    expect(draft.result.diagnostics.map((item) => item.code)).not.toContain("view.orphan_risk");

    const confirmedPath = writePayload(projectRoot, "confirmed.yaml", {
      ...payload,
      lifecycle: {
        state: "confirmed",
        confirmed_by: "human",
        confirmed_at: "2026-06-24T12:00:00Z",
        structure_digest: draft.result.structure_digest,
      },
    });
    const confirmed = JSON.parse(await runCliInDir(projectRoot, [
      "run",
      "align:file:product-docs:standards",
      "--validate",
      "--input",
      confirmedPath,
      "--format",
      "json",
    ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string; candidate_id?: string }> } };
    expect(confirmed.result.valid).toBe(true);
    expect(confirmed.result.diagnostics.map((item) => item.code)).not.toContain("view.orphan_risk");
  });

  test("warns when an approved NodeRef is reused with changed display title", async () => {
    const { projectRoot } = await createProject();
    const sourceRef = sourceRefForLine(projectRoot, 3);
    writeApprovedEntityInstall(projectRoot, sourceRef);

    const payloadPath = writePayload(projectRoot, "identity-mismatch.yaml", {
      schema_version: "context.structure.v1",
      sources: ["file:product-docs"],
      nodes: [{
        node_ref: "entity/install",
        title: "Different Install",
        node_type: "entity",
        tags: ["module"],
      }],
      views: [{
        view_ref: "standards:entity/install",
        node_ref: "entity/install",
        collection: "standards",
        containment: "approved",
        slug: "install-standard",
        title: "Install Standard",
        node_type: "entity",
        path: "standards/approved/install-standard.md",
        sections: [{
          id: "overview",
          section_ref: "standards:entity/install#overview",
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
      "align:file:product-docs:standards",
      "--validate",
      "--input",
      payloadPath,
      "--format",
      "json",
    ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string; candidate_id?: string }> } };
    expect(result.result.valid).toBe(true);
    expect(result.result.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "existing_approved.node_title_mismatch",
      candidate_id: "entity/install",
    }));
  });

  test("rejects an approved NodeRef reused with changed node type identity", async () => {
    const { projectRoot } = await createProject();
    const sourceRef = sourceRefForLine(projectRoot, 3);
    writeApprovedEntityInstall(projectRoot, sourceRef);
    const approvedPath = join(projectRoot, "knowledge", "architecture", "approved", "install.md");
    const approved = readFileSync(approvedPath, "utf8");
    writeFileSync(approvedPath, approved.replace("node_type: entity", "node_type: action"), "utf8");

    const payloadPath = writePayload(projectRoot, "identity-type-mismatch.yaml", {
      schema_version: "context.structure.v1",
      sources: ["file:product-docs"],
      nodes: [{
        node_ref: "entity/install",
        title: "Approved Install",
        node_type: "entity",
        tags: ["module"],
      }],
      views: [{
        view_ref: "standards:entity/install",
        node_ref: "entity/install",
        collection: "standards",
        containment: "approved",
        slug: "install-standard",
        title: "Install Standard",
        node_type: "entity",
        path: "standards/approved/install-standard.md",
        sections: [{
          id: "overview",
          section_ref: "standards:entity/install#overview",
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
      "align:file:product-docs:standards",
      "--validate",
      "--input",
      payloadPath,
      "--format",
      "json",
    ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string; candidate_id?: string }> } };
    expect(result.result.valid).toBe(false);
    expect(result.result.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "existing_approved.node_identity_mismatch",
      candidate_id: "entity/install",
    }));
  });
});
