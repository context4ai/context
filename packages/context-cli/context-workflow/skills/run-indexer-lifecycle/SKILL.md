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
the `context.indexer.provider-guide` resource at the exact path in the current Route,
then follow the root `context` Skill's Indexer instructions and the exact
structured outcomes returned by `context indexer ...`. Start by forming and
confirming requirements when `src/indexers.yaml` is absent or stale. When the
Route returns `configuration`, edit the named project file and re-evaluate;
do not submit a lifecycle Result or repeatedly run an unconfigured project. Otherwise
continue the current registry selection, Provider resolution, execution,
reconciliation, mechanical validation, layout, and Candidate compile subroute. The Indexer
Graph is the authority for each substep. Never skip directly to compile and
never synthesize a Provider Result or a default plan.

A large `complete-current` reply may use `context.action.completion-summary/v1`.
Read its `result_file` for complete task diagnostics and `next_route.file` for the
exact next Route. Counts and shortened messages are only a summary; never resubmit
committed tasks to obtain missing output. If `next_preparation` failed, use its
recovery command; committed tasks remain saved. For a long submission use a UTF-8
JSON/YAML file in `.tmp/` with `--input <file>` rather than feeding a long line into
an interactive PTY. Keep the Route revision and completion command unchanged.

After the registered source overview and representative reading, resolve only
missing reader purpose and substantive scope before planning. Reuse the user's
explicit request and existing goals; a missing `purpose` alone is not a reason
to ask. Source-read authorization does not settle purpose, depth or version scope.
Fully managed execution does not authorize choosing an unclear purpose. Ask and
wait when these choices remain unresolved, without re-asking explicit decisions.
Ask at most three questions in one round, without filling unused slots: combine
reader and task into one question, then clarify substantive scope, then only a
real tradeoff. Use the current conversation language and a shared human/Agent
knowledge package by default; do not ask about reading audience or language.
Recommend organization and templates, and test that recommendation with the
first small delivery instead of asking abstract classification questions.
Save the short conclusion as `purpose` in the existing requirement, with scopes
and exclusions in their existing fields. When an agreed exclusion maps to exact
repository files or directories, set `exclusions[].paths` to those repository-relative
paths and retain its `scope` and `reason`. No wildcards are accepted. Context filters
these before Parser/Partition work; an omitted `paths` means the whole stated scope.
Do not translate a vague age or naming clue into an exclusion. A shared Indexer
retains files still needed by another applicable requirement. Confirm the scope
before bulk work: unnecessary inputs consume tokens and slow useful delivery. Do not store a questionnaire or add
another confirmation after an explicit answer. Silence is not approval.
During the authorized source overview and representative reading, actively assess
which regions serve the reader's task, which only support it, and which appear
unnecessary. Check available entrypoints, maintained guidance and lifecycle or
version notices; deprecation is one possible scope concern, not the sole trigger.
Names, age, file counts and generated status are clues, not exclusion rules.
Propose concrete boundaries with reasons. Explain a material tradeoff once:
including large irrelevant regions increases token use and processing time and
can dilute useful knowledge with repetitive or conflicting pages. Do not claim
measured savings or reduce requested coverage merely to make the run faster.
Resolve meaningful unanswered scope choices with the user before dependent bulk
work, including in managed mode; carry out settled choices within existing
authorization without asking per file. Use available counts with their unit and
coverage, not an exhaustive scan just to obtain a number. If the relevant boundary
is not yet checked, say what remains to inspect rather than declaring it absent.
Preserve decisions in existing requirements and the report when applicable.
Revisit only material new findings on continuation; do not restart accepted work
or delete existing knowledge to implement a proposed scope reduction.
Read authorized captured sources before raising material gaps; only unresolved
core questions requiring new sources or human knowledge need another question.

After those decisions, use the Route's `procedure.work-start-report` and
`template.work-start-report` Resources for substantial new work or material
choices worth preserving. Write the readable report at `.tmp/work-start-report.md`
before semantic planning, using the existing requirement reference and actual
settings. Lightweight work keeps a short conversational summary. This is a scratch
document written with the Host file tool, not another Gate or Action payload;
follow the procedure's first-report reading invitation and conversational pause,
including in managed mode unless the user explicitly waived that pause. Then
continue the same Route; do not add a report approval state or polling loop.
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
The Author Route exposes this user-requested alternative under `delivery`,
including accepted pages waiting and the actual waiting condition. It is not an
automatic command to run on every batch. If Author work is already running,
finish that current batch; the next lifecycle advance selects complete accepted
pages before starting another batch. Follow any required Composer, Review,
close and build steps, then resume the remaining Author work with its new Route.
`delivery_boundary: false` only means no explicit reader-task boundary; it does
not disable the automatic 50-page checkpoint. Never predict all tasks must
finish from that flag. A user asking when pages will appear needs this
explanation; asking to see them now authorizes the early-delivery request.
Ordinary mode retains the current batch's approval Gate. Existing managed
approval covers delegatable batch Gates without another mode questionnaire.
A failed build retains the same current pages; fix the reported build problem
and rerun the returned command before authoring another batch.

At workflow completion, return to the Context entry and reconcile the user's
remaining requests with delivered pages and registered maintenance targets.
Composer tasks are derivation checks, not a list of queued page revisions.
Empty proposals may finish an already delivered scope without another Review or
build. Continue authorized, unregistered revisions through the normal entry;
do not resubmit accepted Composer tasks or treat an empty queue as proof that
every conversational request was completed.
