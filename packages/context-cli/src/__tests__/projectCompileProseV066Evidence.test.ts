import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import type { AlignPayload } from "../project/proseAlignTypes.js";
import { writeStructureSnapshot } from "../project/proseStructureStore.js";
import {
  createCapturedCompileProject,
  extractSectionBodyList,
  extractSectionBodies,
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  sourceRefs,
  stageConfirmedStructure,
  stageConfirmedRichStructure,
  writeJsonl,
  writeYaml,
} from "./projectCompileProseV066Helpers.js";

function corruptSpanHash(ref: string): string {
  return ref.replace(/@[a-f0-9]+$/iu, "@000000000000");
}

function readDraftRecord(projectRoot: string, candidateId: string): Record<string, unknown> {
  return readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((record) => record.candidate_id === candidateId) ?? {};
}

describe("0.6.6 compileProse evidence gates", () => {
  test("review apply blocks prose-align drafts when the source snapshot changes after compile", async () => {
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
      ])) as { result: { node_context: { planned_sections: Array<{ local_source_refs: string[] }> } } };
      const actionFile = writeYaml(projectRoot, "stale-actions.yaml", {
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

      writeFileSync(join(projectRoot, "..", "docs", "guide.md"), [
        "# Guide",
        "",
        "Alpha opening paragraph for compile.",
        "",
        "Post compile source change.",
        "",
      ].join("\n"), "utf8");
      await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);

      const reviewHtml = await invokeCliInDir(projectRoot, ["review", "html", "architecture", "--format", "json"]);
      expect(reviewHtml.status).not.toBe(0);
      expect(reviewHtml.stderr).toContain("review is blocked because prose candidates target an older source snapshot");
      expect(reviewHtml.stderr).toContain("file:product-docs");

      const payload = writeJsonl(projectRoot, "stale-review.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      const blocked = await invokeCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      expect(blocked.status).not.toBe(0);
      expect(blocked.stderr).toContain("review is blocked because prose candidates target an older source snapshot");
      expect(blocked.stderr).toContain("context status --format json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("verbatim compile preserves source lists, tables, commands, and code blocks", async () => {
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
      ])) as { result: { node_context: { planned_sections: Array<{ local_source_refs: string[] }> } } };
      const localRefs = context.result.node_context.planned_sections.map((section) => section.local_source_refs[0]!);
      const pagedSpanDetail = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "span-detail",
        "--source",
        "guide.md",
        "--range",
        "L1-4",
        "--page-size",
        "1",
        "--format",
        "json",
      ])) as {
        result: {
          span_detail: { has_more: boolean; next_command?: string };
          next_action: { command?: string };
        };
      };
      expect(pagedSpanDetail.result.span_detail.has_more).toBe(true);
      expect(pagedSpanDetail.result.span_detail.next_command).toContain("--view span-detail");
      expect(pagedSpanDetail.result.next_action.command).toContain("--view span-detail");
      for (const [index, expected] of [
        "- Keep the first install step.",
        "| runtime | edge |",
        "Run the command:",
        "```bash",
      ].entries()) {
        const spanDetail = JSON.parse(await runCliInDir(projectRoot, [
          "run",
          "align:file:product-docs:architecture",
          "--view",
          "span-detail",
          "--span",
          refs[index]!,
          "--format",
          "json",
        ])) as { result: { span_detail: { text: string } } };
        expect(spanDetail.result.span_detail.text).toContain(expected);
      }

      const actionFile = writeYaml(projectRoot, "verbatim-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: localRefs.map((sourceRef, index) => ({
          op: "add",
          section_id: `install-${index + 1}`,
          kind: index === 2 ? "example" : "description",
          summary: `Verbatim source span ${index + 1}`,
          source_refs: [sourceRef],
        })),
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

      const payload = writeJsonl(projectRoot, "review-verbatim.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      const approved = readFileSync(join(projectRoot, "knowledge", "architecture", "install", "overview.md"), "utf8");
      const body = extractSectionBodies(approved);
      const sectionBodies = extractSectionBodyList(approved);
      expect(approved).toContain('content_mode="verbatim"');
      expect(approved).not.toContain("context:audit");
      expect(approved).not.toContain("rewritten_confirmed");
      expect(approved).not.toContain("<!-- context:source_refs");
      expect(approved).not.toContain(" source_refs=");
      expect(approved).not.toContain("content_source_digest");
      const expectedBodies: string[] = [];
      for (const sourceRef of refs.slice(0, localRefs.length)) {
        const spanDetail = JSON.parse(await runCliInDir(projectRoot, [
          "run",
          "align:file:product-docs:architecture",
          "--view",
          "span-detail",
          "--span",
          sourceRef,
          "--format",
          "json",
        ])) as { result: { span_detail: { text: string } } };
        expectedBodies.push(spanDetail.result.span_detail.text.trim());
      }
      expect(sectionBodies).toEqual(expectedBodies);
      expect(body).toContain("- Keep the first install step.");
      expect(body).toContain("- Preserve the second install step.");
      expect(body).toContain("| Option | Value |");
      expect(body).toContain("| runtime | edge |");
      expect(body).toContain("Run the command:");
      expect(body).toContain("```bash");
      expect(body).toContain("bun install");
      expect(body).toContain("context status");
      const verifyExact = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(verifyExact.status).toBe(0);

      writeFileSync(
        join(projectRoot, "knowledge", "architecture", "install", "overview.md"),
        approved.replace('content_mode="verbatim"', 'content_mode="verbatim" content_source_digest="sha256:unexpected"'),
        "utf8",
      );
      const verifyDigest = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(verifyDigest.status).not.toBe(0);
      const digestResult = JSON.parse(verifyDigest.stdout) as {
        issues: Array<{ code: string }>;
      };
      expect(digestResult.issues.map((issue) => issue.code)).toContain("approved-section-content-source-digest-not-supported");

      writeFileSync(
        join(projectRoot, "knowledge", "architecture", "install", "overview.md"),
        approved.replace("context status", ""),
        "utf8",
      );
      const verifyShrunk = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(verifyShrunk.status).not.toBe(0);
      const shrunk = JSON.parse(verifyShrunk.stdout) as {
        issues: Array<{ code: string }>;
      };
      expect(shrunk.issues.map((issue) => issue.code)).toContain("approved-verbatim-body-hash-mismatch");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("compile drops approved sections that no longer belong to the confirmed view", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedRichStructure(projectRoot, refs);
      const richContext = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "node-context",
        "--source",
        "architecture:entity/install",
        "--format",
        "json",
      ])) as { result: { node_context: { planned_sections: Array<{ local_source_refs: string[] }> } } };
      const firstActionFile = writeYaml(projectRoot, "initial-section.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-1",
          kind: "description",
          summary: "Initial approved section",
          source_refs: [richContext.result.node_context.planned_sections[0]!.local_source_refs[0]],
        }],
      });
      await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--stage",
        "--input",
        firstActionFile,
        "--format",
        "json",
      ]);
      const approveInitial = writeJsonl(projectRoot, "approve-initial.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", approveInitial, "--format", "json"]);

      await stageConfirmedStructure(projectRoot, [refs[0]!]);
      const replacementStructure = YAML.parse(readFileSync(
        join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"),
        "utf8",
      )) as AlignPayload & { lifecycle: { structure_digest: string } };
      await writeStructureSnapshot(projectRoot, {
        ...replacementStructure,
        structure_digest: replacementStructure.lifecycle.structure_digest,
      });
      const currentContext = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "node-context",
        "--source",
        "architecture:entity/install",
        "--format",
        "json",
      ])) as { result: { node_context: { planned_sections: Array<{ id: string; local_source_refs: string[] }> } } };
      const actionFile = writeYaml(projectRoot, "current-section.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install",
          kind: "description",
          summary: "Current confirmed section",
          source_refs: [currentContext.result.node_context.planned_sections[0]!.local_source_refs[0]],
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

      const record = readDraftRecord(projectRoot, "architecture/entity/install") as {
        sections?: Array<{ id: string }>;
      };
      expect(record.sections?.map((section) => section.id)).toEqual(["install"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("compile rejects reused approved sections when their source refs are not exact", async () => {
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
      ])) as { result: { node_context: { planned_sections: Array<{ local_source_refs: string[] }> } } };
      const firstActionFile = writeYaml(projectRoot, "approve-one-section.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-1",
          kind: "description",
          summary: "First approved section",
          source_refs: [context.result.node_context.planned_sections[0]!.local_source_refs[0]],
        }],
      });
      await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--stage",
        "--input",
        firstActionFile,
        "--format",
        "json",
      ]);
      const payload = writeJsonl(projectRoot, "approve-one-section.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      const approvedPath = join(projectRoot, "knowledge", "architecture", "install", "overview.md");
      const approved = readFileSync(approvedPath, "utf8");
      writeFileSync(approvedPath, approved.replace(/(@)[a-f0-9]+(" content_mode=)/iu, (_match, prefix: string, suffix: string) =>
        `${prefix}000000000000${suffix}`
      ), "utf8");

      const addSecondFile = writeYaml(projectRoot, "add-second-section.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-2",
          kind: "description",
          summary: "Second section",
          source_refs: [context.result.node_context.planned_sections[1]!.local_source_refs[0]],
        }],
      });
      const result = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        addSecondFile,
        "--format",
        "json",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string }> } };
      expect(result.result.valid).toBe(false);
      expect(result.result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("existing_section.source_ref_not_exact");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("review apply blocks prose candidates whose component refs are no longer exact", async () => {
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
      ])) as { result: { node_context: { planned_sections: Array<{ local_source_refs: string[] }> } } };
      const actionFile = writeYaml(projectRoot, "tamper-component-ref.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-1",
          kind: "description",
          summary: "Tamper component ref",
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
      const records = readFileSync(ledgerPath, "utf8")
        .trim()
        .split(/\r?\n/u)
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as {
          candidate_id: string;
          sections?: Array<{ source_refs?: string[] }>;
        });
      const record = records.find((candidate) => candidate.candidate_id === "architecture/entity/install");
      expect(typeof record?.sections?.[0]?.source_refs?.[0]).toBe("string");
      record!.sections![0]!.source_refs![0] = corruptSpanHash(record!.sections![0]!.source_refs![0]!);
      writeFileSync(ledgerPath, `${records.map((candidate) => JSON.stringify(candidate)).join("\n")}\n`, "utf8");
      const payload = writeJsonl(projectRoot, "approve-tampered-component.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      const apply = await invokeCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      expect(apply.status).not.toBe(0);
      expect(apply.stderr).toContain("prose candidate source_ref is not exact against current snapshot");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("compile rejects explicit reader-visible content instead of staging rewritten sections", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedRichStructure(projectRoot, refs);
      const actionFile = writeYaml(projectRoot, "rewrite-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-1",
          kind: "description",
          summary: "Rewrite source span for readability",
          source_refs: [refs[0]],
          content: "Reviewed rewritten content that must be confirmed.",
          content_intent: "rewrite",
        }],
      });
      const result = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--validate",
        "--input",
        actionFile,
        "--format",
        "json",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string }> } };
      expect(result.result.valid).toBe(false);
      expect(result.result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("action.content_unsupported");
      expect(result.result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("action.content_intent_unsupported");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
