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

