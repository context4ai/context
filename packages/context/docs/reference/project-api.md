# Project API

Import from `@c4a/context` in `src/index.ts`.

## `defineProject`

```ts
import { defineProject } from "@c4a/context";

export default defineProject({
  sources: [],
  phases: [],
  packages: [],
});
```

The project file is executable TypeScript, but the preferred style is a small
declaration list. Put heavy logic in imported transform files.

## Sources

A source is a stable knowledge boundary, not only a display label. Repo, file,
and Lark sources use a date batch plus a concrete module name; multiple code or
document modules may share the date. The flattened selector `YYYYMMDD/module`
is the source identity used by phases, snapshot paths, and source refs.
Codegraph NodeRef/ViewRef and knowledge paths use the stable module name without
the date:

```text
knowledge/<collection>/<slug>.md
knowledge/<collection>/<containment>/<slug>.md  # only for an intentional hierarchy
knowledge/codegraph/<module>/symbol/<slug>.md
repo:<date>/<module>#symbol:...
file:<date>/<module>/<document>#span:...
lark:<date>/<module>/<document>#span:...
capture:file:<date>/<module>
align:lark:<date>/<module>:architecture
dist/<source-name>-kb/...
```

Choose the module boundary before extraction. In a monorepo, register each
confirmed package/subdirectory under the same date batch. A repo root that
resolves to multiple modules is for inspection; it is not an extraction unit.
Approved codegraph paths use the stable module name; the date remains only in
source selectors, phase ids, and evidence refs:

```text
knowledge/codegraph/module-a/...
knowledge/codegraph/module-b/...
```

For prose Views, provide a stable filename `slug` and omit `path`; the CLI
derives the path. Omit `containment` when the page is an independent collection
entry, producing `knowledge/<collection>/<slug>.md`. Set `containment` only
when the approved structure intentionally places the page under a parent path;
it is not a required source/module wrapper.

The registry stores this as one date entry containing several `modules` entries,
and materializes each module at `sources/repo/<date>/<module>`.
Repo module names are project-wide codegraph identities and therefore cannot be
reused under another date batch. Refresh an existing module through its original
date/module selector.
When a repo module and the Context workspace share the same Git root, the CLI
normalizes even an absolute `--local` input into a path relative to the
workspace and stores the package directory as `subpath`. Materialized repo
links always use relative symlink targets. This keeps the registry and links
valid when the whole checkout moves. Cross-repository absolute checkout roots
remain absolute because no shared movable root can be assumed.
The date entry must be a valid calendar date in `YYYYMMDD` form. Use
`context source ensure <date>` or `context source inspect <date>` for the whole
batch, and `<date>/<module>` when targeting one module.

```yaml
sources:
  - name: "20260712"
    modules:
      - name: module-a
        local: ../monorepo
        subpath: packages/module-a
        git:
          remote: https://git.example.com/product/monorepo.git
          ref: <full-commit-sha>
      - name: module-b
        local: ../monorepo
        subpath: packages/module-b
        git:
          remote: https://git.example.com/product/monorepo.git
          ref: <full-commit-sha>
```

File and Lark registries use the same outer shape. Their modules hold local
document boundaries or remote document identities:

```yaml
sources:
  - name: "20260712"
    modules:
      - name: local-manual
        local: ../manual
      - name: api-guide
        local: ../api-guide
```

### Batch source registration

Use one command when a user confirms several source modules together:

```bash
context source add batch [YYYYMMDD] --input <sources.yaml|json|-> --format json
```

The payload is a non-empty `sources` array. Every item requires `type`. Repo
also requires `module` and accepts `local`/`remote`/`ref`. File requires `local`
and accepts `include`; Lark accepts exactly one of `url`, `docToken`, or
`wikiToken` plus optional `title`. File/Lark `module` is optional and is derived
with the same lowercase path-safe rule as the single-source commands. Resolved
module identities must be unique across the batch.

Source mutations share a project write lock, and every registry file is
replaced atomically. Never run separate `source add` processes in parallel. A
batch executes items in order; if a runtime item fails, its error lists the
completed items and the same payload may be rerun idempotently.

```yaml
sources:
  - name: "20260712"
    modules:
      - name: user-manual
        url: https://example.larksuite.com/wiki/example-a
      - name: migration-guide
        url: https://example.larksuite.com/wiki/example-b
```

### `source(name)`

Reference one registered source by name. The reference is type-neutral in
project code; each phase resolves it through the registry and checks whether it
is a repo, file, or lark source:

```ts
import { source } from "@c4a/context";

const productDocs = source("product-docs");
```

### `source(namespace, module)`

Reference one registered repo module. Use the date batch and module name
returned by `context source add repo`:

```ts
const moduleA = source("20260712", "module-a");
const moduleB = source("20260712", "module-b");
```

These references resolve to `20260712/module-a` and `20260712/module-b`;
extraction and verification remain independent.

### `source(namespace, module, { type })`

Reference one file or Lark module under a date batch:

```ts
const localManual = source("20260712", "local-manual", { type: "file" });
const userManual = source("20260712", "user-manual", { type: "lark" });
```

These references produce module-scoped phase ids and manifest entries without
treating the date as one document identity. Captured document files remain
siblings under `sources/file|lark/<date>/` and share the date-level
`manifest.json`; the logical `date/module` identity does not create another
directory level.

For a confirmed multi-document request, declare one capture phase per module.
While any module is uncaptured, `context status --format json` selects either
the `route.capture.configuration-required` Route with
`workflow.current.configuration`, or the `route.capture.pending-target` Route
with the next declared command in `workflow.current.commands`.

Each command item declares its effect and availability. The current route's
`gate` identifies the decision and authority boundary. Write commands are bound
to the workflow revision; after one succeeds, rerun status instead of reusing
the old command. An external command also declares
`execution.target: agent-host`; execute it as a top-level Agent-host action so
network and credential-store access are not lost inside a restricted child
sandbox.

### `allSources("repo")`

Reference all repo sources as one collection:

```ts
import { allSources } from "@c4a/context";

const repoSources = allSources("repo");
```

Use `allSources("repo")` only when the project should list every registered
repo module. Prefer a specific `source("date", "module")` for extraction phases.

## Phases

Phases declare reads and writes. The runtime can inspect them, dry-run them, and
record per-phase logs.

The API exposes the current declared workflow only. Declare file/lark sources,
capture phases, prose structure gates, source-bound compile phases, code
extraction phases, review gates, close/build, and packages explicitly. The CLI
then routes work through `context status`, `context run <phase-id>`, `context
review html/apply`, `context close`, `context verify`, and `context build`.

For Agent and automation output, use `context verify --format json --compact`.
It returns deterministic groups, counts, affected-scope totals, and a few
representative samples instead of repeating every issue. Read the complete,
auditable issue set only when needed with `context verify --view diagnostics
--page-size 25 --format json`; follow its executable pagination command without
inventing overlapping file ranges.

### Status declaration coverage

`context status --format json --view full` includes a `declarationGraph` and
`configurationGaps` for document workflows. Each row reports capture, align,
compile, and Review coverage for a canonical source plus collection. Gaps are
non-blocking before structure confirmation. Once a structure is confirmed,
compile routing is exact: phase selection uses canonical source plus collection,
and candidate progress remains bound to the current `structure_digest`. A
compile phase from another collection is never used as fallback.

Captured align targets that do not yet have an active confirmed structure are
reported in `pendingStructureTargets`. They remain unfinished even when the
currently active structures have been closed, verified, and built. Missing
compile or Review declarations route to `needs-prose-configuration`; once the
declarations are complete, status returns the exact align investigation command
for the next target. A built package does not freeze the workspace or require a
new workspace for later sources.

`context status --format json` defaults to the compact workflow route, target,
progress, counts, and aggregated diagnostics. Use `--view full` only when
source, phase, package, and lifecycle inventories are needed for debugging.

### Current-conversation managed execution

`context status --managed --format json` exposes
`executionMode: { mode: "managed", scope: "current-conversation" }` and resolves
eligible human gates into immediate commands. The flag is deliberately absent
from `defineProject`: callers start each workflow evaluation loop with managed
status, then execute the returned revision-bound command unchanged. Returned
commands carry a compact current-conversation marker instead of repeating every
authority. A later process or conversation gets ordinary human-gated behavior
by default.

Managed Review is atomic and scope-validated:

```bash
context review approve-all <collection> --managed --format json
context review approve-all --all --managed --format json
```

The default JSON result reports counts and change totals without listing every
candidate id or materialized path. Add `--verbose` only when debugging requires
the complete candidate and page details.

Managed structure confirmation and Review use only the revision-bound commands
returned by `workflow.current`. Source boundaries and unread source bodies,
external operations, payload validation, deterministic close, and verification
errors are never bypassed.

For consecutive mechanical routes, the Agent may run:

```bash
context run --managed --until blocked-or-complete --format json
```

This is a bounded host loop over the same revisioned routes. It stops before
read-only interpretation, project configuration, unresolved authority,
diagnostics, or a non-unique command plan; it does not add another workflow
entry or make semantic decisions.

### `captureFile`

Capture a registered file source into a committed normalized document snapshot.
Default file capture treats `.md` files as document bodies. For MDX
documentation sites that use `_meta.json` route metadata, declare the processor
in `src/index.ts`:

```ts
captureFile({ source: docs, processor: mdxJsonDocs() });
```

With that processor, `.md` and `.mdx` are document bodies. Included
`_meta.json` files are captured as route metadata assets, surfaced in
`read-plan` / `source-index`, and mechanically projected into
`__context_route_metadata.md` so route facts can be cited as evidence. The route
projection records the canonical extensionless route form instead of treating a
local `.html` URL as the source of truth.

MDX component text is extracted separately: string props such as `title`,
`label`, `description`, `href`, `to`, and component children are projected into
`__context_mdx_component_text.md` as generated evidence. The original `.mdx`
file remains in the snapshot unchanged. If a documentation page renders body
text only at runtime from application code or remote data, configure that
documentation site as an explicit source boundary instead of hand-writing route
or body facts.

```ts
captureFile({ source: docs });
```

Phase id:

```text
capture:file:<source-name>
```

Register the source first with
`context source add file [YYYYMMDD] --module <module> --local <path>`.
The first registration requires `--local`; the registry may later keep `local`
only as a refresh hint while committed snapshots remain verifiable. Multiple
file modules may share one date. When `--module` is omitted, the CLI derives it
from the local file or directory name.

### `captureLark`

Capture a registered Lark / Feishu document source into a committed normalized
Markdown snapshot:

```ts
captureLark({ source: handbook });
```

Embedded resources are materialized with deterministic defaults. Video remains
reference-only unless a project opts into bundling, and byte limits prevent an
unexpected document from expanding the workspace without bound:

```ts
captureLark({
  source: handbook,
  resources: {
    videos: "bundle",
    maxBytesPerResource: 20 * 1024 * 1024,
    maxTotalBytes: 200 * 1024 * 1024,
  },
});
```

Phase id:

```text
capture:lark:<source-name>
```

Register each source with
`context source add lark [YYYYMMDD] --module <module>` and exactly one identity
flag: `--url`, `--doc-token`, or `--wiki-token`. Multiple documents may share
one date batch; when `--module` is omitted, the CLI derives an opaque,
credential-safe module id. Capture reads the
remote document through the CLI runner as structured Docx XML. Context keeps a
redacted XML audit asset, projects supported blocks deterministically into
readable Markdown, and materializes required inline resources such as images,
attachments, Sheets, Bases, whiteboards, diagrams, and synced blocks. Navigation
resources and default video capture remain explicit references. The projection
does not infer or summarize document meaning. Its fidelity and resource reports close discovered blocks
against converted and intentionally skipped blocks and reports evidence
completeness separately from Markdown projection quality. Unknown non-empty XML
blocks receive a generic, auditable, non-interactive projection and do not block
downstream work. A remote whiteboard or diagram explicitly confirmed as deleted
is preserved as an unavailable-resource notice with
`document.resource.source-missing` and a warning. An embedded resource whose
export is explicitly rejected as `authorization/permission_denied` is retained
the same way with `document.resource.permission-denied`. Missing scopes,
unresolved external-resource identity, retryable failures, and unclassified
authorization errors remain evidence errors and prevent downstream Review.
Snapshot files live under `sources/lark/<date>/` as sibling document files
tracked by one compact date-level `manifest.json`. Each module keeps one raw
`source.xml`, one consolidated `capture-report.json`, and its actual downloaded
or structured resources under `assets/<module>/materialized/`; it does not emit
one descriptor file per embedded resource. Access credentials and transient
signed media URLs are not written into the workspace.

Approved resource bytes are projected to content-addressed
`knowledge/assets/<kind>/` paths. KB build copies selected resources to
`others/assets/<kind>/` inside the package and rewrites page links. See
[Lark Resource Materialization](../guides/lark-resources.md) for the complete
resource table and storage lifecycle.

Use a typed document reference in project declarations:

```ts
const handbook = source("20260712", "user-manual", { type: "lark" });
const localDocs = source("20260712", "local-manual", { type: "file" });
```

### `alignProse`

Open the prose structure gate for document evidence:

```ts
alignProse({
  source: docs,
  collection: "architecture",
});
```

`collection` is an internal knowledge classification, not a package directory.
Package build maps `codegraph`/`business`/`product` to `wikis/`,
`architecture`/`sop`/`faq`/`decision`/`incident` to `guides/`,
`standards`/`test` to `rules/`, and `feats` to `feats/`. The complete output
contract is documented in [Package Outputs](../guides/package-outputs.md).

When `source("name")` is type-neutral, the SDK may declare
`align:source:<source-name>:architecture`; the CLI resolves it to
`align:file:<source-name>:architecture` or `align:lark:<source-name>:architecture` after
reading the registry.

Align is a gated workflow. It produces and validates a structure draft, not
final approved body:

```bash
context run align:file:<source-name>:architecture --view read-plan --format json
context run align:file:<source-name>:architecture --view source-index --compact --format json
context run align:file:<source-name>:architecture --view span-detail --span <source-ref> --format json
context run align:file:<source-name>:architecture --view span-text --span <source-ref> --format json
context run align:file:<source-name>:architecture --view existing-knowledge --query <title-or-stable-ref> --format json
context run align:file:<source-name>:architecture --view schema --format json
context run align:file:<source-name>:architecture --view semantic-rules --format json
context run align:file:<source-name>:architecture --validate --input <structure.yaml> --format json
context run align:file:<source-name>:architecture --view diagnostics --input <structure.yaml> --format json
context run align:file:<source-name>:architecture --view structure-summary --input <structure.yaml> --format json
context run align:file:<source-name>:architecture --stage --input <structure.yaml> --format json
```

When `workflow.current.batch` is present, several independent document slots
can be prepared in one Agent pass and validated or staged through one command:

```yaml
schema: context.prose.structure-batch.v1
items:
  - phase_id: align:file:<source-a>:architecture
    input: .tmp/agent-payloads/<source-a>-structure.yaml
  - phase_id: align:file:<source-b>:architecture
    input: .tmp/agent-payloads/<source-b>-structure.yaml
```

```bash
context run --batch-input .tmp/agent-payloads/prose-structure-batch.yaml --validate --format json
context run --batch-input .tmp/agent-payloads/prose-structure-batch.yaml --stage --managed --format json
```

Batch preflight validates every payload before writing. Stage writes ready
slots serially; it does not merge documents or decide their semantic shape.

Align results expose a recommended `payload_target.path` under
`.tmp/agent-payloads/`. Agents should use it for transient structure inputs and
may remove the file after a successful stage. The CLI continues to accept an
explicit alternative path; this is an authoring convention, not validation.

For the ordinary path, `read-plan` is a complete authoring packet: it includes
the payload contract, a budgeted canonical source-ref map, exact source-body
resources, and a direct `--stage` command. Read the bodies, author the payload,
and run that stage command. Request `source-index` only when the packet reports
omitted refs, and request `existing-knowledge` only when reusing or checking an
approved identity. The separate schema and validate views are optional
diagnostic tools, not required lifecycle steps.

`--validate`, `--stage`, and `--confirm` are mutually exclusive operations. An
`--input` without an operation is rejected unless the selected view explicitly
consumes that input. Deterministic boundary repairs run internally before the
result is returned. `self_healed` includes input/output Section counts, the
number of original Sections split, and structural reason codes. Stage performs validation before writing and returns the
same diagnostics on failure; in managed mode, a valid stage also confirms the
structure. Successful standalone validation returns a stage command with the
same file path. JSON run output keeps `next_action` first;
schema and full reports stay behind explicit Views, while `--verbose` restores
the full phase result and repeated contracts. Long diagnostics return a compact
first page plus an exact diagnostics continuation command.

Validation returns `state: ready | repair-required | invalid`. Only `ready`
sets `valid: true` and may proceed to stage. `error_free: true` with
`state: repair-required` means no error diagnostic remains, but a declared
confirmation blocker still requires repair; it is not a successful result.

`existing-knowledge` is the authoring-time lookup for approved identities. It
returns stable NodeRefs, ViewRefs, titles, tags, collections, and section counts
without exposing workspace storage paths. `--query` performs deterministic
case-insensitive exact/prefix/substring matching; `--collection`,
`--node-type`, `--page-size`, and the returned continuation command narrow or
page the same View. Use it after reading source evidence and before introducing
a new Node identity. Structure validation remains the final duplicate gate.

Align and compile evidence results include `semantic_rules`. Its `required`
array is the rule subset selected for the current judgment, with a selection
reason and content digest for each rule. `handle`, `digest`, and
`rules_version` are stable cache checks: reuse a loaded ruleset only while its
content remains in the active context and both handle and digest still match.
After context compaction, resume the paginated `semantic-rules` View for the
returned required subset; a handle alone does not imply that the rule text is
still available.

Document evidence boundaries are deterministic rather than semantic.
`source-index` and `chunks` mark Markdown AST blocks with
`boundary_role: "markdown-ast-block"` and `section_candidate: true`.
`span-text`/`span-detail` mark each returned page as
`range_role: "transport-page"` and `section_candidate: false`; pagination line
ranges are never structure boundaries. Structure validation blocks repeated
fixed-width line grids that cut through AST blocks and reports sections that
cross multiple heading paths, without classifying document topics.

After capture, the capture phase itself exposes collection-neutral `read-plan`,
`source-index`, `span-detail`, `span-text`, and other read-only evidence views.
Status selects `route.document.classification-required` until every captured
target has an evidence-backed, user-confirmed align declaration. Align then
adds `schema` and `structure-summary` for structure work. Agents should not
scan `sources/` or `.tmp` to invent evidence. They may read only the exact
source-body files selected as required resources by the current Route; those
files carry stable content digests and must be read in full before a receipt is
reported. Read all required direct paths, then execute the Route's single
`resources.after_read.command`; the CLI writes and carries the merged receipt
set without requiring Agent-authored JSON. That acknowledgement response
already contains the re-evaluated `workflow.current`, so no additional status
command is needed.

Generated Context Views use the same content-addressed rule. Materialization
returns a receipt-set path and an exact post-read command. Read the complete
file, then execute that command; unchanged content remains current across
workflow revisions, while write and external commands still require the exact
current revision.

Compile `read-plan`, `blockers`, and `diagnostics` Views are workspace-read-only
and may run concurrently. Compile `--validate`, compile `--stage`, structure
confirmation, Review apply, and close are serial operations.

Structure payloads use `schema_version: "context.structure.v1"` and canonical
`file:` / `lark:` `#span` source refs. A one-file-to-one-page plan is represented
as ordinary `nodes[]` and `views[]` in the structure. It does not bypass
structure confirmation or compile. Continuity applies to each Section, while one View/Page may
contain multiple independently retrievable continuous Sections. Deterministic
boundary splitting is applied internally during validate/stage; it is not a
separate Agent-authored payload or approval step.

### `compileProse`

Compile confirmed prose structure into reviewable source-bound draft pages:

```ts
compileProse({
  source: docs,
  collection: "architecture",
});
```

When `source("name")` is type-neutral, the SDK may declare
`compile:source:<source-name>:architecture`; the CLI resolves it to
`compile:file:<source-name>:architecture` or `compile:lark:<source-name>:architecture` after
reading the registry.

Phase id:

```text
compile:file:<source-name>:architecture
compile:lark:<source-name>:architecture
```

Compile requires confirmed CLI-managed lifecycle structure. It freezes the
current structure for the compile round; if the user wants to change nodes,
section ownership, or relationships, return to the align/structure gate.

Common commands:

```bash
context run compile:file:<source-name>:architecture --view read-plan --format json
context run compile:file:<source-name>:architecture --validate --format json
context run compile:file:<source-name>:architecture --stage --format json
context run compile:file:<source-name>:architecture --view diagnostics --format json
```

Compile validates the complete confirmed source/collection slot before writing
any candidate, then materializes the slot atomically. Section bodies are
source-mirrored from the confirmed spans; the Agent does not create a separate
compile-actions payload. Each canonical source plus collection remains an
independent structure slot. When other captured align targets remain pending,
status routes to those slots before opening one collection-level Review
payload. `context close` is blocked while a planned View is unprepared, still
draft, or rejected without a structure revision.

Relationships stay in `structure.yaml` typed edges in current output; compile
does not infer relationships or inject relation markers into verbatim body.

### `extractTs`

Extract exported TypeScript / TSX symbols into draft candidates:

```ts
extractTs({
  source: componentLib,
  collection: "codegraph",
});
```

Options:

| Field | Meaning |
|---|---|
| `source` | `source("date", "module")` for one repo module |
| `collection` | Code extraction uses `"codegraph"` |
| `include` | Optional glob list inside the selected source; default is `["src/**/*.{ts,tsx}"]` |
| `mode` | `"exports"` (default) traces public exports from automatic or configured entries; `"scan"` uses every file matched by `include` as an entry root |
| `entries` | Optional source-relative entry files for `"exports"` mode. They override `package.json` entry detection and live only in the Context project configuration |
| `exportedOnly` | Defaults to `true` in `"exports"` mode and `false` in `"scan"` mode |
| `indexUnits` | Stable module/index plans used for ownership, capability and per-unit scale checks. A single-source exports-only package gets a compatible public-contract default; scan, collection and custom extraction require an explicit plan before formal writes |
| `transform` | Optional markdown transform function or functions |

An explicit index unit records production intent rather than parser settings:

```ts
extractTs({
  source: componentLib,
  collection: "codegraph",
  indexUnits: [{
    id: "component-public-api",
    inputSources: ["20260712/component-lib"],
    outputOwner: "component-lib",
    moduleType: "sdk-library",
    moduleTypes: ["sdk-library"],
    facets: ["public-api", "plugin-extension"],
    moduleTypeEvidence: ["package.json exports and src/index.ts public entry"],
    outputProfile: "public-api-reference",
    responsibility: "Document stable exported component contracts.",
    entries: ["src/index.ts"],
    pageKinds: ["module-map", "public-contract"],
    protocols: [],
    dependencies: [],
    exclusions: ["src/internal/**", "src/generated/**"],
    lifecycle: "authoritative",
    sourceOfTruth: "src/index.ts",
    capability: "complete",
  }],
});
```

`inputSources` names registered evidence sources; `outputOwner` is the one
stable page owner used for accounting and navigation. `capability` is
`"complete"`, `"project-adapter"`, or `"material-required"`. The last value
stops the Route until the plan is narrowed or reliable source material is
provided.

`moduleType` is the primary compact classification. `moduleTypes` may add other
applicable archetypes for a hybrid module, while `facets` records composable
behaviors such as routing, protocol consumption, events, persistence, plugins,
release, or cross-module chains. `moduleTypeEvidence` records the inspected
paths that support the classification. Classify first, then read the matching
Route-provided code-index templates, and only then finish the extraction plan.
`lifecycle` is `"authoritative"`, `"generated"`, `"mirrored"`, `"legacy"`,
or `"vendored"`; derived sources normally use `"provenance-only"` rather
than duplicating reader-facing pages. These are generic project facts, not
framework names inferred by the CLI.

`moduleType`, `moduleTypes`, `facets`, `outputProfile`, `lifecycle`, and
`capability` are runtime-validated closed values. Supported output profiles are
`module-map`, `application-map`, `protocol-index`, `service-boundary`,
`runtime-map`, `public-api-reference`, `command-map`, `adapter-contract`,
`module-registry`, `cross-module-flow`, and `provenance-only`.

`extractTs()` projects one candidate page per selected symbol, and each source
can belong to only one of its index units. Use `extractCustom()` for aggregated
maps, registries, protocol indexes, cross-module flows, or multiple candidate
owners over one source; custom candidates declare their owning `module`.

`source` is the only package/module boundary. `include` narrows files inside
that source; it does not select a second module. Standard packages can omit
`entries` and use `package.json` `exports`, `main`, or `bin` detection. For a
non-standard package, configure `entries` in the Context project instead of
editing the source repository:

```ts
extractTs({
  source: componentLib,
  collection: "codegraph",
  include: ["src/**/*.ts"],
  entries: ["src/api.ts"],
});
```

When the intended knowledge scope is every declaration in the selected files
rather than a public export graph, use `mode: "scan"`. Scan mode does not accept
`entries`; `include` supplies its file roots. Because scan mode can expand
internal declarations into a symbol catalog, it requires an explicit
`indexUnits` plan before formal extraction.

Entry failures use the stable machine code `NO_ENTRY_DETECTED`. This includes
`entries: []`, exports mode with no detected/configured entry, and scan mode
with no files matched by `include`; these cases never succeed silently.

TypeScript extraction reads the selected module's `tsconfig.json` or
`jsconfig.json`. JSONC comments/trailing commas, local or installed `extends`,
`compilerOptions.baseUrl`, and `compilerOptions.paths` are used for export
tracing and internal dependency relations, so aliases such as `@/*` resolve to
their source files.

In monorepos, make each package/subdirectory a module boundary. Register the
chosen package path with `context source add repo [YYYYMMDD] --module <module> --local <package-dir>` and
reference it with `source("<date>", "<module>")`.
Do not use `include` to choose a
package from a larger monorepo source.

Use `context source inspect <date>/<module>` to list detected module/package
boundaries before choosing the source. Use `context run <phase-id> --dry-run
--format json` to check the resolved modules, file counts, symbol counts, and
candidate estimate before writing the ignored lifecycle candidate ledger. The dry-run
preview also includes `knowledgeTree` and `knowledgePathExamples`, which show
where approved Markdown will land after review apply.
Its module and total summaries distinguish `discoveredFiles`, `analyzedFiles`,
`skippedFiles`, `symbols`, and `relations`. Module summaries also expose the
resolved `entryFiles`, exported/internal symbol counts, and a structural
`candidateKinds` count. These fields describe extractor output only; the CLI
does not infer which symbols are meaningful to a particular product or
audience. Modules with skipped files include the deterministic traversal
reason, such as files not reachable from exports-mode entries.

Before formal extraction, the workflow runs one batch preview for all pending
phases. Each `indexUnits[]` result reports projected Markdown pages, output
profile/owner, content-byte estimates, and risks. Per unit, 0–100 pages is
normal, 101–300 is a warning that may continue, and more than 300 is blocked.
The limit is non-delegatable, including in managed mode. A passing preview is
cached by digest under `.tmp/context-runtime/extract/previews/` and reused by
formal extraction when the source scope, phase declaration, project `src/`,
dependency lock, and preview protocol still match. A missing cache is
recoverable by rerunning the preview. The report includes cache hits,
extractor invocation count, current and projected page counts, changes,
exported/internal distribution, top directories, and advisory large-page
risks; only the 300-page per-unit limit is a hard scale gate.
A batch-total page advisory and quality risks such as a thin custom aggregate
remain report signals and do not create another Gate.

Phase id shape:

```text
extract:<source-name-or-repo>:codegraph
```

Codegraph extraction has two execution policies:

- `context run <phase-id>` is the Agent/user default. The first run sends every
  code symbol to Review. Later runs preserve unchanged approved symbols and send
  only `add`, `update`, and `remove` deltas to Review. After every phase result,
  the Agent re-evaluates `context status --format json`; only
  `workflow.current` decides whether Review is now required.
- `context run <phase-id> --auto-promote` is the explicit CI/CD path. It is valid
  only for `phase.extract.ts` codegraph phases, applies deterministic code deltas
  without Review, refreshes deterministic close when approved knowledge changed,
  then runs project verification. Close or verification errors make the command
  fail; JSON output reports applied/materialized/removed counts plus a `close`
  state of `refreshed`, `current`, or `not-required`. Package build remains a
  separate pipeline step; existing package outputs are reported stale.

This policy never auto-promotes architecture, business, decision, test, or
other semantic knowledge. Agents must not infer a human gate from a phase-local
result. Human gates and their inspection/resolution Actions are exposed only by
`workflow.current`.

Approved codegraph sections use the local evidence form
`src-N#symbol:<file>:<symbol>:<kind>@<digest>`. The file segment makes reverse
lookup exact when multiple files contain the same symbol name, kind, and digest;
the complete ref remains opaque to agents. New pages keep only top-level
`candidate_fingerprint` and do not emit `code_origin`.

### `extractCustom`

Use a project-owned extractor when code facts cannot be represented by the
TypeScript symbol extractor, for example a language-specific parser or an
aggregated repository protocol:

```ts
extractCustom({
  id: "extract:service:protocol",
  sources: [service],
  collection: "codegraph",
  indexUnits: [{
    id: "service-protocol",
    inputSources: ["20260811/service"],
    outputOwner: "service",
    moduleType: "api-service",
    moduleTypes: ["api-service", "adapter"],
    facets: ["protocol-provider", "protocol-consumer", "cross-module-chain"],
    moduleTypeEvidence: ["src/protocol.ts registration and src/handler.ts dispatch"],
    outputProfile: "protocol-index",
    responsibility: "Document the stable service protocol boundary.",
    entries: ["src/protocol.ts"],
    pageKinds: ["protocol-index"],
    protocols: ["declared service protocol"],
    dependencies: [],
    exclusions: ["generated/**"],
    lifecycle: "authoritative",
    capability: "project-adapter",
  }],
  extract: async ({ sources }) => {
    const serviceRoot = sources.find((item) => item.name === "20260811/service")?.absolutePath;
    if (serviceRoot === undefined) throw new Error("service source is not materialized");
    const protocolEvidence = inspectProtocol(serviceRoot);
    return {
    candidates: [{
      nodeRef: "service/protocol",
      kind: "protocol",
      visibility: "exported",
      module: "service",
      evidence: [protocolEvidence],
      sections: [{
        id: "contract",
        kind: "contract",
        title: "Provided contract",
        markdown: renderContract(serviceRoot),
        evidence: [protocolEvidence],
      }, {
        id: "operations",
        kind: "operation",
        title: "Operations",
        markdown: renderOperations(serviceRoot),
        evidence: inspectOperations(serviceRoot),
      }, {
        id: "handoff",
        kind: "handoff",
        title: "Implementation handoff",
        markdown: renderHandoff(serviceRoot),
        evidence: inspectHandoff(serviceRoot),
      }],
      review: {
        title: "Service protocol",
        summary: "Aggregated protocol boundary.",
        signals: ["source-backed"],
        reason: "Review the project-owned extraction.",
      },
    }],
  }},
});
```

`sources` is the complete CLI-resolved repo scope for the phase. Resolve files
from `sources[].absolutePath`; do not embed a local or remote Agent checkout
path. Every candidate section and edge carries structured `evidence`; the CLI validates that evidence against
the declared sources, creates canonical `source_ref` values, writes the symbol
index, candidate ledger and Review snapshots atomically, and records a phase
fingerprint. Evidence-scoped section `kind` values satisfy the selected output
profile's semantic coverage contract. A cross-module flow also requires at
least one source-backed structured edge. `context status` therefore treats this phase exactly like another
pending code extraction target, and Review can verify snapshot freshness
without a placeholder `extractTs` phase.

`indexUnits` is also the batch scale and ownership contract. Candidate
`module` must match one declared unit id or output owner. Older callbacks that
omit `indexUnits` remain compatible: Context groups candidates by `module` and
marks the plan as inferred. Once explicit units exist, an unmatched or
multiply-owned candidate blocks formal extraction instead of being guessed.
An inferred plan can be previewed for migration diagnostics, but formal writes
require the project to declare stable units and owners.

For a large adapter, `candidates` may be an `AsyncIterable` instead of an
array. Context consumes it incrementally and stops retaining full candidates
for an index unit after the 301st item proves that the unit is blocked. Array
callbacks remain supported and are reported as `legacy-preview`.

An optional generic `inspect` adapter can return source-backed module, entry,
protocol, dependency, lifecycle, and source-of-truth findings before candidate
collection. It may also return capability gaps tied to declared index-unit ids;
those gaps enter the one non-delegatable capability Gate. Internal framework
meaning stays in the project adapter and its referenced material.

The CLI also runs a lightweight structural probe before every custom preview.
It recognizes TypeScript symbols, React Router routes, Go symbols, Rush
workspace structure, and source-owned protocol schemas from generic manifests
and paths. The preview exposes all detected probes in
`inspection.structuralProbes` and records `structuralCoverage` on each index
unit. Candidate evidence must cover every probe applicable to the selected
output profile. Coverage is based on source-backed evidence paths, not Markdown
page count, so one aggregate page can pass while an entry-only static module
card cannot.

The extractor returns knowledge semantics (`nodeRef`, rendered Markdown,
Review summary and source-backed evidence). It must not write `knowledge/`,
`.tmp/context-runtime/lifecycle/candidates.jsonl`, extraction fingerprints or
Review snapshots directly. Context owns those files and preserves rejected and
unchanged-approved decisions across reruns.

#### Optional structural extractors

For the manifest-to-capability decision and unsupported-language extension
boundary, read [Code Extractor Selection](./code-extractors.md) before declaring
the phase.

`extractCustom()` may consume optional community packages without making them
Context CLI dependencies:

```ts
import { indexGoRepository } from "@c4a/extract-go";
import { extractCustom } from "@c4a/context";

extractCustom({
  id: "extract:service:codegraph",
  sources: [service],
  collection: "codegraph",
  extract: async ({ projectRoot }) => {
    const facts = await indexGoRepository(resolveServiceCheckout(projectRoot));
    return { candidates: buildServiceCandidates(facts) };
  },
});
```

Available structural libraries include:

- `@c4a/extract-go`: Go declarations, imports, calls, and common HTTP routes;
- `@c4a/extract-rush`: Rush projects, tags, entries, dependencies, and owners;
- `@c4a/extract-ts`: TypeScript extraction and `extractReactRouterRoutes()`.

The packages return syntax and repository facts only. They do not classify
product meaning, choose candidate identities, or write lifecycle state. The
knowledge project owns that mapping. Context CLI does not auto-install these
packages and does not expose a built-in Go or Rush phase. Detection does not
execute or replace an optional parser; it makes the matching parser contract
and its evidence coverage auditable before candidate writes.

### `reviewValidity`

Declare the review step for a collection:

```ts
reviewValidity({ collection: "codegraph" });
```

Declare one review gate for all current draft collections:

```ts
reviewValidity({ scope: "all" });
```

Phase id:

```text
review:codegraph:validity
review:all:validity
```

The review HTML and apply flow are CLI-owned.

This phase marks a human review gate when current candidates exist. Agents
should run `context review html <collection> --open --format json` or `context
review html --all --open --format json`, confirm the returned `opened` field,
and wait for the user-copied payload. They should not run the phase as an
automatic approval step or synthesize a payload themselves.

One batch-wide path is explicit current-conversation fully managed authority.
In that mode, follow the `context status --managed` route to
`context review approve-all ... --managed`; the CLI validates the exact current
scope before applying one default-approved decision.

Ordinary mode has a separate user-confirmed escape path for environments where
the Review report cannot be opened. Do not advertise it in the initial Review
prompt. After the user reports that limitation, the exact conversation phrase
`强制批准` authorizes only the current Route's revision-bound
`context review approve-all ... --force` command. Other generic approval or
continue wording does not invoke it.

The gate is batch-scoped: prose waits for every planned View across all active
structure slots and every declared `pendingStructureTargets` item in the round;
codegraph waits for every pending extract phase in the confirmed module round.
Candidate count/hash therefore describes the complete current batch rather than
one page, source slot, or module. Deterministic close later merges all active
slots into `knowledge/structure.yaml`, retains only their source, collection,
and consumed snapshot hash as `source_inputs`, then removes the lifecycle slots.

`status.structureBatch` lists unclassified, configuration-required, pending,
and active structure slots together with the execution policy for the round.

If the user explicitly asks for an automated or quick approval/rejection path,
use the scoped quick commands instead of hand-writing a payload:

```bash
context review approve <candidate-id> --collection <collection>
context review reject <candidate-id> --all
```

These commands still compute the current review scope and apply the same
candidate-id gate as the copied payload flow. They are not a replacement for the
default human review gate.

### `customPhase`

Use only when the typed factories cannot express a project-specific workflow:

```ts
const sample = source("20260712", "sample");

customPhase("custom:20260712/sample:review", async (ctx) => {
  await ctx.ensureSources({ source: sample });
  await ctx.extract.ts(extractTs({ source: sample, collection: "codegraph" }));
  await ctx.review.html(reviewValidity({ collection: "codegraph" }));
});
```

Custom phases are an orchestration escape hatch. Use `extractCustom()` instead
when project code needs to publish codegraph candidates. The supported runtime
helpers are:

- `ctx.ensureSources(...)` for repo source readiness.
- `ctx.extract.ts(...)` for declared TypeScript extraction.
- `ctx.review.html(...)` for the human review HTML gate.
