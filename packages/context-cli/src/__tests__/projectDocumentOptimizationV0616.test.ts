import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  applyDocumentOptimizationDecisions,
  beginDocumentRevision,
  collectDocumentOptimizationStatus,
  createDocumentOptimizationRevision,
  createDocumentOptimizationPlan,
  currentDocumentRevisionPlan,
  projectDocumentOptimizedKnowledge,
  reconcileDocumentOptimizationRevisions,
  validateDocumentOptimizationRevisions,
} from "../project/documentOptimization.js";
import {
  disableDocumentOptimization,
  enableDocumentOptimization,
} from "../project/documentOptimizationConfig.js";
import type { ApprovedKnowledgeFile } from "../project/packageIndexes.js";
import { listApprovedKnowledge } from "../project/packageBuilder.js";
import {
  assertSafeDocumentEditorialDecision,
  assertSafeDocumentOptimizationReplacement,
  collectDocumentOptimizationFragments,
  sha256,
} from "../project/documentOptimizationModel.js";
import { analyzeDocumentEditorialSignals } from "../project/documentEditorialSignals.js";
import { projectPackageKnowledgeMarkdown } from "../project/packageKnowledgeProjection.js";
import { approvedKnowledgeInputHash } from "../project/close.js";

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "context-optimize-docs-"));
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    name: "fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`);
  return root;
}

function approvedFile(body = "Hello  world."): ApprovedKnowledgeFile {
  const content = [
    "---",
    "title: Example",
    "node_ref: entity/example",
    "node_type: entity",
    "view_ref: architecture:example",
    "---",
    "",
    '<!-- context:section id="intro" kind="paragraph" content_mode="verbatim" source_ref="src-0#span:1-1@sha256:test" -->',
    "",
    body,
    "",
    "<!-- /context:section -->",
    "",
  ].join("\n");
  return { relPath: "architecture/example.md", absPath: "/virtual/example.md", content };
}

function secondApprovedFile(): ApprovedKnowledgeFile {
  const file = approvedFile("Second  page.");
  return {
    ...file,
    relPath: "guides/second-example.md",
    absPath: "/virtual/second-example.md",
    content: file.content
      .replace("title: Example", "title: Example Guide")
      .replace("node_ref: entity/example", "node_ref: guide/second-example")
      .replace("view_ref: architecture:example", "view_ref: guide:second-example"),
  };
}

function twoSectionApprovedFile(): ApprovedKnowledgeFile {
  const content = [
    "---",
    "title: Two Sections",
    "node_ref: entity/two-sections",
    "node_type: entity",
    "view_ref: architecture:two-sections",
    "---",
    "",
    '<!-- context:section id="intro" kind="paragraph" content_mode="verbatim" source_ref="src-0#span:1-1@sha256:intro" -->',
    "",
    "Hello  world.",
    "",
    "<!-- /context:section -->",
    "",
    '<!-- context:section id="details" kind="paragraph" content_mode="verbatim" source_ref="src-0#span:2-2@sha256:details" -->',
    "",
    "Stable details.",
    "",
    "<!-- /context:section -->",
    "",
  ].join("\n");
  return { relPath: "architecture/two-sections.md", absPath: "/virtual/two-sections.md", content };
}

describe("document optimization revisions", () => {
  test("repairs adjacent inline-code delimiters without changing protected content", () => {
    const files = [approvedFile("Use `@scope/package@``0.y.z` for this project.")];
    const fragment = collectDocumentOptimizationFragments(files)[0]!;

    expect(() => assertSafeDocumentOptimizationReplacement(
      fragment,
      "Use `@scope/package@0.y.z` for this project.",
    )).not.toThrow();
    expect(() => assertSafeDocumentOptimizationReplacement(
      fragment,
      "Use `@scope/package@1.y.z` for this project.",
    )).toThrow("changed protected destinations, code, numbers, or identifiers");
  });

  test("reports Section-level editorial signals and allowed actions", async () => {
    const projectRoot = workspace();
    const files = [approvedFile([
      "# Open questions",
      "",
      "Should this support feedback?",
      "How should performance be measured?",
    ].join("\n"))];
    await enableDocumentOptimization(projectRoot);

    const plan = await createDocumentOptimizationPlan({ projectRoot, files });
    expect(plan.fragments).toHaveLength(1);
    expect(plan.fragments[0]!.signals.map((item) => item.code)).toContain("unanswered-question-set");
    expect(plan.fragments[0]!.allowed_actions).toEqual(["keep", "repair", "reshape", "omit"]);
    expect(plan.action_candidates.omit).toBe(1);
    expect(plan.input_requests).toEqual([]);
  });

  test("recognizes answered questions as FAQ reshape material instead of removable draft", async () => {
    const projectRoot = workspace();
    const files = [approvedFile([
      "如何启用稳定模式？",
      "当前采用 `stableMode` 配置启用。",
      "如何验证结果？",
      "必须运行 `tool verify` 并检查成功状态。",
    ].join("\n\n"))];
    await enableDocumentOptimization(projectRoot);

    const fragment = (await createDocumentOptimizationPlan({ projectRoot, files })).fragments[0]!;
    expect(fragment.signals.map((item) => item.code)).toContain("answered-question-set");
    expect(fragment.signals.map((item) => item.code)).not.toContain("unanswered-question-set");
    expect(fragment.allowed_actions).not.toContain("omit");
  });

  test("does not treat operational checks containing 是否 as unresolved draft", () => {
    const signals = analyzeDocumentEditorialSignals([
      "请检查组件是否已经初始化。",
      "确认结果是否满足当前配置要求。",
    ].join("\n"));
    expect(signals.map((item) => item.code)).not.toContain("brainstorm-without-decision");
    expect(signals.map((item) => item.code)).not.toContain("mixed-facts-and-draft");
  });

  test("still detects explicit open proposals that use 是否需要", () => {
    const signals = analyzeDocumentEditorialSignals("是否需要增加新的反馈入口？");
    expect(signals.map((item) => item.code)).toContain("brainstorm-without-decision");
  });

  test("flags URL labels that repeat the destination but ignores fenced examples", () => {
    const signals = analyzeDocumentEditorialSignals([
      "参考 [https://example.test/guide](https://example.test/guide)。",
      "",
      "```text",
      "https://example.test/example-only",
      "```",
    ].join("\n"));
    expect(signals.filter((item) => item.code === "raw-or-unlabeled-link")).toHaveLength(1);
    expect(signals.find((item) => item.code === "raw-or-unlabeled-link")?.line_start).toBe(1);
  });

  test("requires a concrete assessment before keeping a signaled Section", async () => {
    const projectRoot = workspace();
    const files = [approvedFile("Reference: https://example.test/guide")];
    await enableDocumentOptimization(projectRoot);
    const fragment = (await createDocumentOptimizationPlan({ projectRoot, files })).fragments[0]!;
    expect(fragment.keep_requires_assessment).toBe(true);

    const decision = {
      fragment_id: fragment.fragment_id,
      input_digest: fragment.input_digest,
      context_digest: fragment.context_digest,
      policy_digest: fragment.policy_digest,
      action: "keep" as const,
    };
    await expect(applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: { schema: "context.document-optimization-decisions.v2", decisions: [decision] },
    })).rejects.toThrow("requires a concrete assessment");

    const applied = await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: [{
          ...decision,
          assessment: "raw-or-unlabeled-link: the destination is itself the documented identifier and changing it would obscure the source contract.",
        }],
      },
    });
    expect(applied.status.current).toBe(true);
  });

  test("rejects one generic keep assessment reused across signaled Sections", async () => {
    const projectRoot = workspace();
    const second = secondApprovedFile();
    const files = [
      approvedFile("Reference: https://example.test/first"),
      { ...second, content: second.content.replace("Second  page.", "Reference: https://example.test/second") },
    ];
    await enableDocumentOptimization(projectRoot);
    const plan = await createDocumentOptimizationPlan({ projectRoot, files });
    expect(plan.fragments).toHaveLength(2);
    const assessment = "raw-or-unlabeled-link: the reported link presentation is acceptable in this source Section.";

    await expect(applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: plan.fragments.map((fragment) => ({
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "keep" as const,
          assessment,
        })),
      },
    })).rejects.toThrow("section-specific keep assessments");
  });

  test("rejects effort and schedule as reasons to keep actionable signals", async () => {
    for (const assessment of [
      "Keep this raw link unchanged to save time because the current batch is large.",
      "当前批次数量太多，为节省时间和工作量，整批保留不再修复。",
    ]) {
      const projectRoot = workspace();
      const files = [approvedFile("Reference: https://example.test/guide")];
      await enableDocumentOptimization(projectRoot);
      const fragment = (await createDocumentOptimizationPlan({ projectRoot, files })).fragments[0]!;

      await expect(applyDocumentOptimizationDecisions({
        projectRoot,
        files,
        payload: {
          schema: "context.document-optimization-decisions.v2",
          decisions: [{
            fragment_id: fragment.fragment_id,
            input_digest: fragment.input_digest,
            context_digest: fragment.context_digest,
            policy_digest: fragment.policy_digest,
            action: "keep",
            assessment,
          }],
        },
      })).rejects.toThrow("cannot be justified by delivery effort");
    }
  });

  test("requires a keep assessment to address every reported signal code", async () => {
    const projectRoot = workspace();
    const files = [approvedFile("Reference: https://example.test/guide?timestamp=123")];
    await enableDocumentOptimization(projectRoot);
    const fragment = (await createDocumentOptimizationPlan({ projectRoot, files })).fragments[0]!;
    expect(fragment.signals.map((signal) => signal.code)).toEqual([
      "raw-or-unlabeled-link",
      "volatile-query-url",
    ]);

    await expect(applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: [{
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "keep",
          assessment: "raw-or-unlabeled-link: the source intentionally exposes the destination as an exact identifier.",
        }],
      },
    })).rejects.toThrow("requires an assessment for every signal");
  });

  test("does not let managed work silently keep a real request-input signal", async () => {
    const projectRoot = workspace();
    const files = [approvedFile("Reference: https://example.test/guide?timestamp=123")];
    await enableDocumentOptimization(projectRoot);
    const fragment = (await createDocumentOptimizationPlan({ projectRoot, files })).fragments[0]!;
    const decision = {
      fragment_id: fragment.fragment_id,
      input_digest: fragment.input_digest,
      context_digest: fragment.context_digest,
      policy_digest: fragment.policy_digest,
      action: "keep" as const,
    };

    await expect(applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: [{
          ...decision,
          assessment: "raw-or-unlabeled-link and volatile-query-url are preserved to protect source fidelity.",
        }],
      },
    })).rejects.toThrow("cannot be silently kept");

    const applied = await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: [{
          ...decision,
          assessment: "raw-or-unlabeled-link and volatile-query-url are false-positive signals here because the URL itself is the exact stable identifier documented by this Section.",
        }],
      },
    });
    expect(applied.status.current).toBe(true);
  });

  test("keeps a compact table without forcing a wide-table reshape", async () => {
    const projectRoot = workspace();
    const files = [approvedFile([
      "| Mode | Result |",
      "| --- | --- |",
      "| stable | Supported |",
    ].join("\n"))];
    await enableDocumentOptimization(projectRoot);
    const fragment = (await createDocumentOptimizationPlan({ projectRoot, files })).fragments[0]!;
    expect(fragment.signals.map((item) => item.code)).not.toContain("wide-table");
    const result = await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: [{
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "keep",
        }],
      },
    });
    expect(result.status.current).toBe(true);
  });

  test("allows a custom protocol destination to become inline code without changing it", () => {
    const fragment = collectDocumentOptimizationFragments([
      approvedFile("Open custom://runtime/screen?mode=stable to enter the runtime."),
    ])[0]!;
    expect(() => assertSafeDocumentOptimizationReplacement(
      fragment,
      "Open `custom://runtime/screen?mode=stable` to enter the runtime.",
    )).not.toThrow();
  });

  test("preserves images, attachments, commands, numbers, identifiers, and source refs during reshape", () => {
    const source = [
      "![Architecture](../assets/image/diagram.png)",
      "Download [the sample](../assets/file/sample.zip).",
      "Run `tool build --mode stable` for 3 targets using `module.entry`.",
    ].join("\n\n");
    const fragment = collectDocumentOptimizationFragments([approvedFile(source)])[0]!;
    const replacement = [
      "- ![Architecture](../assets/image/diagram.png)",
      "- Download [the sample](../assets/file/sample.zip).",
      "- Run `tool build --mode stable` for 3 targets using `module.entry`.",
    ].join("\n");
    expect(fragment.source_ref).toBe("src-0#span:1-1@sha256:test");
    expect(() => assertSafeDocumentEditorialDecision(fragment, "reshape", replacement)).not.toThrow();
  });

  test("reports unresolved publication input as one plan-level request", async () => {
    const projectRoot = workspace();
    const files = [approvedFile("Owner: individual_name")];
    await enableDocumentOptimization(projectRoot);

    const plan = await createDocumentOptimizationPlan({ projectRoot, files });
    expect(plan.action_candidates.request_input).toBe(1);
    expect(plan.input_requests).toHaveLength(1);
    expect(plan.input_requests[0]!.signals[0]!.code).toBe("unstable-owner-reference");
  });

  test("omits a mechanically eligible non-knowledge Section from package prose", async () => {
    const projectRoot = workspace();
    const files = [approvedFile([
      "# Open questions",
      "",
      "Should this support feedback?",
      "How should performance be measured?",
    ].join("\n"))];
    await enableDocumentOptimization(projectRoot);
    const fragment = (await createDocumentOptimizationPlan({ projectRoot, files })).fragments[0]!;

    await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: [{
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "omit",
          reason: "unanswered-question",
        }],
      },
    });

    const projected = await projectDocumentOptimizedKnowledge({ projectRoot, files });
    expect(projected.files[0]!.content).not.toContain("Should this support feedback?");
    const packaged = projectPackageKnowledgeMarkdown(projected.files[0]!.content);
    expect(packaged).not.toContain("context:section");
    expect(packaged).not.toContain("Open questions");
  });

  test("reshapes a complex table while preserving exact destinations and identifiers", async () => {
    const projectRoot = workspace();
    const source = [
      "| Name | Identifier | Purpose | Entry | Notes |",
      "| --- | --- | --- | --- | --- |",
      "| Example | `entry_a` | Opens the example | https://example.test/path?mode=stable | Long reader-facing detail that belongs to this entry and should not remain inside one wide table cell. |",
    ].join("\n");
    const files = [approvedFile(source)];
    await enableDocumentOptimization(projectRoot);
    const fragment = (await createDocumentOptimizationPlan({ projectRoot, files })).fragments[0]!;
    expect(fragment.signals.map((item) => item.code)).toContain("wide-table");
    const replacement = [
      "## Entry index",
      "",
      "- [Example](#example): Opens the example",
      "",
      "### Example",
      "",
      "- Identifier: `entry_a`",
      "- Purpose: Opens the example",
      "- Entry: [Open the stable example](https://example.test/path?mode=stable)",
      "- Notes: Long reader-facing detail that belongs to this entry and should not remain inside one wide table cell.",
    ].join("\n");

    const applied = await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: [{
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "reshape",
          replacement,
        }],
      },
    });
    expect(applied.status.current).toBe(true);
    const projected = await projectDocumentOptimizedKnowledge({ projectRoot, files });
    expect(projected.files[0]!.content).toContain("[Open the stable example](https://example.test/path?mode=stable)");
    expect(projected.files[0]!.content).toContain("`entry_a`");
  });

  test("rejects omission when the current Section has no eligible reason", async () => {
    const projectRoot = workspace();
    const files = [approvedFile("This is a stable operating rule with a clear outcome.")];
    await enableDocumentOptimization(projectRoot);
    const fragment = (await createDocumentOptimizationPlan({ projectRoot, files })).fragments[0]!;
    expect(fragment.allowed_actions).not.toContain("omit");

    await expect(applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: [{
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "omit",
          reason: "draft-without-decision",
        }],
      },
    })).rejects.toThrow("cannot be omitted");
  });

  test("stores one revision beside the approved knowledge page", async () => {
    const projectRoot = workspace();
    const files = [approvedFile()];
    await enableDocumentOptimization(projectRoot);

    const plan = await createDocumentOptimizationPlan({ projectRoot, files });
    expect(plan.pending_fragments).toBe(1);
    expect(plan.fragments).toHaveLength(1);
    const fragment = plan.fragments[0]!;

    const applied = await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: [{
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "repair",
          replacement: "Hello world.",
        }],
      },
    });
    expect(applied.status.current).toBe(true);
    expect(applied.status.revision_pages).toBe(1);
    const revisionPath = join(projectRoot, "knowledge", "architecture", "example__revision.md");
    expect(existsSync(revisionPath)).toBe(true);
    const revision = readFileSync(revisionPath, "utf8");
    expect(revision).toContain("context_revision:");
    expect(revision).not.toContain("approved_path:");
    expect(revision).toContain("policy_digest:");
    expect(revision).not.toContain("revised_fragments:");

    const projected = await projectDocumentOptimizedKnowledge({ projectRoot, files });
    expect(projected.files[0]!.content).toContain("Hello world.");
    expect(projected.files[0]!.content).not.toContain("Hello  world.");
    expect(projected.files[0]!.content).not.toContain("context_revision");
    expect(files[0]!.content).toContain("Hello  world.");
  });

  test("derives kept Section state from durable approved metadata without .tmp", async () => {
    const projectRoot = workspace();
    const files = [approvedFile()];
    await enableDocumentOptimization(projectRoot);
    const plan = await createDocumentOptimizationPlan({ projectRoot, files });
    const fragment = plan.fragments[0]!;
    await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: [{
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "keep",
        }],
      },
    });
    const status = await collectDocumentOptimizationStatus({ projectRoot, files });
    expect(status.current).toBe(true);
    expect(status.kept_fragments).toBe(1);
    expect(status.revision_pages).toBe(0);
    expect(existsSync(join(projectRoot, "knowledge", "architecture", "example__revision.md"))).toBe(false);
    const approved = readFileSync(join(projectRoot, "knowledge", "architecture", "example.md"), "utf8");
    expect(approved).toContain("context_optimization:");
    expect(approved).toContain("input_digest:");
    expect(approved).not.toContain("Hello world.");
    expect(projectPackageKnowledgeMarkdown(approved)).not.toContain("context_optimization");
    rmSync(join(projectRoot, ".tmp"), { recursive: true, force: true });
    const recovered = await collectDocumentOptimizationStatus({ projectRoot, files });
    expect(recovered.current).toBe(true);
    expect(recovered.kept_fragments).toBe(1);
  });

  test("accepts a safe page edit and blocks it when the approved baseline changes", async () => {
    const projectRoot = workspace();
    const files = [approvedFile()];
    await enableDocumentOptimization(projectRoot);
    const plan = await createDocumentOptimizationPlan({ projectRoot, files });
    const fragment = plan.fragments[0]!;
    await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: [{
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "keep",
        }],
      },
    });
    const revision = await createDocumentOptimizationRevision({
      projectRoot,
      files,
      fragmentId: fragment.fragment_id,
    });
    const revisionText = readFileSync(revision.path, "utf8").replace("Hello  world.", "Hello world.");
    writeFileSync(revision.path, revisionText);
    expect((await reconcileDocumentOptimizationRevisions({ projectRoot, files })).revised_fragments).toBe(1);

    const approvedPath = join(projectRoot, "knowledge", "architecture", "example.md");
    writeFileSync(approvedPath, readFileSync(approvedPath, "utf8").replace("Hello  world.", "Hello  changed world."));
    const status = await collectDocumentOptimizationStatus({ projectRoot, files });
    expect(status.current).toBe(false);
    expect(status.conflict_fragments).toBe(1);
  });

  test("invalidates only the changed Section while preserving another valid revision", async () => {
    const projectRoot = workspace();
    const files = [twoSectionApprovedFile()];
    await enableDocumentOptimization(projectRoot);
    const plan = await createDocumentOptimizationPlan({ projectRoot, files });
    const intro = plan.fragments.find((fragment) => fragment.section_id === "intro")!;
    const details = plan.fragments.find((fragment) => fragment.section_id === "details")!;
    await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: [{
          fragment_id: intro.fragment_id,
          input_digest: intro.input_digest,
          context_digest: intro.context_digest,
          policy_digest: intro.policy_digest,
          action: "repair",
          replacement: "Hello world.",
        }, {
          fragment_id: details.fragment_id,
          input_digest: details.input_digest,
          context_digest: details.context_digest,
          policy_digest: details.policy_digest,
          action: "keep",
        }],
      },
    });
    const approvedPath = join(projectRoot, "knowledge", "architecture", "two-sections.md");
    writeFileSync(approvedPath, readFileSync(approvedPath, "utf8").replace("Stable details.", "Updated stable details."));

    const status = await collectDocumentOptimizationStatus({ projectRoot, files });
    expect(status.revised_fragments).toBe(1);
    expect(status.pending_fragments).toBe(1);
    expect(status.conflict_fragments).toBe(0);
    expect(status.pending_fragment_ids).toEqual([details.fragment_id]);
  });

  test("reprocesses only the Section whose persisted policy digest is stale", async () => {
    const projectRoot = workspace();
    const files = [twoSectionApprovedFile()];
    await enableDocumentOptimization(projectRoot);
    const plan = await createDocumentOptimizationPlan({ projectRoot, files });
    await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: plan.fragments.map((fragment) => ({
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "keep" as const,
        })),
      },
    });
    const details = plan.fragments.find((fragment) => fragment.section_id === "details")!;
    const approvedPath = join(projectRoot, "knowledge", "architecture", "two-sections.md");
    const approved = readFileSync(approvedPath, "utf8");
    const marker = `policy_digest: ${details.policy_digest}`;
    const detailsStart = approved.indexOf("\n    details:");
    writeFileSync(approvedPath, `${approved.slice(0, detailsStart)}${approved.slice(detailsStart)
      .replace(marker, `policy_digest: ${"a".repeat(64)}`)}`);

    const status = await collectDocumentOptimizationStatus({ projectRoot, files });
    expect(status.kept_fragments).toBe(1);
    expect(status.pending_fragments).toBe(1);
    expect(status.pending_fragment_ids).toEqual([details.fragment_id]);
  });

  test("starts one conversational correction without opening a whole-workspace batch", async () => {
    const projectRoot = workspace();
    const files = [approvedFile(), secondApprovedFile()];

    const entry = await beginDocumentRevision({
      projectRoot,
      files,
      selector: "architecture/example.md",
    });
    expect(entry).toMatchObject({
      status: "started",
      revision_path: "knowledge/architecture/example__revision.md",
      target: { approved_path: "architecture/example.md" },
    });
    expect(existsSync(join(projectRoot, "knowledge", "architecture", "example__revision.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "knowledge", "guides", "second-example__revision.md"))).toBe(false);

    const started = await collectDocumentOptimizationStatus({ projectRoot, files });
    expect(started.enabled).toBe(true);
    expect(started.revision_requested).toBe(true);
    expect(started.requested_approved_path).toBe("architecture/example.md");
    expect(started.pending_fragments).toBe(0);
    const current = await currentDocumentRevisionPlan({ projectRoot, files });
    expect(current.changed).toBe(false);

    await expect(validateDocumentOptimizationRevisions({ projectRoot, files })).rejects.toThrow(
      "has not changed",
    );
    const revisionPath = join(projectRoot, current.revision_path);
    writeFileSync(revisionPath, readFileSync(revisionPath, "utf8").replace("Hello  world.", "Hello world."));
    const validated = await validateDocumentOptimizationRevisions({ projectRoot, files });
    expect(validated.revision_requested).toBe(false);
    expect(validated.revised_fragments).toBe(1);
    expect(validated.current).toBe(true);
  });

  test("returns ambiguous correction targets without changing workspace state", async () => {
    const projectRoot = workspace();
    const entry = await beginDocumentRevision({
      projectRoot,
      files: [approvedFile(), secondApprovedFile()],
      selector: "md",
    });
    expect(entry.status).toBe("target-selection-required");
    expect(entry.candidates).toHaveLength(2);
    expect((await collectDocumentOptimizationStatus({
      projectRoot,
      files: [approvedFile(), secondApprovedFile()],
    })).enabled).toBe(false);
    expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "document-optimization"))).toBe(false);
  });

  test("disable removes the active revision and restores baseline projection", async () => {
    const projectRoot = workspace();
    const files = [approvedFile()];
    await enableDocumentOptimization(projectRoot);
    const plan = await createDocumentOptimizationPlan({ projectRoot, files });
    const fragment = plan.fragments[0]!;
    await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v2",
        decisions: [{
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "repair",
          replacement: "Hello world.",
        }],
      },
    });
    const recoveryPath = await disableDocumentOptimization(projectRoot);
    expect(recoveryPath).toBeDefined();
    expect(existsSync(join(projectRoot, "knowledge", "architecture", "example__revision.md"))).toBe(false);
    expect((await collectDocumentOptimizationStatus({ projectRoot, files })).enabled).toBe(false);
    const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      context: { documentOptimization?: boolean };
    };
    expect(packageJson.context.documentOptimization).toBeUndefined();
  });

  test("excludes revision sidecars from approved knowledge discovery", async () => {
    const projectRoot = workspace();
    const file = approvedFile();
    const root = join(projectRoot, "knowledge", "architecture");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "example.md"), file.content);
    writeFileSync(join(root, "example__revision.md"), file.content.replace(
      "view_ref: architecture:example",
      `view_ref: architecture:example\ncontext_revision: ${"a".repeat(64)}`,
    ));
    expect((await listApprovedKnowledge(projectRoot)).map((item) => item.relPath)).toEqual(["architecture/example.md"]);
  });

  test("excludes revision sidecars from the deterministic close input", async () => {
    const projectRoot = workspace();
    const file = approvedFile();
    const root = join(projectRoot, "knowledge", "architecture");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "example.md"), file.content);
    const revisionPath = join(root, "example__revision.md");
    writeFileSync(revisionPath, file.content.replace(
      "view_ref: architecture:example",
      `view_ref: architecture:example\ncontext_revision: ${sha256(file.content)}`,
    ));
    const before = await approvedKnowledgeInputHash(projectRoot);
    writeFileSync(revisionPath, readFileSync(revisionPath, "utf8").replace("Hello  world.", "Hello world."));
    expect(await approvedKnowledgeInputHash(projectRoot)).toBe(before);
  });
});
