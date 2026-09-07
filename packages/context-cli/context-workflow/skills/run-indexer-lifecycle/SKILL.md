---
name: context-run-indexer-lifecycle
description: Continue the sole Context registry-and-Provider indexing route; use only when the workspace Graph selects route.indexer.lifecycle-required.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: workspace
  agent-graph.entry: context
---

# Run The Indexer Lifecycle

This Action continues the sole registry-and-Provider indexing route. Use the
current Indexer subroute for semantic partitioning, structure review, authoring,
composition, layout, Candidate compilation, and repair. Existing approved
knowledge is an input to incremental planning, never a parallel authoring path.

Read
`node_modules/@c4a/context/docs/guides/indexer-provider-and-customization.md`,
then follow the root `context` Skill's Indexer instructions and the exact
structured outcomes returned by `context indexer ...`. Start by forming and
confirming requirements when `src/indexers.yaml` is absent or stale. When the
Route returns `configuration`, edit the named project file and re-evaluate;
do not submit a lifecycle Result or repeatedly run an unconfigured project. Otherwise
continue the current registry selection, Provider resolution, execution,
reconciliation, mechanical validation, layout, and Candidate compile subroute. The Indexer
Graph is the authority for each substep. Never skip directly to compile and
never synthesize a Provider Result or a default plan.

After the registered source overview and representative reading, resolve only
missing reader purpose and substantive scope before planning. Reuse the user's
explicit request and existing goals; a missing `purpose` alone is not a reason
to ask. Fully managed execution does not authorize choosing an unclear purpose.
Ask at most three questions in one round, without filling unused slots: combine
reader and task into one question, then clarify substantive scope, then only a
real tradeoff. Use the current conversation language and a shared human/Agent
knowledge package by default; do not ask about reading audience or language.
Recommend organization and templates, and test that recommendation with the
first small delivery instead of asking abstract classification questions.
Save the short conclusion as `purpose` in the existing requirement, with scopes
and exclusions in their existing fields. Do not store a questionnaire or add
another confirmation after an explicit answer. Silence is not approval.
If deprecated content becomes significant once reliable counts are available,
ask only about that unresolved scope and explain the counting basis and impact.
Read authorized captured sources before raising material gaps; only unresolved
core questions requiring new sources or human knowledge need another question.

After those decisions, use the Route's `procedure.work-start-report` and
`template.work-start-report` Resources for substantial new work or material
choices worth preserving. Write the readable report at `.tmp/work-start-report.md`
before semantic planning, using the existing requirement reference and actual
settings. Lightweight work keeps a short conversational summary. This is a scratch
document written with the Host file tool, not another Gate or Action payload;
show its path and continue the existing Route without seeking report approval.
Reuse it on continuation rather than generating a report for every batch.

When the current subroute is a Gate, follow `gate.resolution_action` rather
than looking for a top-level `action`. Read its Skill and output schema, use its
Route input, and submit the resulting value through the Route completion
command. The Indexer Graph owns the Gate identity, authority, delegation and
resolution Action; do not replace them with an inferred command or handler.

Stop on the first Host permission, non-delegatable Gate, validation failure, or
human decision. Once current Candidates have been compiled, return control to
`context status --format json`; the workspace Graph will select Knowledge
Review. This outer Action has no payload of its own and must never be submitted
through `complete-current`. Context projects it to the one current Indexer
subroute; follow that Route's command and output schema exactly. If project
configuration was edited, re-run `context status --format json` to obtain the
new revision instead of inventing a lifecycle continuation result.

## Readable delivery batches

Follow the current Context Route through Review, close, and build as soon as a
page delivery is ready. The first delivery normally contains one to three
complete pages; later deliveries contain 30–50 pages, with a smaller final tail.
Count pages, not Author calls or worksets. An accepted multi-page Result can
span deliveries without resubmission. A successful package build is a delivery
checkpoint, not evidence that every Author task is complete: evaluate the Route
again and continue pending work. Never manually clear accepted runtime state.

If the user explicitly asks to inspect the current work earlier, run
`context run --deliver --format json`, then follow its current Route. This asks
for an earlier checkpoint; it does not authorize content or bypass Review.
Ordinary mode retains the current batch's approval Gate. Existing managed
approval covers delegatable batch Gates without another mode questionnaire.
A failed build retains the same current pages; fix the reported build problem
and rerun the returned command before authoring another batch.
