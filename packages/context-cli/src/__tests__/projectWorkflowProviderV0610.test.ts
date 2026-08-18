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
import { renderContextWorkflowResource } from "../project/workflow/workflowResource.js";
import type { ProjectStatus } from "../project/statusTypes.js";
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

  test("managed authority excludes source reads and the gate returns an explicit conversation-scoped resume command", async () => {
    const authorities = contextWorkflowAuthorities({ managed: true });
    expect(authorities).toContain(
      CONTEXT_WORKFLOW_AUTHORITIES.knowledgeReview,
    );
    expect(authorities).not.toContain(
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
    };
    const facts = createContextWorkflowFacts(captureObservation, authorities);
    expect(facts.gates.source_read_resolved).toBe(false);
    const snapshot = await evaluateContextWorkflow({
      observation: captureObservation,
      authorities,
    });
    expect(snapshot.route).toMatchObject({
      node: "authorize-document-capture",
      availability: "requires-user",
      commands: [{
        command:
          "context run --managed --authority 'context.source-read' --until blocked-or-complete --format json",
        effect: "external",
        availability: "after-human-confirmation",
        managed_execution: "agent-required",
        execution: { target: "agent-host" },
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

  test("a build receipt cannot hide an unclassified captured document", () => {
    const observation = emptyObservation();
    const facts = createContextWorkflowFacts({
      ...observation,
      sourceCount: 1,
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
      capturedDocumentSources: 1,
      unclassifiedDocumentTargets: [{
        sourceKey: "file:manual",
        capturePhaseId: "capture:file:manual",
        command: "context run capture:file:manual --view read-plan --format json",
      }],
      approvedPages: 1,
      close: { state: "ready", diagnostics: [] },
      packages: [{
        kind: "package.kb",
        name: "knowledge",
        reads: [],
        writes: [],
        template: { path: "src/package-templates/kb" },
        outDir: "dist/knowledge",
        navigation: { foldDirectoryIndexes: true, maxInlineEntries: 50 },
      }],
      packageFreshness: [{
        name: "knowledge",
        kind: "kb",
        state: "ready",
        inputFiles: 1,
        outputFiles: 1,
      }],
    }, []);
    expect(facts.documents.classified).toBe(false);
    expect(facts.packages.current).toBe(true);
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
        `context --workflow-revision '${snapshot.evaluation.revision}' source add batch --input - --format json`,
      effect: "write",
      availability: "after-human-confirmation",
      managed_execution: "automatic",
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

  test("the structure confirmation view includes its staged target", () => {
    const content = renderContextWorkflowResource(
      "context.structure-current",
      {
        stagedStructure: {
          state: "draft",
          sourceKeys: ["file:manual-b"],
          collections: ["guide"],
          structureDigest: `sha256:${"a".repeat(64)}`,
          nodeCount: 2,
          viewCount: 2,
          sectionCount: 5,
          sourceRefCount: 5,
          edgeCount: 1,
          unresolvedCount: 0,
          diagnostics: [],
        },
        activeStructures: {
          state: "ready",
          count: 1,
          slotCount: 1,
          sourceKeys: ["file:manual-a"],
          collections: ["guide"],
          structureDigests: [`sha256:${"b".repeat(64)}`],
          slots: [{
            sourceKey: "file:manual-a",
            collection: "guide",
            structureDigest: `sha256:${"b".repeat(64)}`,
            snapshotReady: true,
          }],
          diagnostics: [],
        },
        structureBatch: {
          state: "structures-active",
          sourceCount: 1,
          slotCount: 1,
          slots: [],
        },
        configurationGaps: [],
      } as unknown as ProjectStatus,
    );
    expect(content).toContain("## Staged confirmation target");
    expect(content).toContain("`file:manual-b`");
    expect(content).toContain("2 node(s), 2 view(s), 5 section(s), 5 source ref(s)");
    expect(content).toContain("## Active confirmed slots");
    expect(content).toContain("`file:manual-a`");
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

  test("code extraction inspection returns one executable technology probe per repo source", () => {
    expect(planForHostHandler("context.extract.inspect-capabilities", {
      ...emptyObservation(),
      sourceCount: 2,
      repoSources: [
        { id: "repo-a", name: "20260818/module-a" },
        { id: "repo-b", name: "20260818/module-b" },
      ],
      readyRepoSources: 2,
    })).toEqual({
      commands: [
        {
          command: 'context source inspect "20260818/module-a" --format json',
          effect: "read",
          availability: "immediate",
          managed_execution: "agent-required",
        },
        {
          command: 'context source inspect "20260818/module-b" --format json',
          effect: "read",
          availability: "immediate",
          managed_execution: "agent-required",
        },
      ],
    });
  });

  test("package configuration exposes a compact, typed choice contract", async () => {
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
        close: { state: "ready", diagnostics: [] },
      },
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.packageOutput],
    });
    expect(snapshot.route).toMatchObject({
      node: "configure-package-output",
      commands: [],
      configuration: {
        file: "src/index.ts",
        contract: {
          target: "package-output",
          choices: [
            expect.objectContaining({
              id: "agent-knowledge-base",
              factory: "kbPackage",
            }),
            expect.objectContaining({ id: "llm-text", factory: "llmsPackage" }),
            expect.objectContaining({ id: "none", factory: null }),
          ],
          resource_delivery: {
            applies_to: "agent-knowledge-base",
            recommendation: "git-raw with local Git or an explicit raw URL prefix; otherwise bundle",
            choices: [
              expect.objectContaining({ id: "git-raw", optional: ["remote", "urlPrefix"] }),
              expect.objectContaining({ id: "bundle" }),
              expect.objectContaining({ id: "omit" }),
            ],
          },
          after_edit: "context status --format json",
        },
      },
    });
  });

  test("ambiguous compile ownership has a typed root diagnostic and configuration recovery", async () => {
    const snapshot = await evaluateContextWorkflow({
      observation: {
        ...emptyObservation(),
        compilePhaseResolution: {
          state: "ambiguous",
          requestedSourceKeys: ["file:manual"],
          requestedCollections: ["guide"],
          requestedTargets: [{
            sourceKey: "file:manual",
            collections: ["guide"],
          }],
          matches: [
            {
              phaseId: "compile:file:manual:guide-a",
              sourceKey: "file:manual",
              collection: "guide",
              command:
                "context run compile:file:manual:guide-a --format json",
            },
            {
              phaseId: "compile:file:manual:guide-b",
              sourceKey: "file:manual",
              collection: "guide",
              command:
                "context run compile:file:manual:guide-b --format json",
            },
          ],
          missingCollections: [],
          ambiguousCollections: ["guide"],
        },
      },
      authorities: [],
    });
    expect(snapshot.route).toMatchObject({
      node: "repair-workspace-state",
      commands: [],
      configuration: {
        file: "src/index.ts",
      },
    });
    expect(snapshot.rootDiagnostics).toContainEqual(expect.objectContaining({
      code: "diagnostic.compile-route-ambiguous",
      count: 1,
      details_resource: expect.objectContaining({
        id: "diagnostic.workspace-state",
        kind: "diagnostic",
      }),
    }));
  });

  test("missing structure snapshots cannot collapse into an untyped invalid state", async () => {
    const snapshot = await evaluateContextWorkflow({
      observation: {
        ...emptyObservation(),
        compileBatch: {
          collection: "guide",
          structureDigest: "sha256:missing",
          structureDigests: ["sha256:missing"],
          missingStructureDigests: ["sha256:missing"],
          plannedViewRefs: [],
          draftViewRefs: [],
          approvedViewRefs: [],
          rejectedViewRefs: [],
          staleViewRefs: [],
          staleSourceKeys: [],
          remainingViewRefs: [],
          readyForReview: false,
          complete: false,
        },
      },
      authorities: [],
    });
    expect(snapshot.route).toMatchObject({
      node: "repair-workspace-state",
      commands: [],
      configuration: {
        file: "src/index.ts",
      },
    });
    expect(snapshot.rootDiagnostics).toContainEqual(expect.objectContaining({
      code: "diagnostic.structure-snapshot-missing",
      count: 1,
      details_resource: expect.objectContaining({
        id: "diagnostic.workspace-state",
      }),
    }));
  });
});
