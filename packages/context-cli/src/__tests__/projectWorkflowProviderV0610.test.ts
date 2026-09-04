import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { runGraphTests } from "@c4a/agent-graph";
import {
  contextWorkflowAuthorities,
  createContextWorkflowFacts,
} from "../project/workflow/workflowFacts.js";
import {
  evaluateContextWorkflow,
  loadContextWorkflowProvider,
} from "../project/workflow/workflowProvider.js";
import { planForHostHandler } from "../project/workflow/workflowHostPlans.js";
import { CONTEXT_WORKFLOW_AUTHORITIES } from "../project/workflow/workflowTypes.js";
import { emptyObservation } from "./projectWorkflowProviderV0610.fixtures.js";

describe("Context workflow Provider", () => {
  test("passes its graph contract scenarios", async () => {
    const provider = await loadContextWorkflowProvider();
    const results = await runGraphTests(
      provider,
      resolve(import.meta.dir, "../../context-workflow/tests"),
    );
    expect(results.map((result) => ({
      name: result.name,
      failures: result.failures,
    }))).toEqual(results.map((result) => ({
      name: result.name,
      failures: [],
    })));
  });

  test("keeps pre-build runtime event failures silent", async () => {
    const ordinary = await evaluateContextWorkflow({
      observation: {
        ...emptyObservation(),
        approvedPages: 1,
        close: { state: "ready", diagnostics: [] },
      },
      authorities: [],
    });
    expect(ordinary.route?.node).not.toContain("logs");

    const preClosePending = await evaluateContextWorkflow({
      observation: {
        ...emptyObservation(),
        approvedPages: 1,
        close: { state: "ready", diagnostics: [] },
        runtimeEvents: {
          configured: true,
          pending_count: 1,
          pending_kinds: ["workspace.active"],
        },
      },
      authorities: [],
    });
    expect(preClosePending.route?.node).not.toContain("logs");

    const closePending = await evaluateContextWorkflow({
      observation: {
        ...emptyObservation(),
        approvedPages: 1,
        close: { state: "ready", diagnostics: [] },
        runtimeEvents: {
          configured: true,
          pending_count: 2,
          pending_kinds: ["workspace.active", "knowledge.closed"],
        },
      },
      authorities: [],
    });
    expect(closePending.route?.node).not.toContain("logs");
  });

  test("does not let ordinary runtime log backlog invalidate the workspace revision", async () => {
    const observation = {
      ...emptyObservation(),
      sourceCount: 1,
      runtimeEvents: {
        configured: true,
        pending_count: 0,
        pending_kinds: [] as string[],
      },
    };
    const before = await evaluateContextWorkflow({
      observation,
      authorities: [],
    });
    const afterActiveDeliveryFailure = await evaluateContextWorkflow({
      observation: {
        ...observation,
        runtimeEvents: {
          configured: true,
          pending_count: 3,
          pending_kinds: ["workspace.initialized", "workspace.active", "knowledge.closed"],
        },
      },
      authorities: [],
    });

    expect(afterActiveDeliveryFailure.evaluation.revision).toBe(
      before.evaluation.revision,
    );
    expect(afterActiveDeliveryFailure.route?.id).toBe(before.route?.id);
  });

  test("routes only a failed build boundary to the final log flush", async () => {
    const packageReady = {
      ...emptyObservation(),
      sourceCount: 1,
      approvedPages: 1,
      close: { state: "ready" as const, diagnostics: [] },
      packages: [{
        kind: "package.kb" as const,
        name: "knowledge",
        reads: [],
        writes: [],
        template: { path: "src/package-templates/kb" },
        outDir: "dist/knowledge",
        navigation: { foldDirectoryIndexes: true, maxInlineEntries: 50 },
      }],
      packageFreshness: [{
        name: "knowledge",
        kind: "kb" as const,
        state: "ready" as const,
        inputFiles: 1,
        outputFiles: 1,
      }],
      packageTemplateReviews: [{
        packageName: "knowledge",
        templatePath: "src/package-templates/kb",
        state: "starter-accepted" as const,
      }],
    };
    const activeOnly = await evaluateContextWorkflow({
      observation: {
        ...packageReady,
        runtimeEvents: {
          configured: true,
          pending_count: 1,
          pending_kinds: ["workspace.active"],
        },
      },
      authorities: [],
    });
    expect(activeOnly.route).toBeUndefined();

    const buildPending = await evaluateContextWorkflow({
      observation: {
        ...packageReady,
        runtimeEvents: {
          configured: true,
          pending_count: 3,
          pending_kinds: ["workspace.active", "knowledge.closed", "package.build.completed"],
        },
      },
      authorities: [],
    });
    expect(buildPending.route).toMatchObject({
      node: "flush-logs-after-build",
      reason_code: "route.logs.delivery-pending",
    });
  });

  test("defers stale close maintenance while draft candidates await Review", () => {
    const facts = createContextWorkflowFacts({
      ...emptyObservation(),
      draftCandidates: 18,
      draftCollections: ["codegraph"],
      approvedPages: 12,
      close: { state: "stale", diagnostics: ["projection is stale"] },
    }, []);

    expect(facts.close.current).toBe(true);
    expect(facts.review.batch_resolved).toBe(false);
    expect(facts.review.gate_clear).toBe(false);
  });

  test("managed authority includes source reads and advances pending capture", async () => {
    const authorities = contextWorkflowAuthorities({ managed: true });
    expect(authorities).toContain(
      CONTEXT_WORKFLOW_AUTHORITIES.knowledgeReview,
    );
    expect(authorities).toContain(
      CONTEXT_WORKFLOW_AUTHORITIES.sourceRead,
    );

    const observation = emptyObservation();
    const captureObservation = {
      ...observation,
      sourceCount: 1,
      documentSources: [{
        type: "file" as const,
        name: "manual",
        materializedAt: "sources/file/manual",
        manifest: "sources/file/manual/manifest.json",
        snapshotReady: false,
        diagnostics: [],
        agent_hints: [],
        workspaceDiagnostics: [],
      }],
      missingCaptureSources: [],
      pendingCaptureCommands: ["context run capture:file:manual"],
    };
    const facts = createContextWorkflowFacts(captureObservation, authorities);
    expect(facts.gates.source_read_resolved).toBe(true);
    const snapshot = await evaluateContextWorkflow({
      observation: captureObservation,
      authorities,
    });
    expect(snapshot.route).toMatchObject({
      node: "capture-next",
      availability: "immediate",
      commands: [{
        command: expect.stringContaining("run capture:file:manual --format json"),
        effect: "external",
        availability: "immediate",
        managed_execution: "automatic",
      }],
    });
    const ordinarySnapshot = await evaluateContextWorkflow({
      observation: captureObservation,
      authorities: [],
    });
    expect(ordinarySnapshot.route?.commands).toEqual([{
      command: "context status --authority 'context.source-read' --format json",
      effect: "read",
      availability: "after-human-confirmation",
      managed_execution: "agent-required",
    }]);
  });

  test("routes repository work through the unique Indexer lifecycle", async () => {
    const observation = {
      ...emptyObservation(),
      sourceCount: 1,
      repoSources: [{ id: "module-a", name: "module-a" }],
      readyRepoSources: 1,
    };
    const authorities = contextWorkflowAuthorities({ managed: true });
    const facts = createContextWorkflowFacts(observation, authorities);

    expect(facts.indexer.lifecycle_current).toBe(false);

    const snapshot = await evaluateContextWorkflow({
      observation,
      authorities,
    });
    expect(snapshot.evaluation.statusCode).toBe("actionable");
    expect(snapshot.route).toMatchObject({
      node: "run-indexer-lifecycle",
      availability: "immediate",
      reason_code: "route.indexer.lifecycle-required",
      commands: [],
      action: {
        id: "run-indexer-lifecycle",
        runner: "agent",
        skill: { id: "skill.context-run-indexer-lifecycle" },
      },
    });
    expect(snapshot.route?.resources.required.map((resource) => resource.id))
      .toEqual(["skill.context-run-indexer-lifecycle"]);
  });

  test("a confirmed source boundary has a revision-bound batch command and input schema", async () => {
    const snapshot = await evaluateContextWorkflow({
      observation: emptyObservation(),
      authorities: [],
    });
    expect(snapshot.route?.node).toBe("choose-source-boundary");
    expect(snapshot.route?.availability).toBe("requires-user");
    expect(snapshot.route?.gate?.resolution_action).toMatchObject({
      id: "register-source-batch",
      effect: "write",
      input_schema: {
        id: "schema.register-source-batch.input",
        kind: "schema",
        media_type: "application/schema+json",
      },
    });
    expect(snapshot.route?.commands).toHaveLength(1);
    expect(snapshot.route?.commands[0]).toEqual({
      command:
        `context --workflow-revision '${snapshot.evaluation.revision}' source add batch --input .tmp/agent-payloads/source-batch.json --format json`,
      effect: "write",
      availability: "after-human-confirmation",
      managed_execution: "agent-required",
    });
    expect(snapshot.route?.resources.required).not.toContainEqual(
      expect.objectContaining({ id: "schema.register-source-batch.input" }),
    );
    const schema = snapshot.route?.gate?.resolution_action?.input_schema;
    expect(schema?.kind).toBe("schema");
    expect(schema?.media_type).toBe("application/schema+json");
    expect(schema?.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(schema?.path).toEndWith(
      "context-workflow/schemas/source-batch-input.schema.json",
    );
    expect(JSON.parse(await readFile(schema!.path!, "utf8"))).toMatchObject({
      title: "Context source batch input",
    });
  });

  test("managed routes use one compact current-conversation marker", async () => {
    const snapshot = await evaluateContextWorkflow({
      observation: emptyObservation(),
      authorities: contextWorkflowAuthorities({ managed: true }),
    });
    const command = snapshot.route?.commands[0]?.command ?? "";
    expect(command).toContain("--workflow-managed");
    expect(command).not.toContain("--workflow-authority");
    const materialize = snapshot.route?.resources.required.find(
      (resource) => resource.command !== undefined,
    )?.command ?? "";
    expect(materialize).toContain("--managed");
    expect(materialize).not.toContain("--authority");
  });

  test("candidate-set identity participates in the workflow revision", async () => {
    const observation = {
      ...emptyObservation(),
      draftCandidates: 1,
      draftCollections: ["architecture" as const],
      candidateSetDigest: "candidate-set-a",
    };
    const authorities = contextWorkflowAuthorities({ managed: true });
    const first = await evaluateContextWorkflow({
      observation,
      authorities,
    });
    const second = await evaluateContextWorkflow({
      observation: {
        ...observation,
        candidateSetDigest: "candidate-set-b",
      },
      authorities,
    });
    expect(first.evaluation.revision).not.toBe(second.evaluation.revision);
  });

  test("keeps final knowledge Review user-visible unless the session is fully managed", async () => {
    const observation = {
      ...emptyObservation(),
      sourceCount: 1,
      repoSources: [{ id: "module-a", name: "module-a" }],
      readyRepoSources: 1,
      draftCandidates: 2,
      draftCollections: ["architecture" as const],
      candidateSetDigest: "current-candidate-set",
      indexerRegistry: {
        state: "current" as const,
        sourceRefs: ["repo:module-a"],
      },
      indexerCandidateCompile: { state: "current" as const },
    };
    const ordinary = await evaluateContextWorkflow({ observation, authorities: [] });
    expect(ordinary.route).toMatchObject({
      node: "review-current-batch",
      availability: "requires-user",
      gate: {
        authority: CONTEXT_WORKFLOW_AUTHORITIES.knowledgeReview,
        delegatable: true,
        resolution: "user",
      },
    });
    expect(ordinary.route?.commands).toContainEqual(expect.objectContaining({
      command: expect.stringContaining("review approve-all architecture --force"),
      availability: "after-human-confirmation",
    }));

    const managed = await evaluateContextWorkflow({
      observation,
      authorities: contextWorkflowAuthorities({ managed: true }),
    });
    expect(managed.route).toMatchObject({
      node: "review-current-batch",
      availability: "immediate",
      gate: {
        authority: CONTEXT_WORKFLOW_AUTHORITIES.knowledgeReview,
        delegatable: true,
        resolution: "session-authority",
      },
    });
    expect(managed.route?.commands).toContainEqual(expect.objectContaining({
      command: expect.stringContaining("review approve-all architecture --managed"),
      availability: "immediate",
    }));
  });

  test("does not let legacy draft Candidates bypass the current Indexer compile", async () => {
    const observation = {
      ...emptyObservation(),
      sourceCount: 1,
      repoSources: [{ id: "anonymous/repo", name: "anonymous/repo" }],
      readyRepoSources: 1,
      draftCandidates: 1,
      draftCollections: ["architecture" as const],
      candidateSetDigest: "legacy-candidate-set",
      indexerRegistry: {
        state: "current" as const,
        sourceRefs: ["repo:anonymous/repo"],
      },
      indexerCandidateCompile: { state: "missing" as const },
    };
    const stale = await evaluateContextWorkflow({ observation, authorities: [] });
    expect(stale.route).toMatchObject({
      node: "run-indexer-lifecycle",
      reason_code: "route.indexer.lifecycle-required",
    });

    const current = await evaluateContextWorkflow({
      observation: {
        ...observation,
        indexerCandidateCompile: { state: "current" },
      },
      authorities: [],
    });
    expect(current.route).toMatchObject({
      node: "review-current-batch",
      reason_code: "route.review.decision-required",
    });
  });

  test("reports a close-repairable stale projection as lifecycle information", async () => {
    const snapshot = await evaluateContextWorkflow({
      observation: {
        ...emptyObservation(),
        sourceCount: 1,
        capturedDocumentSources: 1,
        documentSources: [{
          type: "file",
          name: "manual",
          materializedAt: "sources/file/manual",
          manifest: "sources/file/manual/manifest.json",
          snapshotReady: true,
          diagnostics: [],
          agent_hints: [],
          workspaceDiagnostics: [],
        }],
        approvedPages: 1,
        close: { state: "stale", diagnostics: ["projection is stale"] },
        verifyErrors: 1,
        projectionRefreshIssues: 1,
        verifyIssues: [{
          severity: "error",
          code: "approved-structure-input-hash-mismatch",
          path: "knowledge/structure.yaml",
          message: "approved structure input hash is stale",
        }],
      },
      authorities: [],
    });
    expect(snapshot.rootDiagnostics).toContainEqual(expect.objectContaining({
      code: "diagnostic.projection-stale",
      severity: "info",
      count: 1,
    }));
    expect(snapshot.rootDiagnostics).not.toContainEqual(expect.objectContaining({
      code: "diagnostic.verify-failed",
    }));
  });

  test("every Provider host Action has a registered Context adapter", async () => {
    const provider = await loadContextWorkflowProvider();
    const handlers = [...provider.actions.values()].flatMap((action) =>
      action.definition.runner === "host" &&
        action.definition.handler !== undefined
        ? [action.definition.handler]
        : []
    );
    expect(handlers.length).toBeGreaterThan(0);
    for (const handler of handlers) {
      expect(() => planForHostHandler(handler, emptyObservation())).not
        .toThrow();
    }
  });

});
