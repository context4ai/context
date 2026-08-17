import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  materializeResource,
  type ResourceReadReceiptSet,
} from "@c4a/agent-graph";
import { collectProjectStatus } from "../project/status.js";
import {
  evaluateContextWorkflow,
  loadContextWorkflowProvider,
} from "../project/workflow/workflowProvider.js";
import {
  acknowledgeCurrentWorkflowResources,
  materializeContextWorkflowResource,
  projectWorkflowResourceAcknowledgeSummary,
  renderContextWorkflowResource,
} from "../project/workflow/workflowResource.js";
import { initContextProject } from "../project/workspace.js";
import {
  emptyObservation,
  receiptPathFromCommand,
} from "./projectWorkflowProviderV0610.fixtures.js";

describe("Context workflow resources", () => {
  test("source boundary receipts survive capture progress but not boundary changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-workflow-source-boundary-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const status = await collectProjectStatus(initialized.projectRoot);
      const before = {
        ...status,
        documentSources: [{
          type: "file" as const,
          name: "docs/guide",
          local: "../docs/guide.md",
          materializedAt: "sources/file/docs",
          manifest: "sources/file/docs/manifest.json",
          snapshotReady: false,
          diagnostics: [],
          agent_hints: [],
          workspaceDiagnostics: [],
        }],
        pendingCapturePhases: ["capture:file:docs/guide"],
      };
      const after = {
        ...before,
        documentSources: before.documentSources.map((source) => ({
          ...source,
          snapshotReady: true,
          snapshotHash: "sha256:captured",
        })),
        pendingCapturePhases: [],
      };
      expect(renderContextWorkflowResource("context.source-boundary", before)).toBe(
        renderContextWorkflowResource("context.source-boundary", after),
      );
      expect(renderContextWorkflowResource("context.source-current", before)).not.toBe(
        renderContextWorkflowResource("context.source-current", after),
      );
      const moved = {
        ...after,
        documentSources: after.documentSources.map((source) => ({
          ...source,
          local: "../docs/moved-guide.md",
        })),
      };
      expect(renderContextWorkflowResource("context.source-boundary", after)).not.toBe(
        renderContextWorkflowResource("context.source-boundary", moved),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("projects revision-bound Context commands and materializes selected views", async () => {
    const observation = {
      ...emptyObservation(),
      sourceCount: 1,
      repoSources: [{ id: "module-a", name: "module-a" }],
    };
    const snapshot = await evaluateContextWorkflow({ observation, authorities: [] });
    expect(snapshot.route?.node).toBe("ensure-repository-sources");
    expect(snapshot.route?.gate?.authority).toBe("context.repository-restore");
    expect(snapshot.route?.commands.some((command) =>
      command.command.includes("source recovery-plan --format json") &&
      command.availability === "immediate"
    )).toBe(true);
    expect(snapshot.route?.commands.some((command) =>
      command.command.includes("source restore --input - --format json") &&
      command.availability === "after-human-confirmation"
    )).toBe(true);
    expect(snapshot.route?.gate?.resolution_action?.input_schema?.id).toBe(
      "schema.restore-repository-sources.input",
    );
    expect(snapshot.route?.commands[0]?.command).toContain(
      `--workflow-revision '${snapshot.evaluation.revision}'`,
    );
    const view = snapshot.route?.resources.required.find(
      (resource) => resource.id === "context.source-current",
    );
    expect(view?.command).toContain(
      `resource materialize 'context.source-current' --revision '${snapshot.evaluation.revision}'`,
    );

    const cache = await mkdtemp(join(tmpdir(), "context-workflow-view-"));
    try {
      const location = await materializeResource(
        await loadContextWorkflowProvider(),
        "context.source-current",
        {
          cache,
          workspace: cache,
          revision: snapshot.evaluation.revision,
          input: {
            schema: "context.workflow.resource-input.v1",
            revision: snapshot.evaluation.revision,
            content: "# Current source scope\n",
          },
        },
      );
      expect(location.filePath).toBeDefined();
      expect(await readFile(location.filePath!, "utf8")).toBe("# Current source scope\n");
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });

  test("materialization returns a receipt continuation for the post-read step", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-workflow-resource-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const status = await collectProjectStatus(initialized.projectRoot);
      const result = await materializeContextWorkflowResource({
        cwd: initialized.projectRoot,
        resourceId: "context.source-current",
        revision: status.workflow.revision,
      });
      expect(result.next_action).toMatchObject({ kind: "read_resource_file", path: result.path });
      expect(result.next_action.message).toContain("Materialization alone is not a read receipt");
      expect(await readFile(result.path, "utf8")).toContain("# Current source scope");
      const receiptPath = receiptPathFromCommand(result.next_action.command);
      expect(receiptPath).toMatch(
        /^\.tmp\/context-runtime\/workflow\/read-receipts\/[a-f0-9]{64}\.json$/u,
      );
      const receipts = JSON.parse(await readFile(
        join(initialized.projectRoot, receiptPath),
        "utf8",
      )) as ResourceReadReceiptSet;
      expect(receipts).toEqual({
        schema: "agent-graph.resource-read-receipts.v1",
        provider: "c4a/context",
        receipts: [{ id: result.id, digest: result.digest }],
      });
      expect(result.next_action.command).toContain(`--resource-receipts '@${receiptPath}'`);
      const reused = await collectProjectStatus(initialized.projectRoot, { resourceReceipts: receipts });
      expect(reused.workflow.current?.resources.required.find(
        (resource) => resource.id === result.id,
      )).toMatchObject({ digest: result.digest, read_state: "current" });
      expect(reused.workflow.current?.resources.required.find(
        (resource) => resource.id === result.id,
      )?.command).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("managed materialization continues through the deterministic host loop after reading", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-workflow-managed-resource-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const status = await collectProjectStatus(initialized.projectRoot, { managed: true });
      const result = await materializeContextWorkflowResource({
        cwd: initialized.projectRoot,
        resourceId: "context.source-current",
        revision: status.workflow.revision,
        managed: true,
      });
      expect(result.next_action.command).toContain("--workflow-resource-receipts");
      expect(result.next_action.command).toContain("run --managed --until blocked-or-complete --format json");
      expect(result.next_action.command).not.toContain("context status");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("acknowledges all direct required files with one receipt continuation", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-workflow-acknowledge-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const status = await collectProjectStatus(initialized.projectRoot);
      const directRequired = status.workflow.current?.resources.required.filter(
        (resource) => resource.path !== undefined &&
          resource.digest !== undefined &&
          resource.read_state === "read-required",
      ) ?? [];
      expect(directRequired.length).toBeGreaterThan(0);
      expect(status.workflow.current?.resources.after_read).toMatchObject({
        required_count: directRequired.length,
        command: expect.stringContaining("resource acknowledge-current"),
      });

      const result = await acknowledgeCurrentWorkflowResources({
        cwd: initialized.projectRoot,
        revision: status.workflow.revision,
      });
      expect(result.resourceAcknowledgement.acknowledged).toBe(directRequired.length);
      const receiptPath = result.resourceAcknowledgement.receiptReference.slice(1);
      const receipts = JSON.parse(await readFile(
        join(initialized.projectRoot, receiptPath),
        "utf8",
      )) as ResourceReadReceiptSet;
      expect(receipts).toMatchObject({
        schema: "agent-graph.resource-read-receipts.v1",
        provider: "c4a/context",
      });
      expect(receipts.receipts).toHaveLength(directRequired.length);
      expect(result.workflow.current?.resources.required.filter(
        (resource) => directRequired.some((item) => item.id === resource.id),
      ).every((resource) => resource.read_state === "current")).toBe(true);
      expect(result.workflow.current?.resources.after_read).toBeUndefined();
      expect(result.workflow.current?.resources.required.find(
        (resource) => resource.command !== undefined,
      )?.command).toContain(`--resource-receipts '@${receiptPath}'`);
      const summary = projectWorkflowResourceAcknowledgeSummary(result);
      expect(summary).toMatchObject({
        protocol: "context.workflow.resource-acknowledgement.v1",
        resourceAcknowledgement: {
          acknowledged: directRequired.length,
          receiptReference: `@${receiptPath}`,
        },
        workflow: {
          revision: result.workflow.revision,
        },
      });
      expect(summary).not.toHaveProperty("diagnostics");
      expect(summary).not.toHaveProperty("documentSources");
      expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(result).length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("marks route resources current only for matching conversation receipts", async () => {
    const first = await evaluateContextWorkflow({ observation: emptyObservation(), authorities: [] });
    const staticResource = first.route!.resources.required.find(
      (resource) => resource.digest !== undefined && resource.command === undefined,
    )!;
    const dynamicResource = first.route!.resources.required.find(
      (resource) => resource.command !== undefined,
    )!;
    expect(staticResource.read_state).toBe("read-required");
    expect(dynamicResource.read_state).toBe("read-required");

    const current = await evaluateContextWorkflow({
      observation: emptyObservation(),
      authorities: [],
      resourceReceipts: {
        schema: "agent-graph.resource-read-receipts.v1",
        provider: "c4a/context",
        receipts: [
          { id: staticResource.id, digest: staticResource.digest! },
          {
            id: dynamicResource.id,
            digest: `sha256:${"1".repeat(64)}`,
            revision: first.evaluation.revision,
          },
        ],
      },
    });
    expect(current.route?.resources.required.find(
      (resource) => resource.id === staticResource.id,
    )?.read_state).toBe("current");
    expect(current.route?.resources.required.find(
      (resource) => resource.id === dynamicResource.id,
    )?.read_state).toBe("current");

    const stale = await evaluateContextWorkflow({
      observation: emptyObservation(),
      authorities: [],
      resourceReceipts: {
        schema: "agent-graph.resource-read-receipts.v1",
        provider: "c4a/context",
        receipts: [{
          id: dynamicResource.id,
          digest: `sha256:${"2".repeat(64)}`,
          revision: `sha256:${"3".repeat(64)}`,
        }],
      },
    });
    expect(stale.route?.resources.required.find(
      (resource) => resource.id === dynamicResource.id,
    )?.read_state).toBe("read-required");
  });
});
