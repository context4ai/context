# Code Extractor Selection

Use this manual only when the current code-extraction Route asks the Agent to
choose or declare an extractor. The CLI reports repository facts; the Agent
chooses how those facts become source-backed code knowledge.

## Inspect Before Declaring

Run the single batch inspection command returned by the extraction-scope Gate.
The result identifies every confirmed module, its recognized `manifests`,
README locations, entry candidates, protocol locators, and lifecycle markers.
Treat these as deterministic technology signals, not as product semantics:

| Signal | Technology candidate |
|---|---|
| `package.json` | TypeScript, TSX, JavaScript, or JSX |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `pyproject.toml` or `setup.py` | Python |
| `pom.xml` or `build.gradle` | Java or JVM |
| multiple manifests | a mixed module that may need more than one extractor |

Do not select `extractTs()` merely because a repository contains some
TypeScript. Decide against the exact confirmed module and include boundary. A
mixed module may compose multiple structural passes; parser selection is not an
exclusive repository-wide switch.

## Selection Order

Use the narrowest reusable capability that covers the confirmed source:

1. Use a Context-owned phase when its contract matches the source.
2. Otherwise use a reusable structural package inside `extractCustom()`.
3. If no reusable package covers the syntax or repository protocol, implement a
   project-owned adapter and keep it in the Context workspace.

Current reusable capabilities are:

| Source fact | Preferred capability | Lifecycle integration |
|---|---|---|
| TypeScript/TSX package or file scope | `extractTs()` | Context-owned phase |
| Go declarations, imports, calls, and common HTTP routes | `@c4a/extract-go` | call from `extractCustom()` |
| Rush workspace packages, tags, dependencies, entries, and owners | `@c4a/extract-rush` | call from `extractCustom()`; may complement a language extractor |
| React Router route declarations | `extractReactRouterRoutes()` from `@c4a/extract-ts` | call from `extractCustom()`; complements TypeScript symbols |
| Rust, Python, Java/JVM, or an unsupported framework/protocol | no assumed built-in parser | project-owned `extractCustom()` adapter |

The custom extraction preview verifies this selection mechanically. Context
detects applicable community capabilities from source manifests and stable path
signals, then checks that candidate evidence covers every required entry,
route, implementation boundary, workspace, or protocol probe. One aggregated
module page is valid when it closes that structural coverage. A callback that
only hashes a few filenames or renders configured prose does not satisfy the
probe, even when its Markdown count is small.

The probe does not assign business meaning and does not require one page per
fact. The project adapter still owns grouping, titles, explanations, and
cross-module semantics. If the source uses an unsupported language or protocol,
report a capability gap instead of claiming that a known probe was consumed.

An optional package does not create a new CLI phase. Add it as an explicit
workspace dependency, then map its structural facts to candidates in the
project callback. Do not add a parser package when its documented coverage does
not match the inspected source.

## Read The Contract Before Extending

Before editing `src/index.ts`, read the Route-selected Context lifecycle and
extractor resources completely. They are the installed contract for
Context-owned phases such as `extractTs()`; do not require a separate
workspace copy of an implementation package and do not infer APIs from bundled
JavaScript.

Only a capability imported directly by a project-owned `extractCustom()`
adapter requires its package README. Use this matrix to decide whether that
optional capability is relevant, add only that dependency, then read the
README from the resolved installed package before implementing the callback.
Never assume that a transitive or dev-only package is present at a hard-coded
`node_modules` path.

A project-owned adapter may use an existing parser, compiler API, or command
whose output is deterministic. It must return source-backed candidates through
`extractCustom()`; it must not write lifecycle, knowledge, or Review files.
Framework-specific classification and rendering remain in the project. The CLI
and structural parser must not infer product meaning.

## Decision To Report

Before the first extraction preview, state briefly:

- the inspected module and manifest signals;
- the selected Context phase or structural package;
- whether coverage is complete or which facts remain project-owned; and
- why another available extractor is not needed.

After preview, use `inspection.structuralProbes` and each index unit's
`structuralCoverage` as the exact audit result. An uncovered probe is a
configuration problem, not a Review decision.

If no current capability can parse the source reliably, stop at configuration
and report the missing generic capability. Do not silently emit an empty
codeindex or reuse an unrelated parser.

## Plan Before Parsing

Classify the user-visible module before selecting language tooling or reading an
archetype template: API/service, background runtime, SDK/library, interactive
application, adapter, CLI/tool, monorepo container, derived source,
authoritative contract source, or unknown.
A hybrid module may declare several `moduleTypes` and several behavior `facets`;
keep one primary `moduleType` for concise reports. Record inspected paths in
`moduleTypeEvidence`, record every Markdown file actually read in `documents`, then read all matching Route-recommended files below
`resources/semantic/code-index/templates/` and combine them into one plan.
After that, choose exactly one closed output profile: `module-map`,
`application-map`, `protocol-index`, `service-boundary`, `runtime-map`,
`public-api-reference`, `command-map`, `adapter-contract`, `module-registry`,
`cross-module-flow`, or `provenance-only`. The profile selects structural probes
and advisory checks; an invented value is rejected.

Each archetype resource is a working template for an Agent with limited prior
context. It provides a minimum evidence pass, the reader questions the index
must answer, suggested knowledge units, Markdown chapter blueprints,
aggregation and relationship rules, composition examples, and stop conditions.
The blueprints are illustrative: omit unsupported sections and merge overlap
across selected templates instead of producing empty headings or duplicate
pages. They shape content before the batch preview; they do not prescribe or
override projected page counts.

Extractor shape defines what can be emitted. `extractTs()` creates one page per
selected symbol and permits one owning index unit per source. Use it for an
intentional granular public reference. Use `extractCustom()` for module-level
aggregation, registries, protocol indexes, cross-module flows, or multiple
candidate owners over one source; each candidate declares its `module` and
at least one evidence-scoped `section`; there is no page-level Markdown
fallback. Each section's typed coverage and exact evidence is checked against
the output profile during preview. Resolve repositories from
the extractor context's `sources[].absolutePath`, never from a
machine-specific checkout path. Cross-module flow output must also emit
source-backed structured edges. Generated clients/models, mirrored sources, legacy
implementations, and internal helpers should normally be excluded or recorded
as provenance rather than expanded one symbol per page.

If a repository uses service manifests or protocol registrations that the
community inspector cannot interpret, keep that interpretation in a generic
project-owned `inspect` adapter attached to `extractCustom()`. Return findings
and capability gaps through the public Context contract; do not add internal
framework names or directory rules to the CLI.
