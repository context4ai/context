# Changelog

All notable changes to Context are documented here.

## Unreleased

## 0.7.1 - 2026-08-31

- Migrated workflow resources to the independent Agent Graph file, Graph
  Action, and Host Action protocols and pinned Agent Graph 0.3.0.
- Replaced the unused contract-overlay signature, trust-bundle, and project
  authorization path with one digest-bound static validation receipt.
- Preserved Provider integrity, monotonic overlay conformance, stale-result
  rejection, question-authority validation, and atomic registry application.

## 0.6.19 - 2026-08-26

- Made code-index quality checks precede every candidate review path, so human
  review only starts after the mechanical coverage and density gates pass.
- Measured reader-facing code-index content without Context control comments,
  and kept review guidance consistent with the enforced quality dimensions.
- Added one conversational workflow-mode choice when a request does not choose
  ordinary review or fully managed operation, without adding repeated Gates.
- Included the HTML reports actually used for human review in the final summary
  while excluding managed and force-approval reports.

## 0.6.19-preview.2 - 2026-08-26

- Made Lark capture prefer user credentials while safely falling back to the
  bot identity only when the user credential path is unavailable, and kept the
  selected identity consistent across document and embedded-resource reads.
- Added closed handling for zero-exit `ok=false` Lark responses and an explicit
  `lark-cli update` recovery when structured XML fetch support is unavailable.
- Treated a repository containing only `.git` as an empty initialization target.
- Added an independent code and Markdown/MDX inventory baseline so custom
  extractors cannot report a hand-picked evidence subset as complete coverage.
- Required independently discovered page entries, route registrations, service
  operations, and relationship-specific evidence in code-index audits.
- Rejected template headings in Section bodies and preserved multi-source
  evidence through approved code-index Markdown.
- Blocked likely credential literals before Lark evidence snapshots are written.
- Prevented managed document optimization from keeping actionable signals due
  to time, workload, batch size, or an unanswered input request.

## 0.6.19-preview.1 - 2026-08-25

- Reduced the disposable code-index audit state by persisting only its decision
  receipt, scope identity, retry metrics, and conditional reviewed-page hashes;
  the complete mechanical report is recomputed from current knowledge.

## 0.6.19-preview - 2026-08-25

- Renamed the reader-facing code collection to `codeindex` and added an
  idempotent, conflict-safe migration for legacy `codegraph` workspaces.
- Added per-module source inventory and independent mechanical quality
  dimensions for file/LOC analysis, document reading, stable entries, public
  exports, profile-selected boundaries, facts, explanation, page size,
  implementation body, evidence scope, and template residue.
- Made aggregate custom extraction Section-only, so empty template sections
  and copied instructions cannot become knowledge pages.
- Added a shared managed and ordinary audit loop with concrete repair actions,
  a three-attempt problem ledger, and one aggregated human-guidance Gate when
  the same modules still fail absolute bounds.
- Expanded source-backed document revisions from local formatting repairs to
  Section-scoped `keep`, `repair`, `reshape`, and mechanically justified
  `omit` decisions.
- Added deterministic editorial signals for unfinished drafts, placeholders,
  difficult tables, unstable references, sensitive-value candidates, and
  other reader-facing quality problems.
- Preserved destinations, code, numbers, identifiers, source boundaries, and
  approved baselines while keeping revision audit state out of package output.

## 0.6.18 - 2026-08-24

- Added a mandatory Agent semantic audit for completed code-index extraction,
  including thin-content, evidence-scope, source-coverage, section-depth, and
  relationship signals with managed revision loops.
- Added an ordinary Review escape path: after a report-access failure, the
  user's exact current-conversation phrase `强制批准` can authorize one
  revision-bound, whole-scope approval without a copied decision Payload.
- Kept the full code-index audit report in the workspace while excluding it
  from knowledge-package output and upload.
- Made concurrent Context writers wait for the active owner and reuse its
  completion result instead of causing avoidable lock-retry loops.

## 0.6.17 - 2026-08-24

- Enabled conservative document optimization by default for newly initialized
  workspaces while preserving the current setting of existing workspaces.
- Added `--no-optimize-docs` to the single Agent entry and direct initializer,
  and documented how users can enable or disable revisions later.

## 0.6.16 - 2026-08-24

- Added optional source-faithful document optimization that stores only changed
  pages as adjacent `__revision.md` files and rebuilds unchanged content
  deterministically from approved knowledge.
- Added a conversational `context revise` entry backed by an Agent Graph Route,
  with unique target resolution, conservative Markdown validation, stale-source
  protection, and automatic return to package build after a valid correction.
- Added bundled image delivery with deterministic per-file and package budgets,
  plus path classification that keeps revision files out of ordinary knowledge
  discovery and published package paths.

## 0.6.15 - 2026-08-23

- Added explicit per-module code index plans that classify module type, stable
  entries, public protocols, output ownership, exclusions, and source lifecycle
  before extraction starts.
- Added business-neutral module archetype and facet procedures so Agents classify
  all modules first, read only the matching templates, and produce one deduplicated
  index plan before the measured extraction preview.
- Added one cached batch preview for all pending code extraction phases, with
  per-index-unit page estimates and hard stops above 300 pages in both ordinary
  and fully managed workflows.
- Added streaming custom extractor previews and generic inspection adapters so
  unsupported protocols can request supplementary material without coupling the
  community packages to a specific framework or business domain.
- Added mandatory structural probe coverage for custom adapters when a known
  TypeScript, React Router, Go, Rush, or protocol capability matches the source;
  aggregate pages remain valid only when their evidence covers those facts.
- Distinguished project-authored source-backed relationships from parser-owned
  AST relationships in extraction receipts and approved graph projections.

## 0.6.13 - 2026-08-23

- Clarified debug startup so a new workspace receives `--debug` through
  `context entry`/`context init`, while existing workspaces continue to use
  `context debug enable`.
- Created the recommended `.tmp/agent-payloads/` scratch directory during
  initialization and documented how to recreate it after scratch cleanup.

## 0.6.12 - 2026-08-22

- Added Agent guidance for publishing a completed Context build directly from
  its output directory, while preserving human review by default and using
  automatic merge only when the user explicitly requests direct publication.

## 0.6.11 - 2026-08-21

- Deferred code `source_ref` reverse lookup until every declared extraction phase is indexed, so a cold runtime continues the remaining phases instead of reporting provisional stale evidence.

## 0.6.10 - 2026-08-21

- Made repository recovery identity transport-independent by matching the full namespace/repository path while preserving pinned-commit and subpath validation.
- Added Gate-owned managed fast paths that preserve ordinary inspection and resolution capabilities while skipping redundant HTML review surfaces and dialogue resources under current-conversation authority.
- Added ordinary-mode guidance after workspace creation and source capture that explains the review/fully-managed trade-off before later approval rounds.

## 0.6.9 - 2026-08-21

- Consolidated initialization, workspace relocation, and ongoing workflow handling behind one `/c4a:context` agent entry backed by the read-only `context entry` resolver.
- Renamed the Agent Graph workflow entry from `continue` to `context` while keeping the Provider route as the sole lifecycle authority.
- Renamed the community plugin identity from `context@c4a` to `c4a@c4a` and removed the retired public init and continue command surfaces.

## 0.6.6 - 2026-08-19

- Added an optional, package-configured command sink for successful workspace activation, initialization, knowledge close, and package build runtime events; community packages remain disabled by default.
- Preserved optional runtime event sink metadata in linked and release-prepared CLI manifests.

## 0.6.5 - 2026-08-18

- Made Git-derived asset URLs part of package freshness so a changed commit or remote cannot leave a previously built package incorrectly ready.
- Made mixed-manifest repository extraction plugin-owned, allowing TypeScript and Go extractors to receive their declared manifest without a global language guess.
- Kept project-defined extraction code behind the managed subprocess boundary while retaining in-process execution for built-in deterministic phases.
- Clarified the Git requirements for commit-templated raw asset URLs in SDK and workflow reference documentation.

## 0.6.4 - 2026-08-18

- Added optional Go and Rush structural extractors, including a portable WASM Go parser, plus a route-selected technology inspection step that chooses built-in parsers or a project-owned custom adapter from repository facts.
- Upgraded the embedded Agent Graph runtime to 0.2.5 and isolated managed in-process actions with deterministic resource cleanup.
- Added configurable package asset delivery through bundled files, optional workspace processors, explicit Git raw URLs, or intentional omission with diagnostics.
- Improved prose structure validation, multi-source Review recovery, compact receipts, debug traces, and deterministic status routing for long-running knowledge workflows.
- Published the Go and Rush extractors as independent community packages without making them mandatory Context CLI runtime dependencies.

## 0.6.3 - 2026-08-17

- Upgraded the embedded Agent Graph runtime to 0.2.4.
- Added reproducible CI for Node.js 20 and 24 with the complete Context end-to-end gate.
- Added release-driven, OIDC-based npm publishing for the five public Context packages.
- Added deterministic release preparation and npm package auditing based on the existing dist packaging contract.
- Removed an unused native Tree-sitter development dependency so clean Linux installs use the shipped WASM runtime on every supported Node.js version.
- Added community contribution, support, security, issue, pull-request, dependency-update, and release-note configuration.
