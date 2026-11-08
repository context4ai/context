---
name: context-run-indexer-agent-step
description: Revise approved Context articles or assess an explicit source update when selected by the current Route.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: approved-revision
---

# Maintain current articles

Read the current Route input and its required procedure. For an approved
revision, use the supplied article, change instruction and actual source regions;
for a source update, inspect the fixed source changes and existing article
references before choosing affected articles or new topics.

Preserve unrelated prose, article identities and user edits. Read relevant source
text when navigation or declarations cannot establish a claim. A supplied program
block can replace a duplicate table, but does not establish surrounding behavior.
Do not regenerate unrelated articles or read the entire library by default.

Use the returned action schema and command. Keep long Markdown or JSON/YAML in
the Agent temporary area and pass a file path rather than a long CLI argument.
Do not add skill versions, hashes, ownership records or per-symbol dispositions.

Report unresolved semantic choices in the user's language. Follow the current
Review and conflict-recovery routes; acceptance does not approve publication.
If the next preparation fails after acceptance, use its recovery command without
repeating saved content. An unfinished production stage can remain suspended
while this maintenance action runs; do not replace or clear its tasks.

After a successful submission, follow `next_route.inline`, or read
`next_route.file` once when no inline Route is present. Do not insert another
status call. Refresh status only after a failure, a missing next Route, or an
external workspace change. A driver loop must bind each prepared result to its
issued task inputs, use the returned Route revision, and stop when the node
changes or a new reading or human gate is required.

Minimal driver flow (pseudocode):

```text
route = initial_route
while route.node == initial_node and no_new_read_or_confirmation_gate(route):
    result = submit(input_bound_to(route), revision=route.revision)
    if result_failed(result): follow_returned_recovery(result); break
    if result.next_route is missing: refresh_status_once(); break
    route = result.next_route.inline or read_once(result.next_route.file)
```

Use preview only when someone will read the assembled Markdown before deciding
to submit; unattended loops submit directly. A prepared multi-page batch is the
exception: preview the whole batch once before submitting it, since that one
call checks every page without saving drafts or task state. On failure, follow the returned
submission state and recovery action: correct uncommitted input, continue after
committed work, or recover an uncertain transaction before deciding to retry.

For writes expected to exceed a minute, use a recoverable background task when
the host supports one; otherwise allow sufficient foreground timeout. Prefer a
bounded wait based on remaining work over repeated model polling. Long loops
write completed/total progress under `.tmp` and report that progress to the user.
Do not change knowledge inputs during build, version recording or review apply.
Use the standard `context review html` report for review and requested diffs;
generate it before requesting confirmation. Managed approval also produces it.
