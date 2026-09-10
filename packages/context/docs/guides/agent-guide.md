# Agent Guide

The Context Agent coordinates one knowledge-production lifecycle. It does not
invent a separate pipeline for code, documents, or a particular host.

## Start from the Route

Read `context status --format json`, then consume only the procedures, schemas,
and manuals selected by `workflow.current.resources`. Preserve revision and
authority flags in the next command. Resolve files from the initialized workspace;
its `.tmp/` and generated `AGENTS.md` belong to that same workspace. A resource
may be a file or a returned command: follow its read order and `after_read`
instructions instead of guessing a path or CLI subcommand. Do not infer progress from filenames or
probe ignored runtime files when the Route already states the next action.

## Stable decisions

Ask the user only when the answer changes a durable boundary:

- which source or module is in scope;
- which readers and questions matter;
- whether two subjects are the same knowledge owner;
- whether a Provider customization or executable extension is acceptable;
- whether the proposed semantic outline organizes the requested knowledge;
- whether the displayed Candidate content is approved.

Reuse answers and authority already supplied for the current task; these are not
questions to repeat at every step. Even in fully managed mode, ask when missing
purpose or scope would change the outcome. Before indexing a large boundary,
identify irrelevant or obsolete areas with the user from actual material. Do not
exclude them by naming heuristics or include them all merely because they exist.

The Agent selects suitable Providers and makes semantic decisions about topics,
organization and content. The CLI executes parsers, validates source/page
identities, derives paths and schedules recovery. Do not make the Agent reproduce
those mechanical operations or invent state to declare a step complete.

## Authoring boundary

`src/index.ts` owns source capture and package output. `src/indexers.yaml` owns
knowledge requirements and Provider selection. Keep these responsibilities
separate.

Code, Markdown, Note, Sessions and compatible business Providers receive controlled worksets and return typed
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
command. Use a workspace `.tmp/` JSON or YAML input file for a large payload,
then submit with `--input <file>`; avoid long JSON through an interactive PTY.
A shortened completion may point to `result_file` and `next_route.file`; read
them before deciding what was accepted. If preparing the next Route fails,
keep accepted results and use the supplied refresh action. Retry only tasks
still pending in the new Route, never the accepted tasks from an old batch.
Do not construct internal Result, digest, receipt, Fact or evidence-binding
objects, or materialize Views through commands the Route did not request.

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
Intermediate execution batches never create additional user approvals. Page
delivery batches do complete their applicable content review, close and build;
they are distinct from Partition transport batches. The first delivery normally
contains 1–3 pages, followed by 30–50-page batches or a smaller remaining tail.

For substantial new work, follow the selected opening-report procedure after
research and necessary questions, before Partition. Explain what the first pages
will help the reader do and invite them to read the report, unless that pause was
explicitly waived. Neither the report nor an invitation creates a new approval
state; fully managed mode still reports its decisions and delivered page paths.

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

## Corrections and source updates

Use `context revise` for a selected approved page and `context update` for a
selected source change. Writing starts from the existing approved text and uses
the current Route's Provider, template and source material. New topics enter the
applicable structure review before Author; they are not silent page additions.
Use `task adjust` for changed inputs in the current task and explicit rollback
for an agreed reversal. See [Update existing knowledge](knowledge-updates.md).

## Recovery and Git

Runtime artifacts under `.tmp/context-runtime/` may be rich because they are
local and disposable. Committed knowledge should contain only readable content
and metadata required for future updates or rebuilds. A successful close may
discard transient Review details.

Context completion does not authorize Git operations. Stage, commit, push,
publish, and deploy only when the user explicitly requests them.
