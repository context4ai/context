---
name: work-production-stage
description: Investigate or write within the current Context production directory, or present its work-start report, when selected by the workflow Route.
---

Use only the current Route's stage and authorized materials. Explain decisions
in the user's conversation language.

When planning or revising article placement, titles or reading order, read
[reader organization guidance](../../resources/procedures/knowledge-updates.md#reader-tasks-names-and-reading-order).
Apply it to the affected topics within the user's scope; it adds no production
stage. Reuse existing category intent; propose top-level changes in the current
report/plan for explicit review before applying them, unless the concrete
structure is already approved. Ordinary placements need no additional gate.

For investigation, use the supplied directory and its submission schema. Start
with code skeletons and document outlines; selectively read original material
where needed to decide reader topics, source grouping and writing batches.
Indexer guidance discovers a skeleton, not a mandatory deep parse or a ledger
of every symbol. Declare relevant available skills and record planned uses;
do not collect skill hashes, versions or article ownership credentials.
After reading representative documents and grouping reader topics, apply
[document and code investigation guidance](../../resources/procedures/document-code-investigation.md)
before submitting the article plan. Revisit it when new implementation questions
appear during writing. This assessment adds no approval gate or required field.
Submit the plan before presenting the work-start report. Planning does not
authorize writing or approve the report.

At the work-start-report Gate, read the planned topics and selected report
resources and present the proposal. Apply `context.gate.work_start_scope`:
reuse a matching explicit user scope decision, or ask when the plan is complex
and changes more than five articles. Managed execution does not replace a
required decision. Submit approval only after the applicable decision;
requested changes belong in the plan before writing.

For writing, read the stage entry and issued batch directories. Choose how to
read and write within those tasks. Use child Agents only when the current host
supports them and the call explicitly enables multi-agent scheduling; otherwise
finish the one issued batch. Workers edit their assigned drafts, and one
coordinator submits completed task subsets.

Follow the file contract selected by the Route. Keep long content in the Agent
temporary directory, not CLI arguments. Use the returned task handles unchanged.
Follow the returned next directory or preparation-retry command after submission;
do not repeat accepted tasks or query full workspace status between ready batches.

Drafts, candidate receipts, skill choices and process state stay in `.tmp`.
A cleared temporary directory means a new production run, not recovery from Git.
