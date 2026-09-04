import { describe, expect, test } from "bun:test";
import { evaluateContextWorkflow } from "../project/workflow/workflowProvider.js";
import { CONTEXT_WORKFLOW_AUTHORITIES } from "../project/workflow/workflowTypes.js";
import { emptyObservation } from "./projectWorkflowProviderV0610.fixtures.js";

describe("Context workflow 0.7.0 routing", () => {
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
        indexerRegistry: { state: "current", sourceRefs: ["file:manual"] },
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
            recommendation:
              "bundle referenced resources by default; Context keeps each image at or below 1 MiB and all bundled images within 40 MiB, compressing package output when needed; use git-raw only when the author explicitly configures it",
            choices: [
              expect.objectContaining({ id: "bundle", default: true }),
              expect.objectContaining({ id: "git-raw", optional: ["remote", "urlPrefix"] }),
              expect.objectContaining({ id: "omit" }),
            ],
          },
          after_edit: "context status --format json",
        },
      },
    });
  });

});
