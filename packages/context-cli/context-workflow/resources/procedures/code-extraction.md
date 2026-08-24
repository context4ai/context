---
id: procedure.code-extraction
kind: procedure
mediaType: text/markdown
---

# Code extraction

Code extraction operates on user-confirmed repository modules and source
patterns. A source registration identifies the repository or module; the
extraction declaration defines the code scope inside it.

Before declaring a phase, run the Route-selected batch inspection once for all
confirmed modules. Read their manifests, module documentation, stable entries,
and dependency/protocol locators. First record an evidence-backed classification
for every module without reading an archetype template. A module has one primary
`moduleType`, may declare additional `moduleTypes`, and may combine relevant
`facets`. Only after classification, read every matching file from the Route's
recommended `resources/semantic/code-index/templates/` directory and merge them
into one deduplicated plan per user-visible module or aggregate.

The target is a stable module map, public contract, protocol boundary, or
runtime map—not a page for every function, variable, constant, or internal type.
Use the Code Extractor Selection manual to choose `extractTs`, an optional
structural package inside `extractCustom`, or a project-owned adapter. Read the
selected package's public SDK/README before editing `src/index.ts`; never infer
its API from bundled output. `moduleTypeEvidence` must identify the inspected
paths that support the classification. An `unknown` unit or a unit with no
classification evidence is an incomplete index plan.

For every custom extraction preview, Context probes source paths for known
community structural capabilities: TypeScript symbols, React Router routes, Go
symbols, Rush workspace structure, and source-owned protocol schemas. Every
probe applicable to an index unit's output profile must be represented by the
candidate evidence for that unit. A project adapter may aggregate and explain
those facts in one high-value page, but it cannot replace a matched structural
probe with a static template or a manually listed filename. Missing probe
coverage is a `material-required` capability gap and uses the same
non-delegatable capability Gate in ordinary and fully managed conversations.

`include` filters files inside a selected source; it is not a package/module
selector. Use source declarations to select repository modules. Use configured
entry patterns when entry-led traversal is meaningful, or scan mode when the
selected module intentionally has no package entry. Do not require source-code
rewrites merely to create an extraction entry.

Exports-only single-package TypeScript extraction has a compatible stable
public-contract plan. Scan mode, repository collections, and custom extraction
must declare their index units explicitly; an inferred plan is diagnostic only
and cannot write candidates.

Extractor output shape must match the semantic plan. `extractTs()` projects one
candidate page per selected symbol and assigns each source to one index unit;
it is suitable for a deliberately granular public reference. Aggregated module
maps, registries, protocol indexes, cross-module flows, or multiple units over
one source require `extractCustom()` with explicit candidate ownership. For a
monorepo, register independently visible children as separate sources before
giving them separate `extractTs()` units.

The Route runs one cache-writing batch preview after classification, template
selection, and configuration, but before any candidate write. Report
discovered files, AST-analyzed files, skipped files, symbols, and relations
separately, together with each index unit's output owner, output profile,
projected Markdown count, total bytes, largest sampled page, and risk flags.
For custom phases, also report detected structural probes, covered and uncovered
probe counts, representative evidence paths, and the affected output profile.
Use resolved entry files, exported/internal counts, and symbol-kind counts as
structural scope evidence only. Resolve TypeScript/JavaScript
configuration and aliases through the extractor rather than guessing paths
from imports.

Template examples never determine the expected page count. Scale policy is
applied only to the measured batch preview and is fixed per index unit: at most
100 pages continues normally,
101–300 pages continues with a warning, and more than 300 pages stops at the
non-delegatable extraction-scale Gate. Fully managed authority cannot bypass
that Gate. Ambiguous output ownership and `material-required` capability gaps
also stop before candidate writes. Ambiguous ownership returns to project
configuration without creating another human Gate. Revise all affected units
together, re-check whether their classification or selected templates changed,
rerun the batch preview, then process exactly one pending extraction target and
evaluate again. Do not add a second classification Gate after the page-count
Gate; a plan revision returns through the same configuration step.

A batch-total page warning and quality risks such as a thin aggregate are
advisory only. They remain visible for cost and content-shape review but do not
become a new Gate. Legal scale recovery includes narrowing `include`, excluding
generated or mirrored directories, enabling `exportedOnly`, moving from a
symbol catalog to an aggregated `extractCustom()` plan, or registering real
child sources. Splitting one `extractTs()` source into overlapping units is not
a valid workaround.

Current previews are cached below `.tmp/context-runtime/extract/previews/` and
formal extraction reuses their validated structural result. Cache identity is
bound to source scope, phase/adapter declarations, project `src/`, dependency
locks, and the preview protocol. Deleting
`.tmp` only causes a fresh preview. Existing approved knowledge is not
retroactively rejected solely because it is large.

Do not open Review while another extraction target in the same batch remains.
Unchanged approved or rejected symbols do not need another decision; new or
changed candidates remain subject to the current Review policy.

For TypeScript sources, Context also carries extractor-reported AST relations
between selected symbols. A relation is projected only when both endpoints
resolve uniquely inside the selected module; external, unselected, and
ambiguous endpoints are counted as omissions instead of guessed. The extract
receipt reports `relationships.detected`, `emitted`, and omission counts.
Review materializes those source-backed relations with the approved symbol,
and deterministic close refreshes the typed edge projection.

Project-owned custom edges use `source-backed-explicit` rather than claiming
AST derivation. They remain subject to the same evidence, endpoint, Review, and
close projection checks.

Zero edges remain a valid result. Read `close.relationshipCoverage` or the
package inventory's `structure.relationship_coverage` to distinguish a current
source-backed extraction that found no approved edges from an older or
otherwise unknown relationship mode. Never infer missing edges from symbol
co-occurrence, filenames, or package size.

When the built-in TypeScript extractor cannot represent the code source, use a
declared `extractCustom` phase. The project-owned callback returns candidate
semantics plus structured source evidence; Context owns canonical refs,
fingerprints, candidate storage, Review snapshots, freshness, and rerun cleanup.
Do not use a generic `customPhase` callback to write lifecycle files directly.
Large custom adapters may return candidates as an `AsyncIterable`; Context
retains at most the proof boundary for an over-limit unit instead of collecting
thousands of full Markdown candidates. A project-owned `inspect` adapter may
report generic module/protocol findings and capability gaps without putting
framework-specific rules in the community CLI.

Prefer a reusable structural library over a project-local parser when one
matches the confirmed source: `@c4a/extract-go` for Go facts,
`@c4a/extract-rush` for Rush workspace facts, and
`extractReactRouterRoutes()` from `@c4a/extract-ts` for React Router facts.
These are optional project dependencies consumed inside `extractCustom()`;
they are not built-in CLI phases. Keep product-specific classification and
candidate rendering in the project, and do not ask the CLI or parser to infer
business meaning.

For Rust, Python, Java/JVM, or another source without a matching reusable
extractor, keep the lifecycle in `extractCustom()` and implement only the
missing project adapter. If reliable syntax facts cannot be produced, stop at
configuration and report the generic capability gap rather than emitting an
empty or guessed graph.
# Agent audit after extraction

After every complete code-extraction batch, the Route produces one batch-level
code-index audit. Mechanical signals cover content depth, evidence scope,
declared-source coverage, and structured handoffs. They are review evidence,
not an automatic numeric rejection: the Agent must inspect the affected pages
and submit one `accept`, `revise`, or `request-input` decision for all index
units together.

Do not split this into one confirmation per module. In fully managed operation,
real issues select `revise` and the Route returns through project configuration,
batch Preview, extraction, and a new audit until the index is acceptable. A
false positive may be accepted only with a concrete inspected reason. Ask the
user only when reliable correction needs unavailable material or access.
