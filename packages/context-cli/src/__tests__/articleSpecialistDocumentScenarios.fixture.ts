import type { ArticleScenario } from "./articleCodeScenarios.fixture.js";

export const ARTICLE_SPECIALIST_DOCUMENT_SCENARIOS: ArticleScenario[] = [
  { id: "public-api-contract", sourceType: "file", profile: "public-api-reference", source: `# Order API contract
GET /orders/{id} returns an order with id and status. Missing id is invalid; unknown orders return 404.
This is an API specification. Handler implementation, authentication configuration and request traces are not included.
`, articles: [
    { type: "s02", title: "Documented order API catalog", task: "Find the contract without claiming an implementation trace", slots: {
      catalog: "manual.md defines GET /orders/{id} and its order response. It is the documented API entry.",
      authority: "This API specification supplies no handler or trace. Inspect the authorized route registration and implementation before attributing runtime behavior." } },
    { type: "s03", title: "Get order contract", task: "Find the request and error contract", slots: {
      validation: "manual.md requires id. Missing id is invalid according to the specification.",
      response: "The documented response has id and status; an unknown order returns 404. Authentication and concurrency behavior are not established by this material." } },
  ] },
  { id: "documented-design-standard", sourceType: "file", profile: "standard-policy", source: `# Web focus and theme standard
This document requires visible keyboard focus for actionable controls. Verify focus by keyboard navigation before accepting a control.
Use semantic token focus.ring instead of embedding a color. The document specifies no numeric color or native platform mapping.
This is a normative design requirement; no component source or accessibility test result accompanies it.
`, articles: [
    { type: "d03", title: "Keyboard focus acceptance rule", task: "Distinguish a requirement from verified compliance", slots: {
      conditions: "manual.md requires visible keyboard focus on actionable controls and keyboard verification before acceptance.",
      implementation: "No implementation or test result accompanies the rule. Locate the control's focus handling and a keyboard verification record before declaring compliance." } },
    { type: "l03", title: "Focus design specification", task: "Preserve document-only design guidance", slots: {
      rules: "manual.md requires semantic token focus.ring instead of an embedded color. This is a normative requirement, not proof that consumers comply.",
      platforms: "The document covers Web, supplies no numeric color and gives no native mapping. A component repository is not required to preserve this documented standard." } },
  ] },
  { id: "incident-record", sourceType: "file", profile: "incident-review", source: `# Sandbox queue incident record
At 10:00 the sandbox worker stopped draining orders. At 10:05 restarting the worker restored drainage in the recorded observation.
Initial hypothesis was storage latency. Correction at 10:12: the available trace does not establish storage as the cause.
Root cause remains unknown. Preserve the request trace and inspect worker cancellation handling. A restart is an observed recovery, not a proven permanent fix.
`, articles: [
    { type: "c05", title: "Historical sandbox queue incident", task: "Preserve observation, corrected hypothesis and next investigation", slots: {
      symptoms: "manual.md records stopped drainage at 10:00 in the sandbox and restored drainage after the 10:05 restart.",
      findings: "The 10:12 correction withdraws storage latency as an established cause. Root cause remains unknown; the restart is an observed recovery, not a permanent fix.",
      diagnosis: "Preserve the request trace and inspect worker cancellation handling. No new production operation or current incident is authorized by this historical record." } },
  ] },
  { id: "library-migration", sourceType: "file", profile: "release-migration-guide", source: `# Example UI migration from 1 to 2
In version 2, notify.open returns a close handle; replace the old global notify.dismiss call with that handle's close method.
The Web theme replaces palette.focus with semantic focus.ring. No native migration is documented.
Before rollout, verify notification cleanup and keyboard focus in an isolated application. This is guidance, not a completed migration report.
`, articles: [
    { type: "l05", title: "Library version migration entry", task: "Find compatibility work before adopting the new library", slots: {
      compatibility: "manual.md requires moving from global notify.dismiss in version 1 to the handle returned by notify.open in version 2. The migration is guidance, not a completed rollout.",
      setup: "Verify notification cleanup and keyboard focus in an isolated application before rollout. The document supplies no successful execution result." } },
    { type: "l03", title: "Web theme migration", task: "Keep resource and platform migrations explicit", slots: {
      mapping: "manual.md replaces Web palette.focus with semantic focus.ring during migration from version 1 to 2.",
      platforms: "No native migration is documented. Do not apply the Web mapping as a native compatibility guarantee." } },
  ] },
  { id: "documentation-navigation", sourceType: "file", profile: "documentation-site", source: `# Example UI documentation map
The guide contains installation, the Button API, notification cleanup and theme adoption.
For a disappearing notification, start with notification cleanup; for missing keyboard focus, start with theme adoption and the control implementation.
Only this map has been supplied. Linked guides and component implementation have not been read.
`, articles: [
    { type: "c01", title: "UI documentation entry", task: "Give task-directed entries without inventing unread content", slots: {
      index: "manual.md names installation, Button API, notification cleanup and theme adoption as documentation topics. Their full contents have not been supplied.",
      tasks: "Start notification disappearance investigations at notification cleanup; inspect theme adoption and the control implementation for missing keyboard focus. These are navigation suggestions, not diagnosed causes." } },
  ] },
];
