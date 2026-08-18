---
id: procedure.code-extraction
kind: procedure
mediaType: text/markdown
---

# Code extraction

Code extraction operates on user-confirmed repository modules and source
patterns. A source registration identifies the repository or module; the
extraction declaration defines the code scope inside it.

Before declaring a phase, run the extraction-scope Gate's inspection Action for
every confirmed module. Read all reported `manifests`, including mixed-module
signals, then use the route-selected Code Extractor Selection manual to choose
`extractTs`, an optional structural package inside `extractCustom`, or a
project-owned adapter. Read the selected package's public SDK/README before
editing `src/index.ts`; never infer its API from bundled output. Do not silently
substitute the TypeScript extractor for Go, Rust, or another unsupported source.

`include` filters files inside a selected source; it is not a package/module
selector. Use source declarations to select repository modules. Use configured
entry patterns when entry-led traversal is meaningful, or scan mode when the
selected module intentionally has no package entry. Do not require source-code
rewrites merely to create an extraction entry.

Use a dry-run when the current route requests scope inspection. Report
discovered files, AST-analyzed files, skipped files, symbols, and relations
separately. Use resolved entry files, exported/internal counts, and symbol-kind
counts as structural scope evidence only. Resolve TypeScript/JavaScript
configuration and aliases through the extractor rather than guessing paths
from imports. Explain the scope without treating filenames or symbol kinds as
semantic knowledge. After confirmation, process exactly one pending extraction
target and evaluate again.

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
