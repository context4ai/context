---
id: procedure.work-start-report
kind: procedure
mediaType: text/markdown
---

# Write a work-start report

After representative source reading and necessary reader-purpose/scope discussion,
and before semantic Partition, preserve useful decisions for substantial new work
in `.tmp/work-start-report.md` at the current workspace root. Use the companion
`template.work-start-report` Resource from this Route. This is an Agent-written
reader document, not a CLI-generated summary or an Indexer Artifact.

## When it helps

Write it for substantial new work expected to continue across deliveries, or
when the discussion establishes material scope, version, evidence or delivery
choices worth carrying into later work. Also write it when explicitly requested.
Lightweight single-document work, small edits and routine upgrades normally need
only a short conversational summary. Neither asking one question nor having more
than one delivery automatically makes a task substantial: the first batch is small.
Do not count files or estimate an exact page total just to decide whether to write.

Reuse explicit goals and settled choices; ask only about unresolved reader purpose,
material scope or core feasibility after reading available authorized material.
Use the existing discussion and approval routes, at most three questions per round.
Template headings, approximate counts and optional sections are not a questionnaire.
Do not record a question-by-question transcript or ask the user to approve the
report again after they have already answered the substantive questions.

## Placement in the current flow

Save confirmed requirements through the existing registry configuration flow.
When selecting Providers, use their supplied capabilities to describe likely
content collections in the user's language. Write the report before proceeding
to semantic planning. If an existing workspace reaches Partition directly, reuse
still-applicable decisions and the report, or write one there when the current
task warrants it. Do not restart capture, Provider selection or accepted work.

Use the Host file-writing tool for this one scratch Markdown document. Keep it
outside `.tmp/context-runtime/`; do not write knowledge, candidates or runtime
state directly. This permission does not authorize other workspace writes.
Show the user the report's actual local path with a short account of the first
delivery, then continue the current Route. The report is not a `complete-current`
payload, receipt, approval, required-state flag or separate workflow Gate. Its
existence is never evidence that a purpose or authority question is resolved.
If writing fails, describe the problem and give the summary in conversation;
do not change workflow state or manufacture a receipt to compensate.

## Keep it tied to the actual task

Under the title, link the existing requirement or its workspace file and existing
requirement ID/name. When only a workspace reference exists, use it with the
stated purpose and scope; do not invent another ID. Resolve local links relative
to the report's location, not the installed template. Later Agents follow that
reference to check the current requirement, approval authority and actual settings.

Record the current language, ordinary/managed mode and debug status in a brief
opening paragraph. Reuse the user's language unless explicitly directed otherwise.
Managed mode requires existing explicit authorization; the report cannot grant it.
Read debug status with `context debug status --format json` when needed; do not
enable it just because this is a test. If the workspace is not initialized yet,
say the setting has not been checked and check it later. These are observations,
not three new questions. Do not copy secrets or a whole configuration file.

Update the same report when purpose, scope, key choices or relevant settings
materially change. Reuse it on retries and continuation; do not write one per
batch, Author or source. Current requirements, Route and approvals remain the
execution authority. Report text is background, not source evidence for claims.

## Write for a person

Write the report, including headings and collection names, in the user's language.
Use the template as an outline with guidance, not text to copy into the output.
Aim for a short connected report, usually one or two pages, without cutting useful
decisions to meet a length target. Open with the real reader situation and the
first useful deliverable. Name the point at which it becomes readable; give a time
estimate only with a basis and conditions, not an invented deadline.

This fictional opening illustrates connected prose, not a reusable audience,
scenario, content plan or sentence pattern:

> People joining the project need instructions they can follow through their first
> task, with somewhere to turn when a step goes wrong. The first delivery brings
> that path and its essential reference pages together. Once reviewed and built,
> it can be used while the remaining topics are still being prepared.

Synthesize findings across sources in paragraphs, linking supporting material
where useful. Do not turn every inspected file into a row. Distinguish the user's
choices, still-valid prior decisions and your arrangements within that scope.
When missing core evidence led to a decision to deliver a known boundary or seek
additional sources, explain that decision and its authorization boundary in scope;
only the remaining local gap belongs at the end. Do not call omitted core work done.

Use at most two tables: parallel content groups and remaining gaps. One group or
a simple gap may be prose; omit inapplicable sections and empty tables. Do not
leave placeholders or template instructions. Mention only one to three actual
pitfalls for this task, not a generic risk register, compliance checklist, scoring
rubric or repeated acceptance Gate. Avoid repetitive labels, ceremonial readiness
claims and unsupported promises of completeness or efficiency.

Describe use scenarios separately from proposed collection types. Use readable
names for classifications supported by the current Indexer; do not expose internal
IDs or invent unsupported categories. Grouping and counts remain estimates, not
approved paths. Shared content can serve several scenarios without duplicate pages.
Adapt the plan to the sources and selected Indexer rather than copying a code or
documentation example into every report.

The scratch path is outside current runtime cleanup targets, but `.tmp` is not
permanent storage. Respect workspace ignore rules; do not publish or commit it.
