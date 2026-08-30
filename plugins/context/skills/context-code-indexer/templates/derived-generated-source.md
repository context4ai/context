---
id: context.code-indexer.template.derived-generated-source
kind: procedure
media-type: text/markdown
---

# Generated, mirrored, vendored, and legacy source template

Use for `derived-generated-source` and source states `generated`, `mirrored`,
`vendored`, or `legacy`. Its main purpose is to prevent derived artifacts from
being mistaken for independent knowledge authority while preserving useful
consumer and provenance information.

## Evidence pass

Locate:

- generation, sync, vendoring, migration, or deprecation markers;
- authoritative repository, schema, template, source directory, or upstream
  package;
- generator/sync command, configuration, version pin, and output boundary;
- ownership and update cadence;
- consumers that still import or execute the derived tree;
- local modifications, compatibility wrappers, or hand-maintained overlays;
- release/build artifacts and whether they are committed or reproducible;
- replacement path for legacy source when one is explicitly maintained.

Do not assume all files in a generated-looking directory are derived. Confirm
markers, build steps, headers, manifests, or source mapping.

## Questions the knowledge must answer

1. Why does this source exist and what lifecycle category applies?
2. Where is the authoritative source of truth?
3. How is the derived content produced, synchronized, or versioned?
4. Which consumers depend on it and through what supported surface?
5. Are local edits permitted, overwritten, or layered separately?
6. What is safe to inspect here, and what knowledge belongs upstream?
7. For legacy source, what current replacement and migration status are proven?

## Suggested knowledge units

- **Provenance record**: lifecycle, authority, generator/sync, version relation,
  ownership, output boundary, and consumer summary.
- **Generated public surface**: only when this tree is the supported consumer
  interface; combine with `sdk-library` and keep the upstream schema explicit.
- **Compatibility or migration boundary**: when maintained wrappers or legacy
  behavior remain operationally relevant and source-backed.
- **Update/recovery procedure**: only maintained generation or synchronization
  commands, verification, and overwrite boundaries.

Default to a narrow provenance Artifact unless the workset also selects a
supported consumer surface. A consumer-facing derived unit must bind its
authority evidence to the confirmed source locator; a missing authority remains
a material gap rather than a reason to invent semantics or hide the supported
consumer surface.

## Chapter blueprints

```markdown
# <Derived source> provenance
## Lifecycle classification
## Authority and ownership
## Generator, sync, or vendoring mechanism
## Version and compatibility relationship
## Output boundary and local-edit policy
## Active consumers
## Update, verification, and recovery
## Reader-facing knowledge owned elsewhere
```

For a generated public client:

```markdown
# <Generated client> consumer surface
## Intended consumers and supported import
## Authoritative schema and generation version
## Client initialization and operation families
## Generated versus maintained behavior
## Compatibility and regeneration
## Evidence and excluded generated detail
```

## Granularity and relationships

Do not duplicate pages already owned by the authoritative schema,
implementation, or package. Generated files may provide exact locators and
cross-checks but should not expand every model, constant, serializer, or method
into reader-facing Markdown.

Relate the derived unit to its authority and active consumers. A relationship
to an upstream schema must use an explicit locator or generation configuration,
not a naming guess.

If the authority cannot be located, a narrow provenance unit may still record
confirmed lifecycle markers, generator clues, output boundaries, and active
consumers. Keep any separate unit that promises field semantics, compatibility,
or upstream meaning in a `request-material` disposition tied to a blocking
material-question proposal until the missing authority is provided.

## Template composition examples

- A generated API client is `sdk-library` + `derived-generated-source` and reads
  `protocol-boundary.md` for protocol authority.
- A vendored library with no project-owned surface remains one provenance page,
  not a copied API reference.
- A legacy adapter still serving callers combines this template with
  `adapter-integration.md`; document only proven compatibility and migration behavior.

## Revise or stop when

- the authoritative source cannot be identified for semantic or compatibility
  claims beyond a narrow provenance record;
- generated and hand-maintained files cannot be separated;
- the plan duplicates upstream reference material without consumer value;
- legacy replacement or deprecation claims are inferred rather than evidenced;
- generated symbols dominate projected pages.
