import type { ArticleScenario } from "./articleCodeScenarios.fixture.js";

export const ARTICLE_DOCUMENT_SCENARIOS: ArticleScenario[] = [
  { id: "business-domain", sourceType: "file", profile: "domain-reference", source: `# Order domain
The customer drafts an order; an editor submits it. Drafts can be changed, submitted orders cannot be edited.
The order frontend invokes the order API. The API validates the order and writes through the order repository.
A failed validation returns to the draft without creating a submission. The repository is the storage boundary.
This document defines the agreed business process; it is not runtime telemetry or a code-execution trace.
`, articles: [
    { type: "c02", title: "Order business overview", task: "Identify actors and supported business scope", slots: {
      goals: "manual.md describes drafting and submitting an order. It is an agreed process document, not a measurement of current traffic.",
      actors: "Customers draft orders; editors submit them. The document does not define an administrator override." } },
    { type: "d01", title: "Order service responsibilities", task: "Find the responsible layer from a business question", slots: {
      services: "manual.md assigns interaction to the frontend, validation to the API and persistence to the repository.",
      collaboration: "Follow frontend → order API → repository as a documented investigation route. Confirm actual calls in each authorized code source before claiming an executed trace." } },
    { type: "d02", title: "Order submission journey", task: "Find the validation failure branch", slots: {
      trigger: "An editor submits a draft according to manual.md.",
      branches: "Validation failure leaves the item in draft and does not create a submission. Successful validation reaches the repository boundary." } },
    { type: "d03", title: "Order business rules", task: "Distinguish editability from an implementation detail", slots: {
      conditions: "manual.md permits changes to drafts and forbids editing submitted orders.",
      implementation: "The source assigns validation to the API but supplies no implementation coordinates. Locate the authorized API handler to check enforcement; do not invent a function name." } },
  ] },
  { id: "product-requirement", sourceType: "file", profile: "product-requirements", source: `# Saved filter proposal
Status: proposed, not shipped. Analysts may save a named filter and reuse it later.
The owner can rename a filter. Shared editing is outside this proposal.
Prerequisite: an analyst owns the filter. Rename by editing its label; empty labels must be rejected. This is a proposal, not observed behavior.
Acceptance: a saved filter reopens the same conditions; a rename does not change its conditions.
`, articles: [
    { type: "c02", title: "Saved filter product proposal", task: "Understand the feature without claiming it is shipped", slots: {
      goals: "manual.md proposes named saved filters for analysts. The status is proposed; no shipped behavior or code is supplied.",
      prerequisites: "The proposed operation requires the analyst to own the filter.",
      operations: "Edit the saved filter label to rename it; conditions are expected to remain unchanged.",
      exceptions: "The proposal requires empty labels to be rejected; shared editing is out of scope.",
      acceptance: "Verify that reopening and renaming preserve conditions before reporting the proposal implemented.",
      capabilities: "The proposed owner can rename a filter. Shared editing is explicitly outside scope. Acceptance requires unchanged conditions after reopening or renaming." } },
    { type: "c03", title: "Saved filter terms", task: "Distinguish a filter name from its conditions", slots: {
      terms: "manual.md uses name for the editable label and conditions for the saved query state.",
      distinctions: "Renaming changes the label only in the proposal. This is an acceptance requirement, not proof of current implementation." } },
  ] },
  { id: "engineering-guide", sourceType: "file", profile: "technical-guide", source: `# Local worker engineering guide
Use WORKER_CONCURRENCY=1 in the isolated development environment. Observe queue depth and retry count.
To recover a blocked local worker, stop it, correct configuration and restart it. Verify that the queue decreases.
Plugins receive a request context at registration. Register tracing before the handler plugin. Dispose the returned subscriptions on shutdown.
These are documented development instructions; no production settings or successful execution logs are included.
`, articles: [
    { type: "d04", title: "Local worker operations", task: "Find configuration and a concrete recovery check", slots: {
      environment: "manual.md describes an isolated development worker with WORKER_CONCURRENCY=1. It does not establish a production value.",
      recovery: "Stop the local worker, correct configuration, restart, then verify queue depth decreases. A stated procedure is not an execution result." } },
    { type: "l04", title: "Worker plugin contract", task: "Find ordering, context and cleanup responsibilities", slots: {
      registration: "manual.md requires tracing registration before the handler plugin and passes a request context to plugins.",
      cleanup: "Dispose returned subscriptions during shutdown. Locate the host implementation before attributing a leak or ordering failure to a specific function." } },
  ] },
  { id: "public-library-guide", sourceType: "file", profile: "user-and-developer-guide", source: `# Sample UI and client library
The @example/ui package exports Button and notify. Button accepts disabled=false and onPress.
notify.open(message) returns a handle with close(). The caller closes it when its owning view is disposed.
The @example/client package exports createClient({baseUrl}); use its getOrder(id) operation to request an order.
Install the packages used by the application. A ThemeProvider supplies tokens to UI descendants.
Theme spacing.sm maps to 8px in the web theme. The native mapping is not supplied. Do not copy web values as native defaults.
The library catalog is Button, notify and the client entry. The guide describes usage; implementation and rollout records are separate.
`, articles: [
    { type: "l01", title: "Order client usage", task: "Locate the public client setup and operation", slots: {
      purpose: "manual.md documents @example/client createClient({baseUrl}) and getOrder(id).",
      installation: "Provide the application's intended baseUrl before invoking getOrder. Consult the client implementation and remote contract for retries, authentication and response fields." } },
    { type: "l02", title: "Button and notification contracts", task: "Preserve declarative and imperative component APIs", slots: {
      purpose: "manual.md documents Button disabled=false and onPress, plus the imperative notify.open(message) API.",
      behavior: "notify.open returns a handle with close(). The owner closes it on view disposal. Do not reduce this imperative lifecycle to a Props table." } },
    { type: "l03", title: "Library theme adoption", task: "Find token mapping and platform boundaries", slots: {
      consumption: "manual.md requires ThemeProvider for UI descendants and documents spacing.sm → 8px in the web theme.",
      platforms: "No native mapping is supplied. Follow the platform's authoritative theme source instead of presenting the web value as a universal default." } },
    { type: "l05", title: "Sample library entry", task: "Find package-level setup and component/API entries", slots: {
      packages: "manual.md separates @example/ui from @example/client. Install the packages used by the application; do not infer a single combined package.",
      catalog: "The documented entries are Button, notify and createClient. Shared ThemeProvider setup belongs at the library level; per-component behavior stays with its API entry." } },
  ] },
  { id: "decision-record", sourceType: "file", profile: "decision-record", source: `# ADR: bounded retries
Decision accepted for the worker prototype: retry a failed item at most three times, then retain it for manual review.
Unlimited retry was rejected because one permanently invalid item could monopolize the queue.
Follow-up: implement the attempt counter and test exhaustion. This record is accepted intent, not proof that code has been changed.
`, articles: [
    { type: "c06", title: "Bounded retry decision", task: "Separate accepted intent, alternatives and implementation follow-up", slots: {
      decision: "manual.md accepts at most three retries for the prototype before manual review. It does not prove implementation completion.",
      alternatives: "Unlimited retry was rejected because a permanently invalid item could monopolize the queue.",
      followup: "Implement the attempt counter and test retry exhaustion; retain the distinction between the decision and verified behavior." } },
  ] },
  { id: "quality-validation", sourceType: "file", profile: "test-validation", source: `# Order validation plan and recorded run
Long-term strategy: cover draft editing, submission validation and role boundaries. For change fixture-2, additionally check rename preserving filter conditions.
Smoke baseline: select ORD-01 for draft submission in sandbox-a. For rename changes include ORD-02 and the filter preservation check; the latter has no recorded result. Prerequisite: disposable test data and editor role. Results are recorded under fixture-run-2.
Formal cases: ORD-01 editor submits a valid draft; ORD-02 validation failure retains the draft. Candidate scenario: concurrent submission, not yet a formal case.
Run fixture-2 in isolated environment sandbox-a: ORD-01 passed, ORD-02 failed. Evidence: run record fixture-run-2, failure validation-state-retained.
This run does not approve release. Fix the failure and rerun ORD-02. Concurrent submission was not executed.
Prepare disposable orders owned by test-user-a. Remove them after the run. Do not copy production records or credentials into fixtures.
`, articles: [
    { type: "q01", title: "Order testing scope", task: "Find quality responsibilities and unresolved risk", slots: {
      scope: "manual.md covers draft editing, submission validation and role boundaries. The fixture-2 change also requires checking filter rename behavior.",
      risks: "Concurrent submission is only a candidate scenario. It has no execution result or approved coverage claim." } },
    { type: "q02", title: "Order test strategy and change plan", task: "Distinguish lasting strategy from the fixture-2 addition", slots: {
      scope: "manual.md separates the long-term draft/submission/roles strategy from the fixture-2 rename check.",
      acceptance: "The recorded ORD-02 failure prevents release approval. Fix it and rerun the case; a test plan alone cannot count as passing evidence." } },
    { type: "q03", title: "Order case catalog", task: "Distinguish formal cases from candidates", slots: {
      catalog: "manual.md defines ORD-01 as valid editor submission and ORD-02 as retaining a draft after validation failure. Concurrent submission remains a candidate.",
      automation: "The source supplies no automation file or command. Locate the test implementation before claiming either case is automated." } },
    { type: "q04", title: "Recorded order regression", task: "Read actual outcomes in their version and environment", slots: {
      context: "manual.md records fixture-2 in sandbox-a with record fixture-run-2.",
      smoke: "The documented smoke baseline selects ORD-01 for draft submission in sandbox-a.",
      selection: "For rename changes add ORD-02 and the filter preservation check. No execution result is provided for filter preservation.",
      prerequisites: "Prepare disposable orders and an editor role before running the selected scenarios.",
      records: "Consult fixture-run-2 for actual outcomes, separately from the chosen baseline.",
      results: "ORD-01 passed; ORD-02 failed with validation-state-retained. Concurrent submission was not executed. These are the supplied historical results, not a current run.",
      conclusion: "The record does not approve release. Fix and rerun ORD-02 before evaluating the release criterion." } },
    { type: "q05", title: "Order test data", task: "Find isolated setup and cleanup requirements", slots: {
      preparation: "manual.md calls for disposable orders owned by test-user-a in sandbox-a.",
      lifecycle: "Remove the disposable orders after the run. Production records and credentials are outside the fixture scope; the source contains no live credentials." } },
  ] },
  { id: "operational-runbook", sourceType: "file", profile: "runbook", source: `# Local queue toolbox
Prerequisite: access to the isolated worker environment. Run worker inspect --queue orders to print pending and retry counts.
If pending grows and retries grow, inspect one failed item's validation report before replaying it.
The command reports counters, not a root cause. No production environment or current incident is selected.
`, articles: [
    { type: "q06", title: "Queue investigation toolbox", task: "Use a diagnostic command with clear prerequisites and limits", slots: {
      prerequisites: "manual.md requires access to the isolated worker environment.",
      operations: "Run worker inspect --queue orders to obtain pending and retry counts. If both rise, inspect one failed item's validation report before replay.",
      results: "Counters are an investigation entry, not a proven root cause or evidence about a production incident." } },
  ] },
  { id: "support-faq", sourceType: "file", profile: "faq-support", source: `# Why did a submitted order remain visible as draft?
For the sandbox-a fixture-run-2 record, ORD-02 reported validation-state-retained. The report confirms a failed test but contains no trace identifying the faulty layer.
Answer status: unresolved. Next: compare the API response with frontend state handling for the same request ID. Do not restart unrelated services.
`, articles: [
    { type: "q07", title: "Draft-state support question", task: "Preserve an unresolved answer and a useful next step", slots: {
      question: "manual.md asks why a submitted order remained visible as draft in sandbox-a fixture-run-2.",
      answer: "The recorded ORD-02 test failed, but its root cause remains unresolved. No trace assigns fault to the UI, API or storage.",
      investigation: "Compare the API response and frontend state handling for the same request ID. This is the proposed next investigation, not an already executed diagnosis." } },
  ] },
];

ARTICLE_DOCUMENT_SCENARIOS.push({ id: "confirmed-incident-review", sourceType: "file", profile: "incident-review", source: `# Queue retry incident record
In the isolated worker environment, repeated validation failures exhausted the worker queue.
The retained trace identified an unlimited retry branch for invalid input. A patch added a three-attempt limit and retained exhausted items for manual inspection.
The recorded targeted test replayed four failures, observed three attempts and one retained item. It did not validate production deployment.
Prevention: retain the exhaustion test in the retry policy suite and inspect the retained-item counter after changes.
`, articles: [{ type: "q07", title: "Retry exhaustion incident", task: "Separate confirmed cause, repair verification and prevention", slots: {
  triggers: "Repeated input validation failures exhausted the isolated worker queue.",
  cause: "The retained trace identifies an unlimited retry branch for invalid input; this is not inferred from queue depth alone.",
  repair: "A patch capped attempts at three. The recorded test observed three attempts and one retained item after four failures; production deployment was not verified.",
  prevention: "Keep the exhaustion test in the retry policy suite and inspect the retained-item counter after retry changes.",
  references: "Read manual.md and obtain the retained trace and test receipt before applying this incident conclusion to another environment.",
} }] });
