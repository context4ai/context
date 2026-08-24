---
id: semantic.code-index.template.sdk-library
kind: procedure
media-type: text/markdown
---

# SDK and shared library template

Use for `sdk-library`: reusable code packages, component libraries, client
SDKs, public framework extensions, or shared runtimes consumed through a
deliberately supported interface. A package being imported elsewhere is not
enough; confirm its supported entry and consumer contract.

Recommended `outputProfile`: `public-api-reference`.

## Evidence pass

Locate:

- package manifest, exports map, public barrels, binary/native entry, or
  documented import paths;
- initialization, providers, factories, configuration, and required runtime;
- public capability families, components, hooks, types, commands, or clients;
- supported extension/plugin points and lifecycle;
- compatibility, platform, peer dependency, and version constraints;
- maintained examples, tests, API comments, and migration/release notes;
- external protocol schemas and generated declarations or clients;
- internal implementation, fixtures, demos, and re-export chains that should
  not become independent reader pages.

Use public exports plus maintained documentation together. An exported symbol
can still be incidental; a documented stable import path can remain public even
when it re-exports another implementation.

## Questions the knowledge must answer

1. Who should use this package and what capabilities does it promise?
2. What are the supported import/initialization paths?
3. How are public APIs grouped into concepts a consumer can navigate?
4. What configuration, lifecycle, compatibility, and failure rules apply?
5. Which examples demonstrate supported use rather than test-only behavior?
6. Which declarations are generated, and where is their authority?
7. How is the package built, versioned, and released when that is in scope?

## Suggested knowledge units

- **Library/module map**: purpose, supported entrypoints, capability families,
  runtime/peer requirements, extension points, and navigation.
- **Getting started or lifecycle**: installation assumptions, initialization,
  configuration, teardown, and minimal supported examples evidenced by source.
- **Capability-family reference**: a coherent group of APIs/components with
  usage, contracts, constraints, and related types.
- **Granular API/component reference**: one symbol or component per page only
  when the package intentionally exposes a granular public contract and the
  measured preview remains appropriate.
- **Compatibility and migration**: supported platforms/versions and evidenced
  breaking or transitional behavior.
- **Build/release entry**: only module-owned packaging and release behavior.

## Chapter blueprints

```markdown
# <Library> module map
## Purpose and intended consumers
## Supported entrypoints and initialization
## Capability families
## Runtime, peer, and platform requirements
## Configuration and lifecycle
## Extension points and external protocols
## Compatibility, build, and release
## Examples, evidence, and exclusions
```

For a capability family:

```markdown
# <Capability family>
## When to use it
## Supported imports or components
## Initialization and configuration
## API/component contracts
## Lifecycle, errors, and constraints
## Minimal source-backed examples
## Related capabilities and authoritative references
```

For a granular reference page:

```markdown
# <Public API or component>
## Purpose
## Import and signature/props
## Required context and configuration
## Behavior, lifecycle, and errors
## Supported example
## Compatibility and source evidence
```

## Granularity and relationships

Prefer capability families over one page per export. A symbol page is justified
when consumers search for that exact public identity and its contract contains
meaningful behavior beyond a signature. Do not copy complete function bodies,
private members, generated declarations, fixtures, or every re-export.

The 300-page limit remains per index unit. When a granular public surface would
cross it, keep the public identities navigable but aggregate them into
capability-family pages through `extractCustom()`; the limit is not raised for
large libraries, and splitting one `extractTs()` source into overlapping units
is not a valid workaround.

Relate public entries to capability families, configuration, examples, and
external protocols. Internal call graphs are secondary unless the knowledge
goal explicitly concerns extension or lifecycle behavior.

## Template composition examples

- A component library may use granular component pages plus family indexes,
  while its demo site is a separate `web-application` unit.
- A generated client reads `derived-source.md` and
  `protocol-boundary.md`; document the supported client surface while naming
  the upstream schema authority.
- A library with a plugin host also reads `adapter.md` and
  `plugin-extension.md`.

## Revise or stop when

- the public boundary cannot be distinguished from internal exports;
- examples are invented instead of derived from maintained usage or tests;
- generated declarations have no identifiable authority;
- every export or component is selected without a consumer-navigation reason;
- compatibility or lifecycle claims are unavailable but required by the goal.
