import { expect, test } from "bun:test";
import { evaluateContextWorkflow } from "../project/workflow/workflowProvider.js";
import { CONTEXT_WORKFLOW_AUTHORITIES, type ContextWorkflowObservation } from "../project/workflow/workflowTypes.js";
import { emptyObservation } from "./projectWorkflowProviderV0610.fixtures.js";

function captureObservation(): ContextWorkflowObservation {
  return {
    ...emptyObservation(),
    taskPreparation: "cleared",
    sourceCount: 2,
    documentSources: ["first", "second"].map(name => ({
      type: "file", name, materializedAt: `sources/file/${name}`,
      manifest: `sources/file/${name}/manifest.json`, snapshotReady: false,
      diagnostics: [], agent_hints: [], workspaceDiagnostics: [],
    })),
    pendingCaptureCommands: ["context run capture:file:first", "context run capture:file:second"],
  };
}

test("cleared workspaces capture named registered documents without resuming production", async () => {
  const observation = captureObservation();
  const unauthorized = await evaluateContextWorkflow({ observation, authorities: [] });
  expect(unauthorized.route?.node).toBe("authorize-document-capture");
  const authorities = [CONTEXT_WORKFLOW_AUTHORITIES.sourceRead];
  const first = await evaluateContextWorkflow({ observation, authorities });
  expect(first.route?.node).toBe("capture-next");
  expect(first.route?.commands[0]?.command).toContain("capture:file:first");
  const afterFirst = {
    ...observation, capturedDocumentSources: 1,
    documentSources: observation.documentSources.map((source, i) => ({ ...source, snapshotReady: i === 0 })),
    pendingCaptureCommands: ["context run capture:file:second"],
  };
  const second = await evaluateContextWorkflow({ observation: afterFirst, authorities });
  expect(second.route?.node).toBe("capture-next");
  expect(second.route?.commands[0]?.command).toContain("capture:file:second");
  const completed = await evaluateContextWorkflow({ observation: {
    ...observation, capturedDocumentSources: 2,
    documentSources: observation.documentSources.map(source => ({ ...source, snapshotReady: true })),
    pendingCaptureCommands: [],
  }, authorities });
  expect(completed.route?.node).toBe("reopen-cleared-task");
  expect(completed.route?.availability).toBe("requires-user");
  expect(observation.taskPreparation).toBe("cleared");
  expect(observation.productionState).toBeUndefined();
});

test("capture-only guidance does not grant source permission or hide configuration failures", async () => {
  const observation = captureObservation();
  const missing = await evaluateContextWorkflow({ observation: {
    ...observation, missingCaptureSources: [observation.documentSources[1]!],
  }, authorities: [CONTEXT_WORKFLOW_AUTHORITIES.sourceRead] });
  expect(missing.route?.node).toBe("configure-document-capture");
  const noPermission = await evaluateContextWorkflow({ observation, authorities: [] });
  expect(noPermission.route?.node).toBe("authorize-document-capture");
  expect(noPermission.route?.availability).toBe("requires-user");
});
