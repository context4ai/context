/** Provider capabilities, not a vocabulary for the user's natural-language purpose. */
export interface CodePageProjection {
  documentKind: string;
  readerGoal: string;
}

const usage = { documentKind: "usage-guide", readerGoal: "integrate-capability" };
const reference = { documentKind: "public-api-reference", readerGoal: "look-up-public-contract" };
const maintenance = { documentKind: "maintenance-guide", readerGoal: "modify-or-diagnose-module" };
const task = { documentKind: "page-task-guide", readerGoal: "develop-page-task" };
const federation = { documentKind: "federation-guide", readerGoal: "integrate-host-and-remote" };
const adapter = { documentKind: "request-adaptation-guide", readerGoal: "maintain-request-boundary" };
const operation = { documentKind: "task-runtime-guide", readerGoal: "operate-or-extend-task" };

export const CODE_PROFILE_PROJECTIONS: Readonly<Record<string, readonly CodePageProjection[]>> = {
  "monorepo-container": [usage, maintenance],
  "component-library": [usage, reference, maintenance],
  "sdk-library": [usage, reference, maintenance],
  "web-application": [task, federation, maintenance],
  "cli-tool": [usage, reference, maintenance],
  "plugin-extension": [usage, reference, maintenance],
  "api-service": [reference, maintenance],
  "gateway-facade": [reference, adapter, maintenance],
  "domain-service": [reference, maintenance],
  "background-runtime": [operation, maintenance],
  "event-consumer": [operation, maintenance],
  "data-sync-reconciliation": [operation, maintenance],
  "storage-repository": [reference, maintenance],
  "adapter-integration": [usage, adapter, maintenance],
  "contract-source": [reference, usage],
  "derived-generated-source": [reference, usage],
};
