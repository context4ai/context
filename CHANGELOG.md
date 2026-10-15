# Changelog

All notable changes to Context are documented here.

## 0.7.71 - 2026-10-14

- `translate prepare` uses the stale translation itself as the draft and, when Git history holds the approved version it was translated from, writes a `source_diff` from that version. Without history, `source_diff` is `null`. Translations no longer store `source_parts`; existing ones are read as before. Drafts are never overwritten and are removed after a successful submission. A kept draft (`draft: kept`) has no `source_diff` and must be aligned with the whole current article, because the source may have changed again since it was written. The draft generation records, `rebase-required`, `*.unrecorded.md`, `*.previous.md` and the per-article `source_digest` submission field are removed.
- Replacing a task in a plan amendment no longer copies its draft. The old draft directory is listed in `previous_drafts`, also when the same amendment is replayed, and in the new task's `task.md` on every preparation.
- Planning no longer adds a revised article's cited sources to its task. Omitted citations are still inherited when submitting; list a source in the plan to re-confirm it.
- Submission receipts no longer echo `resolved_references`.
- Installation instructions list Bun alongside Node.js 20: knowledge workspaces install their dependencies with `bun install`.
- A fragment may cite regions from at most three distinct source files, with several regions per file and up to eight regions in total; previously it was limited to three regions. Existing knowledge stays valid, but structures with more than three regions in a fragment cannot be read by earlier CLIs.
- Rejected revision references are reported as user input (`user-input-invalid`) with the fragment and input path: an unmatched locator, an oversized fragment, or a source outside the revision, which now lists the allowed sources. Source-update decisions that omit a candidate page or name a page that is not one are reported the same way and list those pages.
- A `heading` locator may include its ATX marker (`## Install`); the marker also selects the heading level.
- `translate prepare` reseeds a leftover draft whose body is still the unedited seed, such as one left by an earlier CLI, and gives it a `source_diff` instead of reporting it as `kept`.
- Reader pages also expose each fragment ID as an anchor, so links such as `page.md#upgrade` resolve, unless a heading on that page already owns the slug.
- When a source update settles, citations of kept pages whose text only moved in the updated source are relocated, so `verify` no longer reports them. Repository content keeps its own settlement. Kept pages whose cited text changed or cannot be confirmed are listed in the completion result's `reference_warnings`; the citations keep their previous locations, and the pages can be corrected with `context revise` after the update queue finishes.
- A revision citing a source outside its scope explains how to add new independent evidence: register the source, associate it with the requirement in `src/indexers.yaml`, then run `context task adjust`.
- A source added with `context task adjust` during a multi-page revision stays citable by the remaining queued pages. Repeating the adjustment for an unchanged source no longer discards pages already prepared in the batch.
- The translation guide explains that `source_diff` is `null` when approve-and-translate rounds ran without a commit in between.
- The README documents installing the `c4a` plugin in Claude Code or Codex by adding this repository as a plugin marketplace; the CLI is still installed from npm.

## 0.7.70 - 2026-10-14

- Revising an existing article no longer fails because its old citations are outside the new task's sources. A fragment that omits `references` keeps its validated citations; listing references re-confirms them against the task's authorized sources. Only candidate or approved citations are trusted, never a failed draft's.
- Revision tasks come with an `edits.yaml` skeleton that lists the existing fragment IDs. A complete draft written before the skeleton appeared is still submitted as a whole article.
- Plan amendments accept an article path in `after`, resolve it to the current task, and reject replaced or excluded tasks with a list of candidates. When a replacement keeps the same editing base, its draft is carried to the new task. Sources already authorized and cited by the revised article are added to its task. A plan without `stage` is rejected with an example.
- A citation can be located by `heading` (Markdown files) or by an exact `quote` instead of line numbers. The CLI resolves it to lines and echoes the result in `resolved_references`; stored locators are still line ranges.
- `translate prepare` is incremental: it reports changed sections, titles and surrounding text; writes drafts that keep unchanged translations; and writes a submission file. A draft edited against an older source must be reconciled and confirmed with `source_digest`. A draft without a generation record is set aside as `*.unrecorded.md`. Existing translations gain `source_parts` baselines once, without changing reader text.
- Website translations may translate prose in `text`, `txt`, and `plaintext` code blocks while preserving commands, paths, placeholders, block counts, and language markers. Other code blocks remain unchanged; Mermaid labels can still be translated.
- On multilingual websites, in-page and cross-page anchors keep the reader's language and scroll to the matching heading, including repeated clicks and back/forward navigation.

## 0.7.67 - 2026-10-14

- Knowledge websites open in light mode regardless of the system color scheme. The reader's light/dark and language choices are remembered per origin by default, so sites on one origin share them.
- `context build` no longer compares cited source regions or adds a "Source regions need review" notice to pages, so publishing builds no longer need the registered source checkouts. `context verify` still reports changed, moved or missing regions; run it before publishing.

## 0.7.66 - 2026-10-13

- Knowledge websites no longer collapse custom slots, such as a homepage banner, for readers who open them in dark mode. Slots remounted for these readers now finish loading before they replace the prerendered markup, so the old and new content swap in the same frame.

## 0.7.65 - 2026-10-13

- Inline code in knowledge website articles that names a cited repository file, one of its directories, or the unique name of such a directory (for example a Skill name) links to that path at the recorded revision, shown with a link icon and a dotted underline. Bare file names, uncited or ambiguous names stay plain text, as do headings and existing links.
- Writing guidance asks authors to name cited repository files, directories and Skills in inline code instead of hand-writing repository links or adding source-link columns.

## 0.7.64 - 2026-10-13

- The knowledge website homepage no longer highlights the first section in the top bar; a `site.nav` link to the current page, such as a documentation home link, is highlighted instead.
- Changelog cards show the title on one line, truncated, while collapsed, and wrap the full title when expanded; long titles no longer widen the page.

## 0.7.63 - 2026-10-13

- Section landing pages of a knowledge website show each first-level group as a card, two per row and one on narrow screens, instead of one long list.
- A `site.nav` link with `position: "start"` appears before the knowledge sections, for example a documentation home link.
- More menu targets and other pages outside every section no longer show the first section's sidebar or highlight it in the top bar; the More menu is highlighted instead.

## 0.7.62 - 2026-10-13

- Approved articles targeted by `site.more` no longer need a knowledge map entry: package builds, knowledge map adjustments and structure approval accept them, and review reports no longer list them as unplaced.
- The README, contributing, support and development guides now link to the documentation site at context4ai.org and describe the Context ecosystem.

## 0.7.61 - 2026-10-12

- Apply a reader's saved light or dark choice from the first paint of a knowledge website; pages no longer flash the system scheme before loading.
- Reader languages inherit unset homepage title, slogan, description and actions from the site's own homepage settings.
- Knowledge websites show a centred, localized 404 page with a link back home, instead of the default page offset by the sidebar.
- Planning guidance compares cited repository files by object ID before reading content and batches partial-clone object fetches, avoiding long stalls during version updates.
- Diagrams render in a single frame in offline Review as well as on websites; edge labels use a smaller font, sit centred on the edge they annotate and fully cover it, subgraph titles keep clear of the subgraph border, and site paragraph styles no longer push node text below centre.

## 0.7.60 - 2026-10-08

- Publish knowledge websites in several languages with `site.locales`; translations live under `translations/<tag>/`, track the approved content they were written from, and show a notice when stale or missing.
- Add `context translate status|prepare|submit|skip` with structural validation of sections, code blocks and links, and a workspace Route step before the version is recorded.
- Add `site.nav`, `site.more` and `site.socialLinks`; More menu items may target approved articles kept outside the knowledge map, and origin paths link to sibling applications on the same domain.
- Include translations in package freshness and add the `translation` changelog trigger.

## 0.7.50 - 2026-10-03

- Register same-repository documentation and authored Skills without copying their bodies into knowledge; maintain safe relative symlink entrances.
- Preserve historical repository paths and commits in evidence, detect relocated document regions and changes across entire Skill directories.
- Add optional repository entrance pages, original-source links, localized navigation and offline build fallbacks.
- Support repository-content references in the bundled evidence plugin and local or remote query workflows, including incomplete symlink-index coverage.
- Keep invalid-registration maintenance advisory, provide actionable repair guidance and reject invalid build inputs without replacing prior outputs.

## 0.7.43 - 2026-10-01

- Upgrade repository evidence enrichment to ABI 2, attaching compact references to individual read items without replacing original content.
- Preserve batch item identity for repeated paths and ranges; report evidence diagnostics without treating registered references as verified source reads.
- Adapt remote query guidance to bounded default reads, file-only search and per-file match limits while preserving local retrieval paths.
- Validate the bundled plugin ABI and retain known official artifact digests for safe workspace upgrades.

## 0.7.42 - 2026-09-30

- Read approved knowledge and recorded code evidence remotely without requiring a checkout; preserve local and offline retrieval paths.
- Bundle a read-only repository Wasm plugin that attaches section evidence and commit-specific source URLs to knowledge reads.
- Add `context evidence install` and workspace initialization support with explicit nested-repository scope selection and protection for custom plugins.
- Reuse ready evidence links without repeated source-registry lookup or link formatting, while retaining source verification and partial-result boundaries.

## 0.7.40 - 2026-09-29

- Use optional read-only remote code evidence at recorded repository baselines before retrieving unavailable local sources.
- Preserve repository identity, fixed commits, returned line ranges, partial batch results and permission boundaries during evidence retrieval.
- Retain local/offline query paths and existing knowledge retrieval and production source workflows.

## 0.7.36 - 2026-09-22

- Clarify source inventory counts and failure reasons without treating retained workspace evidence as a new task's missing material.
- Preserve current workflow resource receipts when resuming tasks and refresh Routes after CLI upgrades.
- Recommend thirty documents per planning stage with a fifty-document maximum; retain one newly researched repository per stage.
- Require scope confirmation for broad discovery and human intervention above five hundred documents, including delegated planning.

## 0.7.35 - 2026-09-22

- Add the community `context-plan` Skill for project research, broad source updates, staged production handoffs and Git-backed plan recovery and completion.
- Support task-scoped plan and article review delegation while retaining default human review, trusted authorization boundaries and stage continuation policies.
- Add workspace-free, fixed-identity Lark snapshot fetching and validated local snapshot import, retaining capture provenance and embedded resources without fetching them again.
- Stage Lark source registrations with shared validation and bounded atomic commits; preserve partial-success receipts and avoid unchanged registry writes.
- Add optional registration checkpoints, status queries, replay, bounded progress output, and scoped cancellation.
- Add resumable Wiki directory discovery with fixed identity, page receipts, object deduplication, and bounded throttling recovery, without creating production tasks.
- Recognize current revision drafts when binding navigation before content approval.
- Share candidate validation between navigation and Review; rejected drafts cannot authorize new bindings.
- Return unplaced article diagnostics and navigation recovery guidance with review reports.
- Capture independent embedded resources concurrently with bounded throttling retries and a shared cooldown.
- Recognize nested application-scope failures without changing resource identity; preserve usable whiteboard previews when raw export is denied.
- Inline complete small workflow Routes while retaining file-based fallback and existing authorization and read-receipt checks.
- Keep capture-only requests out of article production, reuse URL registration and capture receipts, and retain string diagnostics in compact output.
- Keep source baseline details in provenance and citations rather than reader-facing article prose.

## Unreleased

## 0.7.34 - 2026-09-22

- Restrict Bot-to-User fallback to whole-document reads, restarting pagination
  and keeping the selected identity fixed for every embedded resource.
- Use the official same-identity image preview after download permission denial,
  label previews explicitly, and retain unavailable-resource references without
  requesting another identity's credentials.
- Recognize structured HTTP permission failures and preserve partial capture
  diagnostics through source manifests and workflow warnings.
- Reuse query and delivery instructions, verify symbolic version boundaries,
  and resolve citations against the actual inspected source revision.

## 0.7.30 - 2026-09-21

- Add explicit User/Bot identity selection for Lark reads, retaining User as
  the default and allowing bounded authorization fallback from Bot to User.
- Let capture instructions limit task-wide document image collection with
  ON/OFF/count policies, defaulting to ten documents and Agent self-checks.
- Search approved knowledge before preparing original sources, reuse query
  checks and batch evidence reads and citations. Compare versions only when
  the question or evidence warrants it, retaining source and freshness limits.

## 0.7.29 - 2026-09-21

- Explain decisive mechanisms and scoped evidence in complex query answers,
  with semantic sections where helpful and concise answers for simple questions.
- Assess code evidence needs after document investigation and before article
  planning, with an explicit assessment for plans exceeding 30 article tasks.
  Keep the assessment advisory and independent document work unblocked.
- Reuse authorized repository recovery choices and continue from returned
  preparation handles without restarting accepted work.
- Diagnose missing repository directories and broken module links separately
  from Git startup failures, with actionable recovery commands.

## 0.7.26 - 2026-09-21

- Expose `context-inspect-search` to configured host routing while keeping its
  user-facing command explicit, so knowledge Bots can invoke it without
  searching installed plugin files.

## 0.7.25 - 2026-09-21

- Distribute package inventory and website mapping metadata under
  `others/context/` while retaining the existing package-root copies.
- Let installed knowledge-query Skills locate fully installed packages through
  the distributed inventory and resolve website maps from either supported
  metadata location.

## 0.7.23 - 2026-09-20

- Add stable Agent policy switches for production entry, source access, Review,
  package choices, Git delivery, publication and recovery. Preserve Route
  authority while allowing Bot overrides above managed and ordinary defaults.
- Reduce repeated confirmation for bounded work-start reports, previously
  approved deletion or restoration scopes and explicit Review recovery, while
  keeping top-level navigation and large-image decisions visible.
- Keep Lark capture on the available CLI by default and support an isolated
  fallback executable through `CONTEXT_LARK_CLI_BIN`, without replacing the
  host's global `lark-cli`.
- Clarify generated workspace version and delivery guidance so version recording
  does not imply a commit or publication, and already published content still
  requires a version increment.
- Require an explicit agent for local plugin installation. Host targets use
  repository subdirectories; `all` installs every host, `auto-detect` detects
  repository host directories with a standalone fallback, and `standalone`
  writes directly to the supplied directory. Global installation is unchanged.

## 0.7.20 - 2026-09-18

- Query installed or host-provided knowledge packages without requiring a local
  workspace or CLI; prepare relevant sources concurrently with reading.
- Retrieve recorded source revisions in reusable isolated sparse checkouts,
  without entering production recovery or changing registered source state.
- Consolidate inspection guidance and require concise, source-backed answers.
- Support repository-local skill installation with host detection, explicit
  host targets and conflict protection, without changing global configuration.
- Include the document capture, revision recovery and Review fixes documented
  in 0.7.18 and 0.7.19 in this community release.

## 0.7.19 - 2026-09-17

- Explain missing requirement/source associations when adding independent evidence to an active revision, with safe recovery instructions and unchanged authorization checks.
- Render removed Review content with red text and the Remove badge, without the colored section background or left border.

## 0.7.18 - 2026-09-17

- Accept equivalent Lark resource count maps regardless of JSON key order; preserve validation of incorrect counts and resource records.
- Scope approved-page revision capture gates to the revision evidence; preserve global source inventory and normal production capture gates.
- Explain missing revision stages and discourage task cleanup or source deletion as error recovery.
- Document acquisition failures now retain valid registered snapshots or report deferred evidence gaps without blocking unrelated delivery; repository restoration and validation remain strict.
- Include the updated context-inspect-search workflow for isolated source recovery, recorded-revision comparison, and bounded read-only investigation.

## 0.7.17 - 2026-09-17

- Share reader typography between websites and Review, fix navigation style leakage,
  and use theme-aware green additions, amber changes and red removals in both modes.
- Apply review status colors to code and diagrams; keep modification badges aligned
  with content and show removed navigation and previous content explicitly.

- Keep version checkpoints current when the first website build creates the
  default theme; retain detection of custom theme edits and keep freshness reads side-effect free.

- Allow accepted draft articles to be placed in the knowledge map before Review,
  while preserving candidate integrity and navigation validation.
- Explain partial delivery in production Routes and work-start guidance so
  unrelated source recovery tasks do not block completed article review.

## 0.7.16 - 2026-09-17

- Share configurable light/dark color tokens across websites, Review and diagrams;
  scaffold an optional workspace theme file and fall back when it is absent.

- Expand diagram authoring guidance with eleven complete bilingual scenario
  recipes, source-preserving Mermaid examples and semantic repair guidance.
- Share themed Mermaid rendering between websites and offline Review reports,
  with fit, zoom, full screen, source fallback and default ELK flowchart layout.
- Keep diagram source in Markdown and include browser assets only in reports
  that contain diagrams.

## 0.7.12

- Allow partial delivery to enter Review before checking the approved link graph;
  keep link validation mandatory before close and build.
- Preserve unfinished production while an independent article revision is
  reviewed, built, retried or completed without changes.
- Refuse lifecycle cleanup while production still has unfinished work, even
  when a separate revision has completed its own Review.
- Preserve Mermaid diagrams' natural maximum width and use compact navigation
  through tablet widths to prevent horizontal page overflow.

## 0.7.9 - 2026-09-11

- Unify website navigation and LLMS ordering around the editable knowledge map,
  retain newly approved pages, and publish websites beside knowledge packages.
- Add workspace SemVer and source-attributed changelog cards, recording versions
  before final builds and returning the next workflow Route directly.
- Fix LLMS browser UTF-8 detection, duplicate landing links and deployment-base
  paths; preserve consistent layout for LLM Docs and Changelog.
- Support bounded parallel knowledge production with isolated worker outputs,
  coordinator-owned writes and recovery back to serial execution.
- Reduce intake and Provider-selection overhead with batch title metadata and
  validated compact selections; improve task recovery and parser preparation.

## Earlier unreleased work

- Replaced the parallel Indexer authoring and review paths with one current-action
  workflow covering Provider setup, Partition, Author, Composer, Layout, final
  Review, close, recovery, and targeted revision.
- Connected runtime parsers, captured Markdown, and accepted extension fragments
  through one authorized workset projection while keeping remote tool enrichment
  optional and local-first.
- Removed the legacy material-answer, metric-audit, hard-rule, document-optimization,
  prose compile, read-window, duplicate Review, and Indexer-specific close surfaces.
- Upgraded the bundled community Code and Markdown Indexers with semantic partitioning,
  reader-focused templates, compact metadata, visible page titles, and deterministic
  package projection.
- Added deterministic local dogfood summaries derived from approved knowledge,
  close, verify, build freshness, and runtime cleanup without retaining Review or
  evidence audit ledgers.
- Added and integrated the TypeScript, JavaScript, Go, Rush, MDX, Thrift, Proto,
  OpenAPI, GraphQL, CSS, SCSS, SQL, JSON, YAML, and TOML parser capability chain.

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
