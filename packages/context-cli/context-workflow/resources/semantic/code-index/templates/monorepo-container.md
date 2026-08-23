---
id: semantic.code-index.template.monorepo-container
kind: procedure
media-type: text/markdown
---

# Monorepo and module-container template

Use for `monorepo-container`: a workspace whose stable knowledge is the
registration, ownership, dependency, build, or release topology of multiple
child modules. Do not treat the physical repository as one application merely
because it has one Git remote.

Recommended `outputProfile`: `module-registry`.

## Evidence pass

Locate:

- workspace/package/service manifests and child-module discovery rules;
- build graph, task orchestration, cache, dependency, and affected-scope logic;
- ownership, tags, boundaries, layering, or dependency constraints;
- shared configuration and tooling inherited by child modules;
- release groups, independent packages, deployment units, and version policy;
- generated, mirrored, vendored, fixture, example, and legacy subtrees;
- cross-module registries or contracts that warrant separate chain units.

Use declared manifests as the primary inventory. Directory discovery is a
fallback and must not silently include generated output or dependency caches.

## Questions the knowledge must answer

1. How are child modules discovered and identified?
2. Which modules are applications, services, libraries, tools, or derived
   sources, and who owns them?
3. What dependency and layering rules connect or constrain them?
4. How do build, test, cache, release, and deployment boundaries work?
5. Which configuration is inherited globally versus owned by a child module?
6. Which cross-module flows are important enough to index separately?
7. Which large or generated subtrees are intentionally excluded?

## Suggested knowledge units

- **Module registry**: child identity, path, type, owner, manifest, supported
  entry, build/release unit, and lifecycle.
- **Dependency/topology map**: declared dependency directions, layering rules,
  shared contracts, and source-backed edges.
- **Build and release map**: task graph, affected-scope behavior, cache,
  artifacts, release groups, and deployment units.
- **Shared tooling/configuration**: only stable workspace-level behavior that
  materially affects multiple children.
- **Cross-module chain unit**: independently owned, source-backed flow joining
  several child modules; do not hide it inside the container summary.

Every user-visible child application, service, library, or CLI is classified as
its own index unit before deeper extraction.

For `extractTs()`, each child package must first be registered as its own source
boundary. One root source cannot be assigned to several index units because
source-level ownership would be ambiguous. If source registration intentionally
remains at repository level, use `extractCustom()` for the container registry
and assign aggregate candidates explicitly; do not use `include` to simulate
package ownership.

## Chapter blueprints

```markdown
# <Workspace> module registry
## Workspace purpose and discovery rules
## Child module inventory
## Module types, ownership, and lifecycle
## Dependency and layering constraints
## Shared configuration and tooling
## Build, test, cache, and release topology
## Generated/mirrored boundaries and exclusions
## Cross-module knowledge entrypoints
```

One child-module record may use:

```markdown
## <Module>
- Path and manifest:
- Primary/additional types and facets:
- Responsibility and owner:
- Stable entrypoints:
- Direct module dependencies:
- Build/release unit:
- Lifecycle/source of truth:
- Deeper index unit:
```

## Granularity and relationships

Do not perform a repository-wide symbol scan as the container extraction. The
container owns topology; child units own reader-facing application/service/API
knowledge. Aggregate the registry when hundreds of children share the same
shape, but preserve exact identities and locators.

A workspace manifest, package registry, build graph, or release manifest is a
valid stable `entries` locator even when the container has no executable
process. Every registry page must retain exact child identities and locators;
a directory listing is not a module map.

Use manifest/build-graph evidence for dependency edges. Imports can supplement
but should not override declared workspace ownership or package boundaries.

## Template composition examples

- A workspace containing a Web app, API gateway, CLI, and generated client
  produces one registry plus separately classified child units.
- A workspace with independent release groups selects `build-release`; retain
  the release map at the container level and package-specific compatibility in
  each `sdk-library` unit.
- A cross-module request flow reads `cross-module-chain.md` and receives its
  own output owner when it spans several child units.

## Revise or stop when

- module discovery relies only on a broad filesystem scan;
- the plan treats all repository files as one index unit;
- child ownership or source-of-truth boundaries are ambiguous;
- generated/cache/vendor directories dominate projected output;
- dependencies are inferred solely from names without manifest or graph proof.
