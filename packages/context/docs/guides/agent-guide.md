# Agent Guide

The Context Agent coordinates one knowledge-production lifecycle. It does not
invent a separate pipeline for code, documents, or a particular host.

## Start from the Route

Read `context status --format json`, then consume only the procedures, schemas,
and manuals selected by `workflow.current.resources`. Preserve revision and
authority flags in the next command. Do not infer progress from filenames or
probe ignored runtime files when the Route already states the next action.

## Stable decisions

Ask the user only when the answer changes a durable boundary:

- which source or module is in scope;
- which readers and questions matter;
- whether two subjects are the same knowledge owner;
- whether a Provider customization or executable extension is acceptable;
- whether the proposed semantic outline organizes the requested knowledge;
- whether the displayed Candidate content is approved.

The Agent may decide mechanical details from evidence: parser selection within
an approved Provider, deterministic partition execution, page slug generation,
and recovery of an already completed step.

## Authoring boundary

`src/index.ts` owns source capture and package output. `src/indexers.yaml` owns
knowledge requirements and Provider selection. Keep these responsibilities
separate.

Code and Markdown Providers receive controlled worksets and return typed
results. They do not write Candidate, Review, `knowledge/`, or `dist/` files.
Context validates and persists their result before the next action consumes it.
Initial Provider selection follows the same rule: use the requirements and
CLI-bundled catalog in the current Action input, return only non-CLI visible
Skill identities and semantic Indexer entries, and let the CLI perform routing,
resolution, staging, validation, and atomic registry apply. External resolver
results and non-allowlisted program decisions resume through subsequent
`complete-current` Routes; do not invoke the low-level Provider commands.
For Partition and Author steps, one Route may contain several independent
`tasks`. Read the shared instructions once, read each task's Authorized Workset
View, and return one `results[]` item for every task key in that batch. Submit
the whole batch with the Route's single `context action complete-current`
command; a successful completion already carries the next prepared batch or
the next lifecycle boundary. Do not materialize instructions or Views with
separate commands, create a helper script, or construct internal Result,
digest, receipt, Fact, or evidence-binding objects.

The batch is only a transport boundary. Keep every task's semantic answer,
failure and retry independent, and do not combine unrelated Subjects merely
because they arrived together. Partition Views intentionally emphasize public
anchors and compact file context; Author Views add the source-backed supporting
facts needed for reader content.

Parser packages are Provider internals. Do not expose parser choice as an
extra user workflow unless it changes coverage or requires executable code the
user has not authorized.

## Review boundary

Review is about the proposed knowledge, not the storage mechanism. Show:

- readable target paths and titles;
- concise summaries and relevant source paths;
- the final page content or a clear structural preview;
- conflicts, omissions, and forced-approval warnings that affect correctness.

Do not show evidence hashes, content-addressed IDs, execution receipts, or
other machine fields by default. Keep those in runtime state only when they are
needed for validation, stale detection, or recovery.

A compatible production round has two semantic judgments. The first checks the
outline after all Partition shards converge; the second checks the final
reader-facing Candidate set. Ordinary mode presents both to the user. Fully
managed mode lets the Agent resolve both with current-conversation authority.
A destructive or ambiguous layout change is separate and always human-only.
Intermediate execution batches never create additional user approvals.

## Quality bar

Judge output from the reader's point of view:

- pages have semantic subjects rather than ordinal batches or symbol dumps;
- filenames and directories are readable and stable;
- content explains behavior, boundaries, examples, and constraints supported
  by the source;
- templates are actually filled with source-specific information;
- duplicate pages and unsupported claims are absent;
- `dist/` is smaller and cleaner than the production workspace.

When dogfooding, compare the generated knowledge with an existing useful
knowledge base. Feed gaps back into the Provider profile, instructions,
templates, or parser coverage rather than editing generated pages by hand.

## Recovery and Git

Runtime artifacts under `.tmp/context-runtime/` may be rich because they are
local and disposable. Committed knowledge should contain only readable content
and metadata required for future updates or rebuilds. A successful close may
discard transient Review details.

Context completion does not authorize Git operations. Stage, commit, push,
publish, and deploy only when the user explicitly requests them.
