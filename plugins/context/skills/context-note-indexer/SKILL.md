---
name: context-note-indexer
description: Interpret saved notes, excerpts and observations for Context planning and writing. Use when the current authorized task selects this skill; not for importing sources or scanning conversation history.
metadata:
  context-role: "indexer-provider"
  context-public-entry: "false"
---

# Context Note Indexer

Use the current Context stage's purpose, source scope and file submission
schema. Read [source interpretation](references/indexer.md) for the selected
material. During planning, use [reader outcomes](references/classification.md)
to propose article targets against existing topics. Investigation supplies a
useful skeleton, not an exhaustive fact ledger; these saved sources normally
need direct reading rather than a parser or a separate inventory pass.

During writing, read [writing guidance](references/writing.md). When revising
or combining existing topics, use [updates and composition](references/updates-and-composition.md)
and [placement](references/extension-placement.md). Read
[adaptation guidance](references/customization.md) only when choosing or
adapting a specialist skill. Do not load every template or article catalog.

CLI supplies the current task directories and checks actual source references
and writes. The Agent chooses topics, grouping and writing batches within the
authorized stage. Installation alone does not select a skill; skill versions,
hashes and primary/extension ownership are not production obligations.

Do not scan host history, fetch an unapproved URL, alter evidence to fit a
claim, or write directly to formal knowledge. Keep drafts and handoffs in the
designated temporary directory; follow the returned CLI action for submission.
