---
id: semantic.code-index.template.contracts-and-chains
kind: procedure
media-type: text/markdown
---

# Contracts, identity groups, and execution chains

Use this resource after module classification when a code index must connect
stable identities without turning the inventory into reader-facing prose. It
applies to application, service, library, runtime, command, adapter, and
cross-source units.

## Separate inspection facts from reader content

The adapter inventory is complete machine evidence. A reader page should group
members only when they share a source-backed responsibility, boundary, or
lifecycle. Do not create one sentence, bullet, row, or page per discovered
identity.

An `identityGroups` record must provide:

- a stable group `id`;
- the exact target `members` from the same index-unit inventory;
- one reader-facing `viewRef` that explains their common responsibility;
- `sourceFiles` from the eligible-file inventory that prove membership.

The referenced page must cite every declared source file. A group does not pass
coverage merely because its members exist in frontmatter or evidence.

## Discover chain candidates

Emit a candidate only when code structure or an authoritative declaration
supports both adjacent endpoints. Supported families are:

- `entry-operation`;
- `operation-handler`;
- `handler-downstream`;
- `event-processing`;
- `command-effect`;
- `export-implementation`;
- `cross-source-handoff`.

Each candidate records a stable `id`, `from`, `to`, confidence, and the exact
eligible `sourceFiles` that support the adjacency. Imports, filenames, symbol
co-occurrence, or similar names alone are ambiguous evidence; mark such a
candidate ambiguous or request material instead of asserting a runtime chain.

## Decide every candidate

Every discovered candidate receives exactly one decision:

- `document`: add a source-backed structured edge and name its reader-facing
  `viewRef`;
- `merge`: point `canonicalChainId` at an equivalent candidate whose decision
  is `document`;
- `exclude`: explain why the static match is not a stable runtime relation;
- `request-input`: explain which external protocol, runtime registration, or
  authoritative material is missing.

Decision coverage is 100%. Excluding all candidates does not close an external
boundary family: at least one representative chain must be documented, merged
into a documented chain, or explicitly require material.

## Reader-facing chain blueprint

```markdown
## <Reader goal or boundary>

<Explain the starting trigger and the stable outcome.>

1. **Entry or trigger** — <identity and responsibility>.
2. **Operation or handler** — <validation, transformation, or state change>.
3. **External handoff or effect** — <contract, ownership, and next boundary>.

Failure and retry boundary: <only source-backed behavior>.
Evidence: <section-scoped locators for each adjacent handoff>.
```

Remove stages that do not apply. Do not leave empty template headings, repeat a
module inventory, or infer missing runtime behavior.
