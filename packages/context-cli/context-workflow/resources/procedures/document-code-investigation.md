---
id: procedure.document-code-investigation
kind: procedure
mediaType: text/markdown
---

# Assess code needs during document investigation

Register the requested document sources before preparing their article plan.
Continue authorized document capture even when unrelated registered repositories
are unavailable. Existing workspace coverage does not select the current task's
code dependencies.

After reading outlines, representative bodies and related approved articles,
group the reader topics and assess whether code investigation is needed before
submitting the plan and work-start report. Large collections can be investigated
in batches while capture continues. If the expected production plan exceeds 30
article tasks, explicitly perform this assessment before bulk writing. This is
Agent guidance, not a CLI validation threshold. Wiki nodes, documents and article
tasks are different counts; more than 30 document nodes calls for early batched
investigation, not an assumption of 30 articles or automatic repository recovery.

Code evidence is useful when the reader task requires implementation behavior,
call chains, interface constraints or debugging entry points, or when incomplete
or conflicting documents require checking code. Explicit file, symbol or API
references strengthen that assessment. A repository link or service name alone
does not establish a dependency. Keep document-supported topics independent.

Use existing plan briefs or report prose to explain which reader questions need
which registered modules and why; no separate assessment receipt, score or
required schema field is needed. If code is needed, inspect its availability with
`context source recovery-plan <registered-name> --format json`. Follow
[repository source recovery](repository-source-recovery.md), reusing applicable
authorization and local checkouts. Prefer the smallest sufficient registered
module scope. Expand to a shared physical checkout or whole repository when
cross-module calls, common dependencies or uncertain boundaries require it;
do not substitute a different remote or pinned commit.

If recovery is unavailable, continue independent document tasks. Keep questions
requiring unread code pending, or narrow the article to supported document
claims and explain its limits. Do not present inferred implementation as verified
code, delete configured sources, or clear a stage to bypass unavailable evidence.
After recovery, follow its returned preparation command and current task handles;
retain accepted work instead of restarting the task. Reassess code needs when
later reading exposes a dependency that the initial sample did not show.
