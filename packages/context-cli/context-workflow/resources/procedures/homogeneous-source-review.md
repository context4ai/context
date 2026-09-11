---
id: procedure.homogeneous-source-review
kind: procedure
mediaType: text/markdown
---

# Review large homogeneous source groups before bulk work

Apply during source exploration, the work-start report, Provider selection and
before advancing into parser preparation, including an existing workspace's
resume. Reuse confirmed decisions; this is the existing conversational scope
review, not a new CLI approval flag or a semantic classifier in the CLI.

## Find a real group, not just a large repository

More than 100 files in a candidate group triggers a bounded homogeneity check,
not automatic exclusion or a count-only stop. Use the supplied source inventory
or authorized read-only file listing. Do not run symbol extraction to discover
whether symbol extraction is needed. Record the source/repository and pinned
revision, actual module/directory boundaries, counted paths, bytes when available,
and representative file paths. Distinguish tracked source, captured copies,
generated files and externally resolved dependencies; a path containing another
repository name does not prove a new external checkout.

Read a small diverse sample across relevant subdirectories, sizes and naming
families. Establish a shared structure, generator, schema, repeated role or
mechanical pattern from content. Examples include IDL definitions, schema-based
configuration, generated clients/models, repeated migrations, and ordinary
handwritten adapters or handlers with the same structural pattern. A common
extension, a directory label, age, or boilerplate header alone is not sufficient.
Do not call every TypeScript file homogeneous or treat all configuration as
low-value. If samples differ substantially, split by evidenced characteristics
or proceed normally; report uncertainty instead of claiming full inspection.

For a confirmed group above 100 files with an unsettled treatment, pause before
dependent bulk reading/parsing. Combine all currently known groups into one scope
proposal. Do not ask per file or create 100-file approval batches. Groups below
this threshold can still warrant discussion when their size or cost is material;
file count is not a memory safety limit.

## Present one concrete choice per group

Show a compact directory tree and table with:

- Repository/source, revision, exact directory or file-set boundary and whether
  it is the whole source or a subset; physical file count versus distinct items.
- Observed shared characteristics and two or three linked sample files with
  short descriptions of their content. State sampling coverage honestly.
- Connection to this task's questions, known callers/consumers and unresolved
  dependencies; distinguish a recommendation from a confirmed exclusion.
- Likely output, reading/parsing cost and the evidence for any estimate.

Offer these treatments together, recommending one based on the user's task:

| Choice | Consequence |
| --- | --- |
| Full indexing | Normal extraction, planning and writing over the selected group. It may yield multiple articles. Explain the extra work without asserting it is always low-value. |
| Overview and lookup entry | List the boundary, inspect representative content and entrypoints, and plan one overview with directory/file lookup routes and concrete search instructions. Defer detailed extraction of the rest. Never first parse every file and then summarize it. |
| Omit the source | Remove the entire source from this task's required production scope through the supported requirement/configuration flow. Do not delete captured files, caches or accepted knowledge. |
| Exclude this subset | Keep the repository but exclude the explicitly selected directories/files from production scope. Clarify whether any are still required as supporting dependencies. |

Only show subset exclusion as applicable when it is a subset; do not make the
user distinguish two identical choices for a whole-source group. Users can give
one policy for several groups or different choices per group. Record the exact
scope of a shared answer. Generic managed/no-review authorization, source-read
permission and permission to skip report feedback do not select a treatment.
Reuse an explicit applicable treatment or explicit delegation of this scope
choice. Otherwise ask and wait; elapsed time is not approval. Independent work
outside the affected scope can continue if the current workflow supports it.

Do not invent "one minute per group", token savings or a cost-benefit score.
When comparable measurements exist, state the measured phase, input size,
cold/cache conditions and uncertainty; separate parsing from Agent reading,
writing and review. Without them state that duration is not reliably estimated.

## Carry the answer into real execution

Update the existing work-start report with the group boundaries, sample evidence,
chosen treatment, user authorization and next action. Reuse that report and the
conversation on retry; it is not itself a runtime execution receipt. Persist
scope changes only through the existing requirement/configuration Actions and
schemas. Exact exclusions use repository-relative paths, not invented wildcard
fields. Retain unrelated requirements and accepted work. A source required by
another requirement may remain active; disclose that instead of promising it
will no longer be parsed.

For full indexing, continue the current Route. For overview, resolve the actual
production boundary and suitable existing Provider before proceeding: the
selected entrypoints and samples support the overview; the remaining group is
for lookup, not an exhaustive production target. Use directory-scoped routes
when a per-file list would dominate the article. Include purpose, observed
patterns, representative examples, source version, lookup/search procedure,
limits of what was read and the next evidence request. Keep symbol/API facts
unread as unknown. Do not forge a complete deep inventory, hand-write approved
knowledge, or silently relabel the full scope as a summary profile.

Check the resulting configuration before a command that prepares parser facts.
In particular, contract-led profiles can still parse their entire registered
boundary before article planning. Merely asking for one article does not reduce
that work. If the current configuration route cannot express the selected
narrow boundary or overview treatment, describe that concrete limitation and
keep the affected bulk action paused; do not revert to full indexing or edit
runtime receipts to make the choice appear applied.

On continuation, unchanged groups with explicit decisions do not prompt again.
New large groups, expansion beyond the agreed directory/file set, or changed
characteristics/cost that invalidate the decision warrant a focused amendment.
A content hash change within the agreed scope is not by itself a new question.
If first discovered while a command is running, report the observation and
safely interrupt the owned process when possible, preserve state and consult
the latest Route before continuing. Do not launch a competing run or delete
state. An uninterruptible stage must be reported, not called paused already.

## Report progress with the correct denominator

Keep source capture, module exploration, parser capability entries, file batches
and delivered articles separate. A seven-file JSON entry does not mean that an
IDL repository now contains seven relevant files. Report both the source and
capability for each count; merging four results is not four completed modules.
Only use completed/total modules when module boundaries and their completion
have been observed. Before that, say module boundaries are being identified.
Never infer percentage or scope reduction from time or RSS. RSS is not Node heap
usage and being below a previous failure measurement does not establish safety.
