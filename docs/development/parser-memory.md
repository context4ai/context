# Parser preparation and memory boundaries

## Planning before deep parsing

The `web-application`, `api-service` and `event-consumer` profiles start planning
from pinned file identities, paths and content digests. They do not extract every
symbol before Partition. Public-contract profiles keep their existing deep
planning behavior. Question-target inventory and material lookup also use file
identities when symbol facts are not required.

The inventory is cached against source authority, module and profile identity.
An empty fact list in this stage means **not parsed**, not an absence of APIs or
behavior. Partition guidance asks the Agent to inspect representative entrypoints,
configuration and source. Sorted groups of up to 64 files are physical reading
batches, not business modules, article boundaries or an instruction to write one
page per batch. The Agent still owns those decisions.

Before Author, the CLI parses only the files assigned to accepted groups; excluded
files in the same reading batch are not parsed. Saved analysis scopes preserve
the original parser context when Author bindings are rebuilt or combined. Source
and fact conflicts remain errors rather than being silently merged. Framework
enhancements remain available during Author. Explicit material requests can add
evidence without restoring eager whole-source symbol extraction.

## Execution, reuse and memory

Cold source-slice requests resolve the requested registered source/module instead
of materializing the Indexer's entire supporting read scope. Each slice has a
separate cache namespace; the manifest retains the real Indexer identity and
existing source, profile, package and content validation. Existing full indexes
remain readable. A completed source slice can be reused if another source fails.
The completed source cache is not a checkpoint for a partially completed parser
entry. A separate preparation checkpoint retains the last successful preparation
per source/module/capability, keyed by the preparation input, pinned source and
verified parser package. Corrupt checkpoints are recomputed; an interrupted
preparation does not overwrite the previous successful checkpoint. Failure to
write optional inventory or preparation caches warns and keeps the computed
result usable.

The CLI prepares owner groups sequentially and materializes parser entry inputs
only when execution reaches an entry that cannot be reused. File reads are bounded
to eight at a time. Runtime index writing serializes file chunks in batches of
eight and retains descriptors, rather than retaining all JSON strings before
writing. Manifest publication remains atomic.

Language preparation for TypeScript, JavaScript, Go and workspace extraction runs
in the bundled `parserEntryWorker.js` child process. Only one such preparation is
awaited per entry. The child writes its prepared result to a private runtime
directory; the parent loads it after successful exit and removes the temporary
files. Failure identifies the source, capability and file count. Missing worker
assets are an installation error; unbuilt TypeScript source development can use
in-process preparation. Lightweight file preparation remains in process.
Cancellation is forwarded to the child and parent exit terminates it.

The worker boundary covers language preparation, not the entire parser pipeline.
Adapter materialization, fact validation, merges and source inventory construction
still run in the parent. An oversized registered source can therefore still be
expensive. Register actual package/service boundaries before using module-level
planning; adding a module label does not invent a filesystem boundary. Do not
silently trim sources or break dependency context to meet a memory target.

Parser trees are explicitly released after TS/Go extraction, including error
paths. Fixed output-redaction patterns are reused without changing redaction
rules. Canonical protocol hashes stream JSON into SHA-256 while preserving the
previous canonical byte representation; they do not change cache identities or
accept different evidence.

TypeScript analysis reuses already-read source strings and syntax trees across
compatible extraction passes. Public-contract extraction skips creating an empty
checker when there are no exports, while runtime registration scanning still
runs. Package entry tracing keeps the detected package entry context even when a
reading batch excludes that entry file. Go import and call relations carry their
physical source file so same-named functions in different files retain provenance.

## Diagnostics and measurement

Parser progress goes to stderr with stage, elapsed time and current process RSS;
stdout remains the command protocol. A ten-second timer reports progress while
the event loop is available. Synchronous parent work can delay that timer, so
stage messages do not imply a continuous independent heartbeat.

With Context debug enabled, `parser.entry.prepare` records the heavy worker's
elapsed time, source, capability, file count and peak RSS. Worker RSS and parent
RSS are separate measurements, not a combined process-tree peak. Compare cold
runs with identical source commits and parser settings; report warm reuse
separately. Useful checks include scoped-source isolation, eager/lazy result
equivalence, failed-worker recovery, canonical hash compatibility and memory/time
measurements on isolated real modules. Do not benchmark by resubmitting a live
workspace's completed Action or stale revision.

Batching trades some total execution time for earlier planning and lower peak
retention. If every file is eventually parsed, repeated batch setup and cache
publication can take longer than one module-wide parse. Measure both first usable
result and total time, including cache writes. A file-count batch is not a byte
limit: one very large file or an oversized module can still be expensive. Neither
this mechanism nor a parser benchmark establishes end-to-end Agent writing
quality or a guarantee that every repository fits a fixed heap limit.

## Homogeneous source scope review

The workflow supplies `procedure.homogeneous-source-review` as a required
resource during lifecycle entry, Provider selection, parser advancement and
Agent work. Source exploration and the work-start report reference the same
procedure. Before bulk work, the Agent checks candidate groups above 100 files
using inventories and diverse representative source reading. Shared extension
alone is not sufficient; IDL, configuration, generated code and handwritten
structural families follow the same rule.

Confirmed homogeneous groups with unresolved treatment are presented together
for full indexing, overview/lookup, whole-source omission or subset exclusion.
Existing explicit decisions are reused, including on resume. Requirements and
supported configuration Actions remain the authority for execution boundaries;
the scratch report only preserves the discussion. An overview request must be
translated into a narrow production scope before running contract-led parsers;
article count alone does not control extraction depth.

This is an Agent-mediated scope pause, not a CLI content classifier or a new
runtime Gate. Direct low-level CLI execution is not automatically stopped by a
100-file threshold. No automatic process monitor, total-module progress counter,
new summary parser mode or source-deletion command is introduced. When discovered
mid-command, the Agent reports and safely interrupts its owned process if
possible. Generic managed authorization does not decide an unresolved scope
tradeoff, but an explicit applicable scope decision is not requested again.
