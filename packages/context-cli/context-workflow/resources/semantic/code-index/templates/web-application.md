---
id: semantic.code-index.template.web-application
kind: procedure
media-type: text/markdown
---

# Web and interactive application template

Use only after evidence classifies a module as `web-application`. This covers
browser applications, server-rendered sites, embedded WebViews, desktop Web
shells, native mobile/desktop applications, cross-platform UI runtimes, and
similar interactive modules. The `web-application` identifier is retained for
the current contract but represents an interactive application boundary, not
only browser code. It does
not automatically cover every package containing UI components; a reusable
component package is usually `sdk-library`.

Recommended `outputProfile`: `application-map`.

## Evidence pass

Locate the concrete application bootstrap and trace outward just far enough to
find:

- application mounting, server rendering, shell, or host-container entry;
- route/page/screen registries and navigation guards;
- page-to-state, loader, query, client, bridge, or controller boundaries;
- runtime configuration, environment selection, feature registration, and
  authentication/session initialization;
- build, local development, test, bundle, and release entrypoints;
- generated clients, assets, styles, fixtures, and legacy routes that should
  remain evidence rather than reader-facing pages.

If the route registry is generated, locate both its generator or source of
truth and the runtime consumer. Do not infer page identity from a directory
tree when an explicit registry exists.

## Questions the knowledge must answer

A useful application index should let a reader determine:

1. How does the application start, and which runtime or host does it expect?
2. What are the stable pages/routes/screens and their entry components?
3. How does a page obtain data or call an external capability?
4. Which state, session, bridge, or configuration boundaries affect behavior?
5. How is the module run, debugged, built, and released?
6. Which implementation details are intentionally outside the knowledge scope?

## Suggested knowledge units

Select only units supported by the confirmed goal and evidence:

- **Application map**: responsibility, runtime, bootstrap, major subsystems,
  stable dependencies, and navigation to deeper pages.
- **Route or page registry**: concrete route/page identity, entry component,
  loader/guard, main data boundary, and source locator. Aggregate related
  routes when a page-per-route layout would be repetitive.
- **Data and protocol boundaries**: add application-specific page, state, and
  session context to the canonical operation record in `protocol-boundary.md`;
  do not create a second operation registry.
- **State and host integration**: only stable stores, bridges, extension points,
  or host contracts that affect multiple pages or public behavior.
- **Runtime and delivery guide**: module-owned development commands,
  configuration, build output, deployment/release entry, and evidenced recovery
  paths.
- **Cross-layer flow**: a source-backed page-to-client-to-provider chain when
  both sides are registered sources.

These are possible page families, not a required number of Markdown files.

## Chapter blueprints

An application-map page may use:

```markdown
# <Application> module map
## Responsibility and supported runtime
## Bootstrap sequence
## Route/page organization
## State, data, and protocol boundaries
## Host integrations and extension points
## Configuration and environment selection
## Development, build, and release entrypoints
## Known exclusions and source-of-truth links
```

A route/page registry may use a compact record rather than prose repetition:

```markdown
## <Route or page family>
- Identity and registration:
- Entry component or controller:
- Loader, guard, or initialization:
- Main client/state dependencies:
- User-visible outcome:
- Source evidence:
```

A cross-layer page may use:

```markdown
# <User interaction> execution path
## Trigger and route entry
## UI/state orchestration
## Protocol request and authoritative contract
## Provider boundary and response handling
## Failure, fallback, and observability
## Source-backed relationship chain
```

Do not fill a heading with generic text. Omit or mark a section as a material
gap when the source cannot support it.

## Granularity and relationships

Prefer stable application concepts over one page per component, hook, state
field, style, generated type, or internal helper. A page registry must contain
real identities and source locators, not just folder names. A protocol page
must name concrete operations or contract locations, not merely state that the
application “uses HTTP”.

Create structured relationships only when registration, call sites, imports
with unambiguous ownership, or parser evidence support them. Keep inferred
product intent out of the index.

## Template composition examples

- A server-rendered application with local API routes also reads
  `api-service.md` and `protocol-boundary.md`.
- An embedded application with a host bridge also reads `adapter.md` and the
  applicable `plugin-extension.md` or `protocol-boundary.md` template.
- A design-system package rendered in a demo application may need separate
  index units: `sdk-library` for the supported package and `web-application`
  for the demo host.

## Revise or stop when

- no executable bootstrap or route registry can be located;
- the proposed output is only a directory summary;
- protocol semantics depend on unavailable material;
- generated routes or clients are being mistaken for authoritative behavior;
- one-symbol-per-page selection expands components or API types without a
  deliberate public-reference goal.

Resolve these issues before the measured batch preview.
