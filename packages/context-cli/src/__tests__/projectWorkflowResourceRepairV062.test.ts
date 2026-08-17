import { describe, expect, test } from "bun:test";
import { LARK_DOCUMENT_NORMALIZER_VERSION } from "../project/documentCaptureContract.js";
import {
  pendingDocumentCaptureCommands,
  resourcePlaceholderRepairTargets,
} from "../project/status.js";
import { createContextWorkflowFacts } from "../project/workflow/workflowFacts.js";
import { evaluateContextWorkflow } from "../project/workflow/workflowProvider.js";
import {
  CONTEXT_WORKFLOW_AUTHORITIES,
  type ContextWorkflowObservation,
} from "../project/workflow/workflowTypes.js";
import { emptyObservation } from "./projectWorkflowProviderV0610.fixtures.js";

function declaredProseRow(sourceKey: string, collection = "sop") {
  return {
    sourceKey,
    collection,
    capture: "declared" as const,
    align: "declared" as const,
    compile: "declared" as const,
    review: "declared" as const,
    gaps: [],
    suggestions: [],
  };
}

describe("Context workflow resource repair", () => {
  test("unprojected source asset paths route to deterministic close repair", async () => {
    const observation: ContextWorkflowObservation = {
      ...emptyObservation(),
      approvedPages: 1,
      close: { state: "ready", diagnostics: [] },
      verifyErrors: 1,
      verifyIssues: [{
        severity: "error",
        code: "approved-resource-source-path-unprojected",
        path: "guides/example.md",
        message: "approved Markdown still references a source-snapshot asset path",
      }],
    };
    const snapshot = await evaluateContextWorkflow({ observation, authorities: [] });
    expect(snapshot.route).toMatchObject({
      node: "close-approved-knowledge",
      reason_code: "route.close.projection-stale",
    });
    expect(snapshot.route?.commands[0]?.command).toContain("close --format json");
  });

  test("missing registered document snapshots route to recapture before stale verification findings", async () => {
    const observation: ContextWorkflowObservation = {
      ...emptyObservation(),
      sourceCount: 1,
      documentSources: [{
        type: "lark",
        name: "20260812/reference",
        materializedAt: "sources/lark/20260812",
        manifest: "sources/lark/20260812/manifest.json",
        snapshotReady: false,
        diagnostics: ["snapshot is missing"],
        agent_hints: [],
        workspaceDiagnostics: [],
      }],
      pendingCaptureCommands: ["context run capture:lark:20260812/reference"],
      verifyErrors: 1,
      verifyIssues: [{
        severity: "error",
        code: "source-document-missing",
        message: "document snapshot is unavailable",
      }],
    };
    const facts = createContextWorkflowFacts(observation, [CONTEXT_WORKFLOW_AUTHORITIES.sourceRead]);
    expect(facts.verification.blocking_clear).toBe(true);
    expect(facts.evidence.maintenance_clear).toBe(true);
    const snapshot = await evaluateContextWorkflow({
      observation,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.sourceRead],
    });
    expect(snapshot.route).toMatchObject({
      node: "capture-next",
      reason_code: "route.capture.pending-target",
    });
    expect(snapshot.route?.commands[0]?.command).toContain("run capture:lark:20260812/reference --format json");
    expect(snapshot.rootDiagnostics).not.toContainEqual(expect.objectContaining({
      code: "diagnostic.verify-failed",
    }));
  });

  test("source recapture precedes unfinished compilation from an existing prose round", async () => {
    const observation: ContextWorkflowObservation = {
      ...emptyObservation(),
      sourceCount: 1,
      documentSources: [{
        type: "file",
        name: "manual",
        materializedAt: "sources/file/manual",
        manifest: "sources/file/manual/manifest.json",
        snapshotReady: false,
        diagnostics: ["snapshot linked asset is stale"],
        agent_hints: [],
        workspaceDiagnostics: [],
      }],
      pendingCaptureCommands: ["context run capture:file:manual"],
      activeStructures: {
        state: "ready",
        count: 1,
        slotCount: 1,
        sourceKeys: ["file:manual"],
        collections: ["sop"],
        structureDigests: ["sha256:structure"],
        slots: [],
        diagnostics: [],
      },
    };
    const facts = createContextWorkflowFacts(observation, [CONTEXT_WORKFLOW_AUTHORITIES.sourceRead]);
    expect(facts.resume.compile_complete).toBe(true);
    expect(facts.capture.complete).toBe(false);
    const snapshot = await evaluateContextWorkflow({
      observation,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.sourceRead],
    });
    expect(snapshot.route).toMatchObject({
      node: "capture-next",
      reason_code: "route.capture.pending-target",
    });
    expect(snapshot.route?.commands[0]?.command).toContain("run capture:file:manual --format json");
  });

  test("resource placeholder verification routes through recapture and recompilation before Review", async () => {
    const issue = {
      severity: "error" as const,
      code: "approved-resource-placeholder-unresolved",
      path: "guides/example.md",
      view_ref: "sop:action/example",
      source_keys: ["lark:20260812/reference"],
      message: "approved Markdown still contains a required Lark resource placeholder",
    };
    expect(resourcePlaceholderRepairTargets([issue])).toEqual({
      sourceKeys: ["lark:20260812/reference"],
      viewRefs: ["sop:action/example"],
    });

    const repairSource = {
      type: "lark" as const,
      name: "20260812/reference",
      materializedAt: "sources/lark/20260812",
      manifest: "sources/lark/20260812/manifest.json",
      snapshotReady: true,
      normalizerVersion: "legacy-normalizer",
      diagnostics: [],
      agent_hints: [],
      workspaceDiagnostics: [],
    };
    expect(pendingDocumentCaptureCommands({
      phases: [],
      documentSources: [repairSource],
      recaptureSourceKeys: ["lark:20260812/reference"],
    }).missingSources).toEqual([repairSource]);
    expect(pendingDocumentCaptureCommands({
      phases: [],
      documentSources: [{ ...repairSource, normalizerVersion: LARK_DOCUMENT_NORMALIZER_VERSION }],
      recaptureSourceKeys: ["lark:20260812/reference"],
    }).missingSources).toEqual([]);

    const base: ContextWorkflowObservation = {
      ...emptyObservation(),
      sourceCount: 1,
      capturedDocumentSources: 1,
      documentSources: [{
        type: "lark",
        name: "20260812/reference",
        materializedAt: "sources/lark/20260812",
        manifest: "sources/lark/20260812/manifest.json",
        snapshotReady: true,
        normalizerVersion: repairSource.normalizerVersion,
        diagnostics: [],
        agent_hints: [],
        workspaceDiagnostics: [],
      }],
      verifyErrors: 1,
      verifyIssues: [issue],
    };
    const recapture = {
      ...base,
      pendingCaptureCommands: ["context run capture:lark:20260812/reference"],
    };
    const recaptureSnapshot = await evaluateContextWorkflow({ observation: recapture, authorities: [] });
    expect(recaptureSnapshot.route).toMatchObject({
      node: "repair-verification",
      reason_code: "route.verify.failed",
    });
    expect(recaptureSnapshot.route?.commands[0]?.command).toContain(
      "run capture:lark:20260812/reference --format json",
    );

    const compileBatch = {
      collection: "sop",
      structureDigest: "sha256:structure",
      structureDigests: ["sha256:structure"],
      missingStructureDigests: [],
      plannedViewRefs: ["sop:action/example"],
      draftViewRefs: [],
      approvedViewRefs: ["sop:action/example"],
      rejectedViewRefs: [],
      staleViewRefs: [],
      staleSourceKeys: [],
      remainingViewRefs: ["sop:action/example"],
      nextViewRef: "sop:action/example",
      nextSourceKeys: ["lark:20260812/reference"],
      nextCollection: "sop",
      readyForReview: false,
      complete: false,
    };
    const recompile: ContextWorkflowObservation = {
      ...base,
      compileBatch,
      compileDocumentNext: "context run compile:lark:20260812/reference:sop --stage --format json",
    };
    const recompileSnapshot = await evaluateContextWorkflow({ observation: recompile, authorities: [] });
    expect(recompileSnapshot.route?.commands[0]?.command).toContain(
      "run compile:lark:20260812/reference:sop --stage --format json",
    );

    const readyForReview: ContextWorkflowObservation = {
      ...base,
      draftCandidates: 1,
      draftCollections: ["sop"],
      compileBatch: {
        ...compileBatch,
        draftViewRefs: ["sop:action/example"],
        remainingViewRefs: [],
        readyForReview: true,
        complete: false,
      },
    };
    expect(createContextWorkflowFacts(readyForReview, []).verification.blocking_clear).toBe(true);

    const replacementBatch: ContextWorkflowObservation = {
      ...readyForReview,
      evidenceWarnings: "stale",
      activeStructures: {
        state: "ready",
        count: 1,
        slotCount: 1,
        sourceKeys: ["lark:20260812/reference"],
        collections: ["sop"],
        structureDigests: ["sha256:structure"],
        slots: [{
          sourceKey: "lark:20260812/reference",
          collection: "sop",
          structureDigest: "sha256:structure",
          snapshotReady: true,
          snapshotCurrent: true,
          phaseCollection: "sop",
        }],
        diagnostics: [],
      },
      declarationGraph: {
        rows: [declaredProseRow("lark:20260812/reference")],
        gaps: [],
        unresolvedPhases: [],
        resolvedPhases: [],
      },
      verifyErrors: 4,
      verifyIssues: [{
        severity: "error",
        code: "entity-id-duplicate",
        view_ref: "sop:action/example",
        message: "candidate id also exists in the lifecycle ledger",
      }, issue, {
        severity: "error",
        code: "approved-source-ref-stale",
        source_keys: ["lark:20260812/reference"],
        message: "approved source ref is stale",
      }, {
        severity: "error",
        code: "approved-structure-input-hash-mismatch",
        message: "approved structure projection is stale",
      }],
    };
    expect(createContextWorkflowFacts(replacementBatch, []).verification.blocking_clear).toBe(true);
    expect((await evaluateContextWorkflow({ observation: replacementBatch, authorities: [] })).route)
      .toMatchObject({
        node: "resume-review-current-batch",
        reason_code: "route.review.decision-required",
      });
  });

  test("pending prose targets repair matching source drift before verification repeats", async () => {
    const sourceKey = "lark:20260812/reference";
    const target = {
      sourceKey,
      collection: "sop",
      alignPhaseId: "align:lark:20260812/reference:sop",
      command: "context run align:lark:20260812/reference:sop --view read-plan --format json",
      payloadTarget: ".tmp/agent-payloads/reference-structure.yaml",
      configurationGaps: [],
      suggestions: [],
    };
    const observation: ContextWorkflowObservation = {
      ...emptyObservation(),
      sourceCount: 1,
      capturedDocumentSources: 1,
      documentSources: [{
        type: "lark",
        name: "20260812/reference",
        materializedAt: "sources/lark/20260812",
        manifest: "sources/lark/20260812/manifest.json",
        snapshotReady: true,
        diagnostics: [],
        agent_hints: [],
        workspaceDiagnostics: [],
      }],
      pendingStructureTargets: [target],
      evidenceWarnings: "stale",
      verifyErrors: 2,
      verifyIssues: [{
        severity: "error",
        code: "approved-source-ref-stale",
        source_keys: [sourceKey],
        message: "approved source_ref moved",
      }, {
        severity: "error",
        code: "approved-resource-placeholder-unresolved",
        source_keys: [sourceKey],
        message: "approved resource placeholder remains",
      }],
    };

    const facts = createContextWorkflowFacts(observation, []);
    expect(facts.verification.blocking_clear).toBe(true);
    expect(facts.evidence.maintenance_clear).toBe(true);
    const snapshot = await evaluateContextWorkflow({ observation, authorities: [] });
    expect(snapshot.route).toMatchObject({
      node: "align-next",
      reason_code: "route.structure.pending-target",
    });
    expect(snapshot.route?.commands[0]?.command).toContain(
      "run align:lark:20260812/reference:sop --view read-plan --format json",
    );

    const activeSourceKey = "lark:20260812/already-compiled";
    const pendingAlongsideDrafts: ContextWorkflowObservation = {
      ...observation,
      sourceCount: 2,
      capturedDocumentSources: 2,
      documentSources: [
        ...observation.documentSources,
        {
          type: "lark",
          name: "20260812/already-compiled",
          materializedAt: "sources/lark/20260812",
          manifest: "sources/lark/20260812/manifest.json",
          snapshotReady: true,
          diagnostics: [],
          agent_hints: [],
          workspaceDiagnostics: [],
        },
      ],
      draftCandidates: 1,
      draftCollections: ["sop"],
      activeStructures: {
        state: "ready",
        count: 1,
        slotCount: 1,
        sourceKeys: [activeSourceKey],
        collections: ["sop"],
        structureDigests: ["sha256:active"],
        slots: [{
          sourceKey: activeSourceKey,
          collection: "sop",
          structureDigest: "sha256:active",
          snapshotReady: true,
          snapshotCurrent: true,
          phaseCollection: "sop",
        }],
        diagnostics: [],
      },
      compileBatch: {
        collection: "sop",
        structureDigest: "sha256:active",
        structureDigests: ["sha256:active"],
        missingStructureDigests: [],
        plannedViewRefs: ["sop:action/already-compiled"],
        draftViewRefs: ["sop:action/already-compiled"],
        approvedViewRefs: ["sop:action/already-compiled"],
        rejectedViewRefs: [],
        staleViewRefs: ["sop:action/already-compiled"],
        staleSourceKeys: [],
        remainingViewRefs: [],
        replacementSourceKeys: [activeSourceKey],
        readyForReview: true,
        complete: false,
      },
      declarationGraph: {
        rows: [declaredProseRow(activeSourceKey), declaredProseRow(sourceKey)],
        gaps: [],
        unresolvedPhases: [],
        resolvedPhases: [],
      },
      verifyIssues: [{
        severity: "error",
        code: "approved-source-ref-stale",
        source_keys: [activeSourceKey],
        message: "compiled source changed",
      }, {
        severity: "error",
        code: "approved-verbatim-body-hash-mismatch",
        source_keys: [activeSourceKey],
        view_ref: "sop:action/already-compiled",
        message: "compiled source body changed",
      }, {
        severity: "error",
        code: "approved-resource-placeholder-unresolved",
        source_keys: [sourceKey],
        message: "pending source still needs alignment",
      }],
    };
    const pendingAlongsideDraftsFacts = createContextWorkflowFacts(pendingAlongsideDrafts, []);
    expect(pendingAlongsideDraftsFacts.verification.blocking_clear).toBe(true);
    expect(pendingAlongsideDraftsFacts.evidence.maintenance_clear).toBe(true);
    expect(pendingAlongsideDraftsFacts.review.batch_resolved).toBe(true);
    expect((await evaluateContextWorkflow({ observation: pendingAlongsideDrafts, authorities: [] })).route)
      .toMatchObject({ node: "resume-align-next", reason_code: "route.structure.pending-target" });

    const nextSourceKey = "lark:20260812/next-source";
    const partialCompile: ContextWorkflowObservation = {
      ...pendingAlongsideDrafts,
      pendingStructureTargets: [],
      documentSources: [
        pendingAlongsideDrafts.documentSources[1]!,
        {
          type: "lark",
          name: "20260812/next-source",
          materializedAt: "sources/lark/20260812",
          manifest: "sources/lark/20260812/manifest.json",
          snapshotReady: true,
          diagnostics: [],
          agent_hints: [],
          workspaceDiagnostics: [],
        },
      ],
      activeStructures: {
        state: "ready",
        count: 2,
        slotCount: 2,
        sourceKeys: [activeSourceKey, nextSourceKey],
        collections: ["sop"],
        structureDigests: ["sha256:active", "sha256:next"],
        slots: [{
          sourceKey: activeSourceKey,
          collection: "sop",
          structureDigest: "sha256:active",
          snapshotReady: true,
          snapshotCurrent: true,
          phaseCollection: "sop",
        }, {
          sourceKey: nextSourceKey,
          collection: "sop",
          structureDigest: "sha256:next",
          snapshotReady: true,
          snapshotCurrent: true,
          phaseCollection: "sop",
        }],
        diagnostics: [],
      },
      compileBatch: {
        collection: "sop",
        structureDigest: "multiple",
        structureDigests: ["sha256:active", "sha256:next"],
        missingStructureDigests: [],
        plannedViewRefs: ["sop:action/current", "sop:action/next"],
        draftViewRefs: ["sop:action/current"],
        approvedViewRefs: [],
        rejectedViewRefs: [],
        staleViewRefs: [],
        staleSourceKeys: [],
        remainingViewRefs: ["sop:action/next"],
        replacementSourceKeys: [activeSourceKey, nextSourceKey],
        nextViewRef: "sop:action/next",
        nextSourceKeys: [nextSourceKey],
        nextCollection: "sop",
        nextPhaseCollection: "sop",
        nextStructureCollections: ["sop"],
        readyForReview: false,
        complete: false,
      },
      declarationGraph: {
        rows: [declaredProseRow(activeSourceKey), declaredProseRow(nextSourceKey)],
        gaps: [],
        unresolvedPhases: [],
        resolvedPhases: [],
      },
      verifyIssues: [{
        severity: "error",
        code: "approved-source-ref-stale",
        view_ref: "sop:action/retired-old-view",
        source_keys: [activeSourceKey],
        message: "the current structure replaces an approved view with a new stable id",
      }, {
        severity: "error",
        code: "approved-source-ref-stale",
        view_ref: "sop:action/next",
        source_keys: [nextSourceKey],
        message: "the remaining source still needs compilation",
      }],
    };
    const partialCompileFacts = createContextWorkflowFacts(partialCompile, []);
    expect(partialCompileFacts.verification.blocking_clear).toBe(true);
    expect(partialCompileFacts.evidence.maintenance_clear).toBe(true);
    expect((await evaluateContextWorkflow({ observation: partialCompile, authorities: [] })).route)
      .toMatchObject({ node: "compile-next", reason_code: "route.compile.pending-target" });

    const unrelated = {
      ...observation,
      pendingStructureTargets: [{ ...target, sourceKey: "lark:20260812/other" }],
    };
    expect(createContextWorkflowFacts(unrelated, []).verification.blocking_clear).toBe(false);
    expect((await evaluateContextWorkflow({ observation: unrelated, authorities: [] })).route)
      .toMatchObject({ node: "repair-verification", reason_code: "route.verify.failed" });
  });
});
