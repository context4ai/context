# Profile metric revision guide

Use the current CLI audit as the sole source of actual, recommended, and hard values. This guide explains how to revise a Result; it does not define thresholds or authorize changing a denominator.

## inventory-disposition-coverage

### Meaning

Every identity in the CLI inventory needs an owned, excluded, or unsupported disposition.

### Revise

Return decisions for the reported missing identities, preserving the complete inventory denominator and citing the evidence behind exclusions or unsupported cases.

### Positive example

An internal generated file is retained in the inventory and marked excluded with its generated-source evidence.

### Anti-example

The Result omits files that did not fit the selected template.

## duplicated-fact-target-ratio

### Meaning

The same reader fact should have one canonical target rather than competing copies across Artifacts.

### Revise

Choose the canonical owner, replace other copies with explicit relationships, and keep evidence on the owning fact.

### Positive example

One contract Artifact owns the request semantics while the overview links to it.

### Anti-example

Several pages repeat the same behavior paragraph with different headings.

## narrative-enumeration-ratio

### Meaning

Reader prose should explain capabilities and boundaries instead of restating a deterministic inventory as sentences.

### Revise

Move exhaustive identities into the deterministic catalog, group related items by a reader question, and explain responsibility, differences, and handoffs.

### Positive example

A capability section explains dispatch choices and links to a complete generated route catalog.

### Anti-example

The page turns every discovered symbol into an “observed” bullet.

## normalized-template-repetition-ratio

### Meaning

Repeated sentence frames with only identity substitutions indicate template residue rather than evidence-specific explanation.

### Revise

Merge repeated observations, describe the shared rule once, and record meaningful exceptions with their own evidence.

### Positive example

A family section states the common lifecycle and separately explains the exceptional member.

### Anti-example

Every member receives the same sentence with only its name changed.

## implementation-body-ratio

### Meaning

Reader knowledge should describe stable behavior without copying implementation bodies, generated payloads, or declaration dumps.

### Revise

Replace copied code with an evidence-bound behavioral statement and retain only a small excerpt when it is necessary to explain a contract or failure boundary.

### Positive example

The page explains the validation and rollback sequence and links to the exact implementation locator.

### Anti-example

The page embeds the complete function or generated type file as its main content.

## reference-only-reader-targets

### Meaning

A reader target requires a CLI-authorized declaration, registration, public contract, approved Subject, or Partition Subject identity.

### Revise

Merge aliases and ordinary references into their canonical owner, or remove the target when no authorized identity observation exists.

### Positive example

A re-export alias points to the canonical public target instead of creating another page.

### Anti-example

A frequently imported helper becomes a target solely because it has many references.

## unresolved-ordinal-partitions

### Meaning

Partition identity must come from a stable semantic boundary, not traversal order or a fixed batch label.

### Revise

Regroup members by capability, entrypoint, lifecycle stage, state owner, protocol boundary, or handoff; if none applies, return the protocol outcome for CLI-owned catalog fallback.

### Positive example

Handlers are grouped by the reader-visible protocol capability they implement.

### Anti-example

Files are divided into successive numbered batches to reduce page size.

## discretionary-artifacts-per-logical-unit

### Meaning

Optional Artifacts must answer distinct reader questions allowed by the selected Bundle variant.

### Revise

Remove unsupported optional Artifacts, merge overlapping ones, or select another CLI-eligible variant when canonical facts justify it.

### Positive example

An examples Artifact is retained because it explains a distinct usage scenario with independent evidence.

### Anti-example

The Result creates extra pages to spread the same prose across a larger Bundle.

## example-candidate-decision-coverage

### Meaning

Every CLI-discovered example candidate needs one explicit terminal or merge decision.

### Revise

Decide each reported candidate as linked, merged, documentation-only, excluded with reason, or blocked by a material request.

### Positive example

A duplicate scenario is merged into a canonical example through its full example identity.

### Anti-example

Unclear examples disappear from the Result without a disposition.

## example-representative-coverage

### Meaning

Eligible scenarios need retained representatives that explain setup, key calls, parameters, and expected behavior.

### Revise

Promote or merge evidence-backed examples for the reported uncovered scenarios and close each required facet explicitly.

### Positive example

A canonical example covers the scenario and records evidence-backed not-applicable facets.

### Anti-example

A path is listed as an example without explaining how or why it is used.

## example-public-target-linkage

### Meaning

Eligible examples should resolve to the exact public target they demonstrate whenever that target exists.

### Revise

Resolve aliases, repair the terminal decision chain, and bind the representative to the CLI-supplied public target identity.

### Positive example

A scenario variant merges into a representative whose terminal decision links the canonical public target.

### Anti-example

An example is linked to a similarly named internal helper or only to a directory.
