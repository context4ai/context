import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { createCapturedAlignProject, firstSourceRef, makeTmp, runCliInDir, structurePayload, writePayload } from "./projectAlignProseV062Helpers.js";

describe("0.6.6 prose align structure gate", () => {
  test("confirmed lifecycle requires stable confirmation metadata and digest", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = await firstSourceRef(projectRoot);
      const payload = structurePayload(projectRoot, sourceRef);

      const missingConfirmation = writePayload(projectRoot, "missing-confirmation.yaml", {
        ...payload,
        lifecycle: { state: "confirmed" },
      });
      const missing = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        missingConfirmation,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string }> } };
      expect(missing.result.valid).toBe(false);
      expect(missing.result.diagnostics.map((item) => item.code)).toContain("lifecycle.confirmed_by_missing");
      expect(missing.result.diagnostics.map((item) => item.code)).toContain("lifecycle.confirmed_at_missing");
      expect(missing.result.diagnostics.map((item) => item.code)).toContain("lifecycle.structure_digest_missing");

      const badDigest = writePayload(projectRoot, "bad-digest.yaml", {
        ...payload,
        lifecycle: {
          state: "confirmed",
          confirmed_by: "human",
          confirmed_at: "2026-06-24T12:00:00Z",
          structure_digest: "sha256:bad",
        },
      });
      const invalidDigest = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        badDigest,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; repair?: Record<string, unknown> }> } };
      expect(invalidDigest.result.valid).toBe(false);
      expect(invalidDigest.result.diagnostics).toContainEqual(expect.objectContaining({
        code: "lifecycle.structure_digest_mismatch",
      }));
      expect(JSON.stringify(invalidDigest.result.diagnostics)).toContain("expected_structure_digest");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("confirm command writes confirmed lifecycle without agent editing the payload", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = await firstSourceRef(projectRoot);
      const payload = writePayload(projectRoot, "draft.yaml", structurePayload(projectRoot, sourceRef));
      writeFileSync(join(projectRoot, "src", "index.ts"), [
        'import { alignProse, captureFile, compileProse, defineProject, reviewValidity, source } from "@c4a/context";',
        "",
        'const docs = source("product-docs");',
        "",
        "export default defineProject({",
        "  sources: [docs],",
        "  phases: [",
        "    captureFile({ source: docs }),",
        '    alignProse({ source: docs, collection: "architecture" }),',
        '    compileProse({ source: docs, collection: "architecture" }),',
        '    reviewValidity({ collection: "architecture" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      const validated = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        payload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { warning_lifecycle: { scope: string; disposition: string; verify_scope: string } } };
      expect(validated.result.warning_lifecycle).toMatchObject({
        scope: "align-quality",
        disposition: "pending-structure-confirmation",
        verify_scope: "not-carried-to-verify",
      });

      const staged = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--stage",
        "--input",
        payload,
        "--format",
        "json",
      ])) as {
        result: {
          next_action: { kind: string; command: string };
        };
      };
      expect(staged.result.next_action).toMatchObject({
        kind: "reevaluate_workspace_route",
        command: "context status --format json",
      });
      const confirmationStatus = JSON.parse(await runCliInDir(projectRoot, [
        "status",
        "--format",
        "json",
        "--view",
        "full",
      ])) as {
        workflow: {
          current: {
            node: string;
            action: { id: string };
            gate?: {
              id: string;
              authority: string;
              resolution: string;
            };
            commands: Array<{ command: string; availability: string }>;
            resources: {
              required: Array<{ id: string }>;
              recommended: Array<{ id: string }>;
            };
          };
        };
      };
      expect(confirmationStatus.workflow.current).toMatchObject({
        node: "run-indexer-lifecycle",
        action: { id: "run-indexer-lifecycle" },
        commands: [],
      });
      expect(confirmationStatus.workflow.current.gate).toBeUndefined();
      expect(confirmationStatus.workflow.current.resources.required).toContainEqual(
        expect.objectContaining({ id: "skill.context-run-indexer-lifecycle" }),
      );
      const authorizedStatus = JSON.parse(await runCliInDir(projectRoot, [
        "status",
        "--authority",
        "context.structure-confirmation",
        "--format",
        "json",
        "--view",
        "full",
      ])) as {
        workflow: {
          current: {
            node: string;
            action: { id: string };
            gate?: {
              resolution: string;
              inspection_action?: unknown;
              resolution_action?: { id: string };
            };
            commands: Array<{ command: string; availability: string }>;
            resources: { required: Array<{ id: string }> };
          };
        };
      };
      expect(authorizedStatus.workflow.current).toMatchObject({
        node: "run-indexer-lifecycle",
        action: { id: "run-indexer-lifecycle" },
        commands: [],
      });
      expect(authorizedStatus.workflow.current.gate).toBeUndefined();
      expect(authorizedStatus.workflow.current.resources.required).toContainEqual(
        expect.objectContaining({ id: "skill.context-run-indexer-lifecycle" }),
      );
      const confirmed = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--confirm",
        "--format",
        "json",
      ])) as {
        result: {
          kind: string;
          operation: string;
          lifecycle_state: string;
          warning_lifecycle: { disposition: string; verify_scope: string };
          next_action: {
            kind: string;
            command: string;
            completed_operation: string;
            reason_code: string;
          };
        };
      };

      expect(confirmed.result.kind).toBe("prose.align.structure-write.result");
      expect(confirmed.result.operation).toBe("confirmed");
      expect(confirmed.result.lifecycle_state).toBe("confirmed");
      expect(confirmed.result.next_action).toMatchObject({
        kind: "reevaluate_workspace_route",
        command: "context status --format json",
        completed_operation: "align:file:product-docs:architecture",
        reason_code: "prose-align-structure-confirmed",
      });
      expect(confirmed.result.warning_lifecycle).toMatchObject({
        disposition: "accepted-by-structure-confirmation",
        verify_scope: "not-carried-to-verify",
      });
      const status = JSON.parse(await runCliInDir(projectRoot, [
        "status",
        "--format",
        "json",
        "--view",
        "full",
      ])) as {
        workflow: {
          current: {
            node: string;
            reason_code: string;
            commands: Array<{ command: string; availability: string }>;
            resources: {
              required: Array<{ id: string }>;
              recommended: Array<{ id: string }>;
            };
          };
        };
      };
      expect(status.workflow.current).toMatchObject({
        node: "run-indexer-lifecycle",
        reason_code: "route.indexer.lifecycle-required",
      });
      expect(status.workflow.current.commands).toEqual([]);
      expect(status.workflow.current.resources.required).toContainEqual(
        expect.objectContaining({ id: "skill.context-run-indexer-lifecycle" }),
      );
      expect(status.workflow.current.resources.recommended).toEqual([]);
      const structure = YAML.parse(readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), "utf8")) as {
        lifecycle: { state: string; confirmed_by?: string; confirmed_at?: string; structure_digest?: string };
      };
      expect(structure.lifecycle.state).toBe("confirmed");
      expect(structure.lifecycle.confirmed_by).toBe("user");
      expect(structure.lifecycle.confirmed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
      expect(structure.lifecycle.structure_digest).toMatch(/^sha256:/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("managed stage confirms a valid structure without persisting project policy", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = await firstSourceRef(projectRoot);
      const payload = writePayload(projectRoot, "managed-draft.yaml", structurePayload(projectRoot, sourceRef));

      const staged = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--stage",
        "--managed",
        "--input",
        payload,
        "--format",
        "json",
      ])) as {
        result: {
          lifecycle_state: string;
          next_action: {
            kind: string;
            command: string;
            completed_operation: string;
            reason_code: string;
          };
        };
      };

      expect(staged.result).not.toHaveProperty("execution_mode");
      expect(staged.result.lifecycle_state).toBe("confirmed");
      expect(staged.result.next_action).toMatchObject({
        kind: "reevaluate_workspace_route",
        command: "context status --managed --format json",
        completed_operation: "align:file:product-docs:architecture",
        reason_code: "prose-align-structure-confirmed",
      });
      const structure = YAML.parse(readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), "utf8")) as {
        lifecycle: { state: string; confirmed_by?: string };
      };
      expect(structure.lifecycle).toMatchObject({ state: "confirmed", confirmed_by: "managed-session" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
