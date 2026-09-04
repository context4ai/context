# Code Parser Selection

Code parsing is an Indexer Provider implementation detail. A knowledge
workspace selects the Provider and profile in `src/indexers.yaml`; it does not
declare a separate extraction phase in `src/index.ts`.

## Selection order

1. Identify the target boundary and the knowledge questions.
2. Let the selected Provider inspect language, manifests, entries, routes, and
   contracts.
3. Use the smallest parser set that covers those questions.
4. Keep deterministic parser output as Provider facts; let the Provider author
   reader-oriented knowledge pages from those facts and readable sources.

## Community parser packages

| Package | Useful structural facts |
|---|---|
| `@c4a/extract-ts` | TypeScript/JavaScript symbols, exports, imports, calls, and React Router routes |
| `@c4a/extract-go` | Go declarations, imports, calls, and common HTTP routes |
| `@c4a/extract-rush` | Rush projects, tags, entries, dependencies, and owner boundaries |
| `@c4a/extract` | Shared extraction result and adapter contracts |

These packages do not create Candidate rows, write `knowledge/`, or control
Review. The Code Indexer Provider owns those lifecycle responsibilities.

## Unsupported technologies

When the current Provider cannot parse a required boundary, first use its
supported customization ladder (`config`, instruction append, template
override, then program extension). Add a reusable parser to the Provider only
when the same technology boundary is useful across projects. Do not create a
project-local parallel knowledge pipeline.

Parser coverage is complete when every required inventory item has an explicit
disposition and the resulting pages answer the declared reader questions. A
large symbol count by itself is not useful coverage.

