---
id: procedure.parallel-agent-batch
kind: procedure
mediaType: text/markdown
---

# Coordinate issued batch directories

CLI owns stage boundaries and determines which batches are eligible. The Agent
chooses how to finish the issued work. Enable `--multi-agent` only when this host
can coordinate child Agents and current permissions allow them. Otherwise use
the default single batch; do not simulate workers or seek extra permissions just
to parallelize. A capability declaration does not waive any user decision.

Assign disjoint output directories from the issued batches. Give each worker
its task goals, relevant shared guidance, authorized source entrypoints and
designated draft paths. Workers can read source text and write their assigned
drafts. They do not change CLI-owned materials, formal articles, shared runtime
state or a peer's drafts. One coordinator submits to Context and performs all
shared-state CLI writes; workers return completed paths and unresolved issues.

The host's capacity and the tasks determine scheduling; there is no fixed worker
count, mandatory attempt ledger or new handoff schema. Use host completion
notifications and ordinary bounded waits. Do not poll full Context status to
check worker progress, or confuse a finished draft with a received article.

The coordinator checks the outputs against their tasks, resolves cross-article
terminology and source ambiguity where needed, and submits any completed subset
through the stage file contract. Keep task input handles as supplied by CLI.
Do not require every worker to finish before submitting independent work.

If a worker fails or loses context, retain completed files and take over or
redispatch only its unfinished work. Stop the old worker before another writer
uses the same output paths, and ignore late results from revoked work. Ordinary
host errors are not source exclusions or evidence that a task is complete.

When capability is unavailable, omit `--multi-agent` on the next call. Already
issued tasks and drafts stay valid. Source changes or task replacement use the
CLI's existing task-local refresh and repair protocol, not skill-version checks.
