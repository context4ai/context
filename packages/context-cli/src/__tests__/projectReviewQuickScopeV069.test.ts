import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import {
  createCapturedCompileProject,
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  sourceRefs,
  stageConfirmedRichStructure,
  writeYaml,
} from "./projectCompileProseV066Helpers.js";

async function stageInstallDraft(projectRoot: string): Promise<void> {
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
    result: {
      node_context: {
        planned_sections: Array<{ local_source_refs: string[] }>;
      };
    };
  };

  const actionFile = writeYaml(projectRoot, "compile-actions.yaml", {
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
}

function draftCandidateIds(projectRoot: string): string[] {
  return readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { candidate_id?: unknown; status?: unknown })
    .filter((row) => row.status === "draft" && typeof row.candidate_id === "string")
    .map((row) => row.candidate_id as string)
    .sort();
}

function candidateIdsHash(ids: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([...ids].sort())).digest("hex");
}

describe("0.6.9 review quick decision scope gate", () => {
  test("review approve requires an explicit scoped payload equivalent", async () => {
    const root = makeTmp();
    const projectRoot = await createCapturedCompileProject(root);
    await stageInstallDraft(projectRoot);

    const unscoped = await invokeCliInDir(projectRoot, [
      "review",
      "approve",
      "architecture/entity/install",
      "--format",
      "json",
    ]);
    expect(unscoped.status).not.toBe(0);
    expect(unscoped.stderr).toContain("requires --collection <collection> or --all");

    const scoped = await invokeCliInDir(projectRoot, [
      "review",
      "approve",
      "architecture/entity/install",
      "--collection",
      "architecture",
      "--format",
      "json",
    ]);
    expect(scoped.status).toBe(0);
    expect(JSON.parse(scoped.stdout)).toMatchObject({ approved: 1, rejected: 0 });
    expect(existsSync(join(projectRoot, "knowledge", "architecture", "install", "overview.md"))).toBe(true);
  });

  test("managed approve-all atomically approves the current collection scope", async () => {
    const root = makeTmp();
    const projectRoot = await createCapturedCompileProject(root);
    try {
      await stageInstallDraft(projectRoot);

      const ordinaryStatus = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--format", "json", "--view", "full",
      ])) as {
        executionMode?: unknown;
        routing: { human_gate: { required: boolean }; command_plan: Array<{ command: string }> };
      };
      expect(ordinaryStatus.executionMode).toBeUndefined();
      expect(ordinaryStatus.routing.human_gate.required).toBe(true);

      const managedStatus = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as {
        executionMode: { mode: string; scope: string };
        workflow: {
          revision: string;
          current: {
            resources: { required: Array<{ id: string }> };
            gate: { inspection_action?: unknown; resolution_action?: { id: string } };
          };
        };
        pendingReview: {
          scope: string;
          collection: string;
          collections: string[];
          count: number;
          candidateSetDigest: string;
          decisionSource: string;
        };
        routing: {
          human_gate: {
            required: boolean;
            kind: string;
            confirmation: string;
            persistence: string;
            resolution?: string;
          };
          command_plan: Array<{ command: string }>;
        };
      };
      expect(managedStatus.executionMode).toEqual({ mode: "managed", scope: "current-conversation" });
      expect(managedStatus.routing.human_gate).toMatchObject({
        required: false,
        kind: "knowledge-review",
        confirmation: "not-required",
        persistence: "not-applicable",
        resolution: "managed-session",
      });
      expect(managedStatus.routing.command_plan[0]?.command).toContain(
        "review approve-all architecture --managed --format json",
      );
      expect(managedStatus.pendingReview).toMatchObject({
        scope: "collection",
        collection: "architecture",
        collections: ["architecture"],
        count: 1,
        decisionSource: "managed-session",
      });
      expect(managedStatus.pendingReview.candidateSetDigest).toMatch(
        /^[a-f0-9]{64}$/u,
      );
      expect(managedStatus.workflow.current.resources.required).toEqual([]);
      expect(managedStatus.workflow.current.gate.inspection_action).toBeUndefined();
      expect(managedStatus.workflow.current.gate.resolution_action).toMatchObject({
        id: "apply-managed-review",
      });

      const denied = await invokeCliInDir(projectRoot, [
        "review", "approve-all", "architecture", "--format", "json",
      ]);
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain("requires explicit --managed authority or --force user confirmation");

      const approved = await invokeCliInDir(projectRoot, [
        "review", "approve-all", "architecture", "--managed", "--format", "json",
      ]);
      expect(approved.status).toBe(0);
      const approvedResult = JSON.parse(approved.stdout) as Record<string, unknown>;
      expect(approvedResult).toMatchObject({
        kind: "review.approve-all.result",
        decision_source: "managed-session",
        applied: 1,
        approved: 1,
        rejected: 0,
        details: {
          included: false,
          omitted_candidate_ids: 1,
          omitted_pages: 1,
        },
      });
      expect(JSON.stringify(approvedResult)).not.toContain("architecture/entity/install");
      expect(JSON.stringify(approvedResult)).not.toContain("overview.md");
      expect(existsSync(join(projectRoot, "knowledge", "architecture", "install", "overview.md"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("explicit force approval atomically approves the current ordinary review scope", async () => {
    const root = makeTmp();
    const projectRoot = await createCapturedCompileProject(root);
    try {
      await stageInstallDraft(projectRoot);

      const status = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--format", "json", "--view", "full",
      ])) as {
        workflow: {
          current: {
            gate: { resolution_action?: { id: string } };
          };
        };
        routing: {
          command_plan: Array<{ command: string; availability: string }>;
        };
      };
      expect(status.workflow.current.gate.resolution_action).toMatchObject({
        id: "apply-forced-review",
      });
      expect(status.routing.command_plan).toContainEqual({
        command: expect.stringContaining(
          "review approve-all architecture --force --format json",
        ),
        availability: "after-human-confirmation",
      });

      const conflict = await invokeCliInDir(projectRoot, [
        "review", "approve-all", "architecture", "--managed", "--force", "--format", "json",
      ]);
      expect(conflict.status).not.toBe(0);
      expect(conflict.stderr).toContain("either --managed or --force, not both");

      const approved = await invokeCliInDir(projectRoot, [
        "review", "approve-all", "architecture", "--force", "--format", "json",
      ]);
      expect(approved.status).toBe(0);
      expect(JSON.parse(approved.stdout)).toMatchObject({
        kind: "review.approve-all.result",
        decision_source: "explicit-user-force-approval",
        applied: 1,
        approved: 1,
        rejected: 0,
      });
      expect(existsSync(join(projectRoot, "knowledge", "architecture", "install", "overview.md"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("review apply rejects stale prose candidates from an older confirmed structure", async () => {
    const root = makeTmp();
    const projectRoot = await createCapturedCompileProject(root);
    await stageInstallDraft(projectRoot);

    const structurePath = join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml");
    const structure = YAML.parse(readFileSync(structurePath, "utf8")) as {
      views: Array<{ view_ref: string; summary?: string }>;
      lifecycle: { structure_digest?: string };
    };
    structure.views = structure.views.map((view) =>
      view.view_ref === "architecture:entity/install"
        ? { ...view, summary: "Install workflow knowledge after structure confirmation changed." }
        : view
    );
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

    const payload = join(projectRoot, "review-stale-structure.jsonl");
    writeFileSync(payload, `${JSON.stringify({
      schema: "context.review.decisions.v1",
      collection: "architecture",
      default: "approved",
      scope: {
        kind: "collection",
        collection: "architecture",
        count: 1,
        ids_sha256: candidateIdsHash(["architecture/entity/install"]),
        visible_candidate_ids: ["architecture/entity/install"],
      },
    })}\n`, "utf8");
    const stale = await invokeCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toContain("review is blocked until the confirmed compile batch is prepared");
    expect(stale.stderr).toContain("architecture:entity/install");
    expect(existsSync(join(projectRoot, "knowledge", "architecture", "install", "overview.md"))).toBe(false);
  });

  test("all-scope review payload requires visible candidate ids", async () => {
    const root = makeTmp();
    const projectRoot = await createCapturedCompileProject(root);
    await stageInstallDraft(projectRoot);
    const ids = draftCandidateIds(projectRoot);
    const payloadPath = join(projectRoot, "review-all-missing-visible.jsonl");
    writeFileSync(payloadPath, `${JSON.stringify({
      schema: "context.review.decisions.v1",
      default: "approved",
      scope: {
        kind: "all",
        count: ids.length,
        ids_sha256: candidateIdsHash(ids),
      },
    })}\n`, "utf8");

    const result = await invokeCliInDir(projectRoot, ["review", "apply", payloadPath, "--format", "json"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("all-scope review payload requires scope.visible_candidate_ids");
  });

  test("review apply rejects a candidate set whose fingerprints changed without changing ids", async () => {
    const root = makeTmp();
    const projectRoot = await createCapturedCompileProject(root);
    await stageInstallDraft(projectRoot);
    const ids = draftCandidateIds(projectRoot);
    const payloadPath = join(projectRoot, "review-stale-fingerprint.jsonl");
    writeFileSync(payloadPath, `${JSON.stringify({
      schema: "context.review.decisions.v1",
      collection: "architecture",
      default: "approved",
      scope: {
        kind: "collection",
        collection: "architecture",
        count: ids.length,
        ids_sha256: candidateIdsHash(ids),
        candidates_sha256: "0".repeat(64),
      },
    })}\n`, "utf8");

    const result = await invokeCliInDir(projectRoot, ["review", "apply", payloadPath, "--format", "json"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("review payload is stale for the current draft candidates");
    expect(result.stderr).toContain("candidates_sha256");
    rmSync(root, { recursive: true, force: true });
  });

  test("review apply accepts prose candidates compiled from approved structure fallback", async () => {
    const root = makeTmp();
    const projectRoot = await createCapturedCompileProject(root);
    await stageInstallDraft(projectRoot);

    const firstApply = await invokeCliInDir(projectRoot, [
      "review",
      "approve",
      "architecture/entity/install",
      "--collection",
      "architecture",
      "--format",
      "json",
    ]);
    expect(firstApply.status).toBe(0);
    await runCliInDir(projectRoot, ["close", "--format", "json"]);
    rmSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), { force: true });

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
      result: {
        node_context: {
          planned_sections: Array<{ local_source_refs: string[] }>;
        };
      };
    };
    const actionFile = writeYaml(projectRoot, "compile-actions-approved-fallback.yaml", {
      schema_version: "context.compile-actions.v1",
      view_ref: "architecture:entity/install",
      actions: [{
        op: "update",
        section_id: "install-1",
        kind: "description",
        summary: "Install source span from approved structure fallback",
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

    const secondApply = await invokeCliInDir(projectRoot, [
      "review",
      "approve",
      "architecture/entity/install",
      "--collection",
      "architecture",
      "--format",
      "json",
    ]);
    expect(secondApply.status).toBe(0);
    expect(JSON.parse(secondApply.stdout)).toMatchObject({ approved: 1, rejected: 0 });
  });
});
