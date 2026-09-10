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
| `@c4a/extract-thrift` | Thrift services, methods and declared data types |
| `@c4a/extract-proto` | Protobuf messages, fields and service definitions |
| `@c4a/extract-mdx` | Markdown/MDX document structure and source spans |
| `@c4a/extract-contract` | Supported structured API contract declarations |
| `@c4a/extract-style` | Stylesheet declarations, selectors and related structure |
| `@c4a/extract-sql` | Supported SQL schema declarations |
| `@c4a/extract` | Shared extraction result and adapter contracts |

These packages do not create Candidate rows, write `knowledge/`, or control
Review. The CLI owns those lifecycle responsibilities; Providers interpret the
supplied facts and sources and return structured semantic results. Package
presence alone does not prove a parser is selected or supports every dialect.
Use the selected profile's actual capabilities and parser diagnostics.

## Unsupported technologies

When a required boundary is unsupported, distinguish a parser limitation from
missing writing guidance. Config can select supported behavior; instructions or
templates cannot create missing structural facts. Follow the current Route's
capability-gap report and smallest supported customization step. A program
extension requires its existing execution authorization. Prefer a reusable
parser when the same technology is useful across projects; do not create a
parallel project-local knowledge pipeline.

Mechanical inventory closure requires an explicit disposition for each supplied
item. It does not prove that the pages answer the reader's questions. Review
checks usefulness and fidelity separately. Internal or out-of-scope items can
have justified exclusions without generating pages; symbol count is not a
knowledge-quality measure.
