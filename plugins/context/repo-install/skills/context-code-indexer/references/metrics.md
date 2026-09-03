# Profile metric revision guide

This guide names reader-facing quality problems and explains how to revise a
Result. It does not define a second readiness check, ask the Agent to score its
own output, or authorize changing the profile contract.

## What this catalog does not prove

Read this before treating a metric catalog as proof of success. These entries
describe useful review lenses, but they do not read prose for meaning and they
do not replace Context's deterministic validation or final Review. A Result can
look tidy by these measures and still fail to answer a reader's question.

Count entries point to shapes that should normally disappear, coverage entries
ask whether a known inventory was handled, and ratios help find excessive
duplication or scaffolding. They interact, so repair the reader problem rather
than optimizing one number in isolation.

One entry, `discretionary-artifacts-per-logical-unit`, is judged
comparatively rather than against a fixed ceiling: it reacts to inflation
relative to the selected Bundle variant. Do not look for a constant here.

Context blocks only facts it can calculate from current authority, including
workset identity, complete question planning, inventory disposition coverage,
evidence contracts, layout and currentness. Natural-language usefulness and
support remain authoring and final-Review responsibilities. No Agent-supplied
metric value can weaken or satisfy those checks.

## Do not satisfy one entry by breaking another

These conflicts are the common cause of a second failed audit.

The inventory denominator is protected. Reduce
`narrative-enumeration-ratio` by relocating identities into the deterministic
catalog, never by dropping them from the Result. A dropped identity converts an
enumeration finding into an `inventory-disposition-coverage` failure.

Merging is not concatenation. When resolving
`duplicated-fact-target-ratio`, name one canonical owner and replace the other
copies with explicit relationships. Pasting several pages together moves the
duplication into one page and raises its enumeration instead.

A deterministic catalog is not a discretionary Artifact. When enumeration
moves into a catalog, bind that catalog to the logical unit that owns it. Do
not create a new optional Artifact to hold it, which trades an enumeration
finding for artifact inflation.

Re-home facts before removing a target. Satisfying
`reference-only-reader-targets` means merging an alias or ordinary reference
into its canonical owner. Deleting the target and its facts loses evidence and
reopens disposition coverage.

Regrouping must be semantic. Satisfying `unresolved-ordinal-partitions` by
renaming numbered batches to non-numeric labels changes nothing; the identity
must come from a boundary a reader can name.

## inventory-disposition-coverage

### Meaning

Every identity in the CLI inventory needs an owned, excluded, or unsupported
disposition.

### Revise

Return decisions for the reported missing identities, preserving the complete
inventory denominator and citing the evidence behind exclusions or unsupported
cases.

### Positive example

An internal generated file is retained in the inventory and marked excluded
with its generated-source evidence, so a reader can see it was considered and
why it carries no reader knowledge.

### Anti-example

The Result omits files that did not fit the selected template.

## duplicated-fact-target-ratio

### Meaning

The same reader fact should have one canonical target rather than competing
copies across Artifacts.

### Revise

Choose the canonical owner, replace other copies with explicit relationships,
and keep evidence on the owning fact.

### Positive example

One contract Artifact owns the request semantics while the overview links to it.

### Anti-example

Several pages repeat the same behavior paragraph with different headings.

## narrative-enumeration-ratio

### Meaning

Reader prose should explain capabilities and boundaries instead of restating a
deterministic inventory as sentences.

The measured scope is reader prose only. A deterministic catalog Artifact that
the Result declares as such is outside both the numerator and the denominator:
a complete inventory is that Artifact's entire purpose, and counting it as
narrative enumeration would penalise the Result for holding the catalog it was
asked to produce. Count an identity once, in the prose that mentions it. An
identity that lives only in a declared catalog is not counted at all.

### Revise

Move exhaustive identities into the deterministic catalog, group related items
by a reader question, and explain responsibility, differences, and handoffs.

One allowance serves every profile, because excluding declared catalogs from
the scope already accounts for the profiles whose reader value lies in a
complete inventory. A catalog-heavy Result is measured on its prose like any
other, so a breach here means the prose itself restates the catalog rather than
explaining it — never that the profile is inherently enumerative. Do not
rewrite a catalog into prose, and do not move prose into a catalog to change
the count: relocating an identity is legitimate only when the catalog is where
the reader should look for it.

### Positive example

A capability section explains dispatch choices and links to a complete
generated route catalog.

### Anti-example

The page turns every discovered symbol into an "observed" bullet.

## normalized-template-repetition-ratio

### Meaning

Repeated sentence frames with only identity substitutions indicate template
residue rather than evidence-specific explanation.

### Revise

Merge repeated observations, describe the shared rule once, and record
meaningful exceptions with their own evidence.

### Positive example

A family section states the common lifecycle and separately explains the
exceptional member.

### Anti-example

Every member receives the same sentence with only its name changed.

## implementation-body-ratio

### Meaning

Reader knowledge should describe stable behavior without copying implementation
bodies, generated payloads, or declaration dumps.

### Revise

Replace copied code with an evidence-bound behavioral statement and retain only
a small excerpt when it is necessary to explain a contract or failure boundary.

### Positive example

The page explains the validation and rollback sequence and links to the exact
implementation locator.

### Anti-example

The page embeds the complete function or generated type file as its main
content.

## reference-only-reader-targets

### Meaning

A reader target requires a CLI-authorized declaration, registration, public
contract, approved Subject, or Partition Subject identity.

### Revise

Merge aliases and ordinary references into their canonical owner, or remove the
target when no authorized identity observation exists.

### Positive example

A re-export alias points to the canonical public target instead of creating
another page.

### Anti-example

A frequently imported helper becomes a target solely because it has many
references.

## unresolved-ordinal-partitions

### Meaning

Partition identity must come from a stable semantic boundary, not traversal
order or a fixed batch label.

### Revise

Regroup members by capability, entrypoint, lifecycle stage, state owner,
protocol boundary, or handoff; if none applies, return the protocol outcome for
CLI-owned catalog fallback.

### Positive example

Handlers are grouped by the reader-visible protocol capability they implement.

### Anti-example

Files are divided into successive numbered batches to reduce page size.

## discretionary-artifacts-per-logical-unit

### Meaning

Optional Artifacts must answer distinct reader questions allowed by the
selected Bundle variant.

### Revise

Remove unsupported optional Artifacts, merge overlapping ones, or select
another CLI-eligible variant when canonical facts justify it.

### Positive example

An examples Artifact is retained because it explains a distinct usage scenario
with independent evidence.

### Anti-example

The Result creates extra pages to spread the same prose across a larger Bundle.

## example-candidate-decision-coverage

### Meaning

Every CLI-discovered example candidate needs one explicit terminal or merge
decision.

### Revise

Decide each reported candidate as linked, merged, documentation-only, excluded
with reason, or blocked by a material request.

### Positive example

A duplicate scenario is merged into a canonical example through its full
example identity.

### Anti-example

A candidate whose purpose was unclear is left out of the Result entirely, so a
later reader cannot tell whether it was rejected or never examined.

## example-representative-coverage

### Meaning

Eligible scenarios need retained representatives that explain setup, key calls,
parameters, and expected behavior.

### Revise

Promote or merge evidence-backed examples for the reported uncovered scenarios
and close each required facet explicitly.

### Positive example

A canonical example covers the scenario and records evidence-backed
not-applicable facets.

### Anti-example

A path is listed as an example without explaining how or why it is used.

## example-public-target-linkage

### Meaning

Eligible examples should resolve to the exact public target they demonstrate
whenever that target exists.

### Revise

Resolve aliases, repair the terminal decision chain, and bind the
representative to the CLI-supplied public target identity.

### Positive example

A scenario variant merges into a representative whose terminal decision links
the canonical public target.

### Anti-example

An example is linked to a similarly named internal helper or only to a
directory.
