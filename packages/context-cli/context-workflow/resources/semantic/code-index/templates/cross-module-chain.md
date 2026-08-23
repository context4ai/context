---
id: semantic.code-index.template.cross-module-chain
kind: procedure
media-type: text/markdown
---

# Cross-module flow template

Use for `cross-module-chain` only when a stable reader question cannot be
answered inside one module. The chain is an independently owned index unit with
`outputProfile: "cross-module-flow"`; each participating module keeps its own
non-duplicated map.

## Evidence pass

Establish:

- an explicit start trigger and terminal outcome;
- each registered module boundary in execution order;
- operation, event, repository, command, or plugin identities joining adjacent
  modules;
- transformations, ownership handoffs, state changes, and failure boundaries;
- source locators on both sides of every join;
- authentication, retries, fallback, observability, and recovery only where
  they are explicitly configured.

Imports, filenames, symbol co-occurrence, and similar names do not prove a
runtime chain.

## Questions the knowledge must answer

1. What reader goal and source-backed trigger start the flow?
2. Which module owns each step and boundary?
3. Which exact contract or identity joins each adjacent step?
4. What state, identity, or data is transformed at every handoff?
5. Where can the flow fail, retry, fall back, or terminate?

## Chapter blueprint

```markdown
# <Cross-module flow>
## Reader goal and starting trigger
## Boundary sequence and module ownership
## Contract and transformation at each handoff
## State changes and terminal outcome
## Authentication, failure, retry, and fallback
## Source-backed edge inventory
## Known gaps and excluded implementation detail
```

Examples include application-to-client-to-endpoint, endpoint-to-service-to-
repository, producer-to-event-to-consumer, command-to-remote-operation, and
plugin-host-to-provider.

## Extractor and ownership rule

A chain normally overlaps the sources already owned by module units. Use
`extractCustom()` and assign each aggregate candidate to the chain unit through
its `module` field. `extractTs()` assigns ownership at source level, so it cannot
represent both a per-module unit and an overlapping cross-source chain unit in
the same phase.

The aggregate candidate may cite evidence from every participating source. It
must cover all Route-reported structural probes selected by the flow profile;
one page may cover several probes when it carries each exact evidence locator.
Use `operation` and `handoff` candidate sections and emit source-backed
`depends_on` edges from the owning module candidate to the next registered
module candidate. Narrative arrows or a textual sequence do not satisfy the
structured relationship requirement.

## Granularity and stop conditions

Emit one deduplicated page per coherent end-to-end flow family. Split when the
trigger, terminal outcome, ownership, contract, or failure policy differs.

Revise or stop when either endpoint or a joining identity is missing, the chain
crosses unregistered sources, relationships depend on inference, or the output
repeats module pages without adding a handoff model.
