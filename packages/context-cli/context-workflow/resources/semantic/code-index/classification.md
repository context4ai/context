---
id: semantic.code-index.classification
kind: procedure
media-type: text/markdown
---

# Classify code modules before choosing a template

This procedure is the first semantic step for code extraction. Start from the
Route-selected batch inspection. Do not open an archetype template and then fit
the module to it. First classify every confirmed module from inspected evidence,
then read only the matching templates.

Classification determines which reader questions the index must answer. It
does not grant access to undeclared sources, prove a relationship, or override
the measured extraction preview.

## 1. Use one batch evidence pass

Use the inspection result for every confirmed module before opening more files.
It already reports manifests, maintained documentation, entry candidates,
protocol locators, lifecycle signals, and generic structural capabilities.
Open source files only for unresolved facts, and follow stable registration or
executable wiring rather than scanning the whole tree.

Confirm, where applicable:

- the module manifest or workspace registration;
- its README or nearest maintained operating documentation;
- build, executable, application, service, or library entrypoints;
- route, command, service, event, job, plugin, or export registries;
- authoritative protocol/schema locations and concrete consumer call sites;
- generated, mirrored, vendored, legacy, test, fixture, and mock boundaries;
- development, configuration, deployment, and release entrypoints owned by the
  module.

A language, framework dependency, exported symbol, or folder name does not by
itself prove a module type.

## 2. Record classification before reading templates

Produce one batch table first:

| module | primary type | additional types | facets | evidence paths | gaps |
| --- | --- | --- | --- | --- | --- |
| `customer-portal` | `web-application` | — | `page-routing`, `protocol-consumer` | `package.json`, `src/routes.ts` | upstream schema is external |
| `edge-gateway` | `api-service` | `adapter` | `protocol-provider`, `protocol-consumer` | `cmd/server.go`, `api/openapi.yaml` | — |

Each module must have:

- one primary `moduleType` for concise reports;
- every additional applicable type in `moduleTypes`;
- relevant behavior and boundary `facets`;
- concrete inspected paths in `moduleTypeEvidence`;
- an explicit gap when available source cannot support a reliable claim.

Choose the primary type from the boundary through which a reader most often
enters the module. A gateway is normally `api-service`, a plugin-hosting command
application is normally `cli-tool`, and a generated client is normally
`sdk-library`; their translation or provenance roles remain additional types.

Supported types are:

- `web-application`: browser, native mobile, desktop, embedded, or cross-platform
  interactive applications with routes, pages, screens, or host integration;
- `api-service`: an HTTP, RPC, GraphQL, message-request, or similar inbound
  protocol surface with dispatch to handlers;
- `service`: a stable domain/use-case or reusable service boundary whose public
  operations coordinate implementation or persistence;
- `background-runtime`: workers, consumers, schedulers, pipelines, functions,
  or long-running processes driven by triggers rather than interactive calls;
- `sdk-library`: a reusable package with a deliberately supported consumer API;
- `cli-tool`: an executable tool organized around commands, flags,
  configuration, outputs, and exit behavior;
- `adapter`: a bridge that translates protocols, identities, models, lifecycle,
  or host capabilities between boundaries;
- `monorepo-container`: a workspace whose stable value is its child-module,
  ownership, dependency, build, or release topology;
- `derived-source`: generated, mirrored, vendored, or legacy source whose
  authority lives elsewhere;
- `contract-source`: an authoritative IDL, API description, schema, or contract
  registry used by providers, consumers, generators, or validators;
- `unknown`: the source is insufficient to classify without guessing.

`unknown` cannot be combined with a known type. A hybrid module may combine
several known types. Independent infrastructure definitions, migration sets,
or data-model projects that do not fit a supported type remain `unknown` and
use a project-owned inspection/extraction adapter; do not force them into an
unrelated application type.

## 3. Add composable facets

Facets identify behavior that may cross the primary type:

- `page-routing`: concrete route, page, screen, or navigation registration;
- `public-api`: a deliberately supported programmatic consumer surface;
- `protocol-provider` / `protocol-consumer`: inbound or outbound operation
  boundaries with authoritative locators;
- `event-producer` / `event-consumer`: asynchronous trigger and delivery flow;
- `persistence`: repository, datastore, cache, or durable-state boundary;
- `plugin-extension`: discovery, activation, contribution, or host extension;
- `configuration-runtime`: configuration or runtime selection that changes
  observable behavior;
- `build-release`: module-owned build, packaging, deployment, or release entry;
- `cross-module-chain`: an evidenced flow joins two or more registered modules;
- `generated-contract`: generated code represents or locates an upstream
  schema but is not automatically authoritative.

Require a registration, call site, schema locator, or runtime entry. A matching
dependency alone is not evidence.

## 4. Read matching templates

After the batch table is complete, read every applicable type template and only
the applicable facet template:

| Type or facet | Template path |
| --- | --- |
| `web-application` | `resources/semantic/code-index/templates/web-application.md` |
| `api-service` | `resources/semantic/code-index/templates/api-service.md` |
| `service` | `resources/semantic/code-index/templates/domain-service.md` |
| `background-runtime` | `resources/semantic/code-index/templates/background-runtime.md` |
| `sdk-library` | `resources/semantic/code-index/templates/sdk-library.md` |
| `cli-tool` | `resources/semantic/code-index/templates/cli-tool.md` |
| `adapter` | `resources/semantic/code-index/templates/adapter.md` |
| `monorepo-container` | `resources/semantic/code-index/templates/monorepo-container.md` |
| `derived-source` | `resources/semantic/code-index/templates/derived-source.md` |
| `contract-source` | `resources/semantic/code-index/templates/contract-source.md` |
| `protocol-provider`, `protocol-consumer`, `generated-contract` | `resources/semantic/code-index/templates/protocol-boundary.md` |
| `event-producer`, `event-consumer` | `resources/semantic/code-index/templates/event-flow.md` |
| `persistence` | `resources/semantic/code-index/templates/persistence-boundary.md` |
| `plugin-extension` | `resources/semantic/code-index/templates/plugin-extension.md` |
| `cross-module-chain` | `resources/semantic/code-index/templates/cross-module-chain.md` |

`page-routing` and `public-api` refine their matching application or library
template. `configuration-runtime` and `build-release` add chapter expectations
to the selected type template. They do not require duplicate pages.

Templates are question sets and chapter blueprints. Omit unsupported sections,
merge overlapping output, and retain concrete identifiers and source locators
for every kept claim.

## 5. Match the plan to the extractor

Extractor shape is part of the plan, not an implementation detail:

- `extractTs()` projects each selected symbol to its own candidate page. It is
  suitable for a deliberately granular public reference, but it does not
  produce an aggregated module map, registry, protocol index, or chain page.
- `extractTs()` assigns ownership by source. A source can belong to only one
  index unit in a phase. Splitting one source into several units or adding an
  overlapping cross-source unit causes `ownership-ambiguous`.
- Use `extractCustom()` for aggregate pages or multiple units over one source.
  Every candidate must declare its owning `module`, and its evidence must cover
  the Route-reported structural probes. Use evidence-scoped `sections` rather
  than one undifferentiated `markdown` body: each section declares a coverage
  kind and the exact source evidence supporting that part of the page. Resolve
  source roots from the extractor context's `sources[].absolutePath`; never
  embed a machine-specific checkout path.
- Register independently visible monorepo children as separate sources before
  giving them separate `extractTs()` units. An `include` pattern filters files;
  it does not create a source boundary.

Do not wait for an expensive preview to discover that the chosen extractor
cannot produce the planned page shape.

## 6. Produce one deduplicated plan

Create one `CodeIndexUnitPlan` per user-visible module or independently useful
custom cross-module flow. A minimal plan has this shape:

```ts
{
  module: "customer-portal",
  moduleType: "web-application",
  moduleTypes: ["web-application"],
  facets: ["page-routing", "protocol-consumer"],
  moduleTypeEvidence: ["package.json", "src/routes.ts"],
  outputOwner: "customer-portal",
  outputProfile: "application-map",
  inputSources: ["repo:customer-portal"],
  entries: ["src/bootstrap.ts", "src/routes.ts"],
  protocols: ["api/openapi.yaml"],
  excludes: ["dist/**", "**/*.test.ts"],
  lifecycle: "source",
  pageKinds: ["application-map", "route-registry", "protocol-boundary"],
  capability: "complete"
}
```

`outputProfile` is a closed value and selects structural coverage expectations:

| Profile | Intended output |
| --- | --- |
| `module-map` | stable module responsibility and entry map |
| `application-map` | application entry, route, state, and boundary map |
| `protocol-index` | provider/consumer operations anchored to contracts |
| `service-boundary` | service operations, orchestration, and dependencies |
| `runtime-map` | triggers, processing, state, effects, and recovery |
| `public-api-reference` | deliberately supported consumer API |
| `command-map` | commands, options, effects, outputs, and recovery |
| `adapter-contract` | inbound-to-outbound translation contract |
| `module-registry` | workspace child modules, ownership, and topology |
| `cross-module-flow` | evidenced handoffs across registered modules |
| `provenance-only` | source identity, derivation, consumers, and authority |

The preview also requires these evidence-scoped section kinds:

| Profile | Required section coverage |
| --- | --- |
| `module-map` | `responsibility`, `entrypoint` |
| `application-map` | `entrypoint`, `operation`, `handoff` |
| `protocol-index` | `contract`, `operation`, `handoff` |
| `service-boundary` | `operation`, `handoff` |
| `runtime-map` | `entrypoint`, `operation`, `failure-recovery` |
| `public-api-reference` | `contract` |
| `adapter-contract` | `contract`, `handoff` |
| `command-map` | `entrypoint`, `operation`, `failure-recovery` |
| `module-registry` | `responsibility`, `source-authority` |
| `cross-module-flow` | `operation`, `handoff`, plus at least one structured edge |
| `provenance-only` | `source-authority` |

The `build-release`, `persistence`, `configuration-runtime`, and
`generated-contract` facets additionally require `delivery`, `state-boundary`,
`state-boundary`, and `source-authority` respectively. A heading without an
evidence-scoped section does not satisfy coverage.

The profile affects structural probes and advisory risks. `pageKinds` remains
free-form so projects can name useful page families, but use stable kebab-case
tokens consistently within a project. Type templates provide recommended
tokens.

For a multi-module round, finish all classifications first, read the union of
matching templates once, and revise affected plans together. Do not create a
copy of the same operation or plugin record for each selected template.

## 7. Capability gaps and preview

Use `capability: "material-required"` when an unsupported parser, missing
project adapter, absent evidence, or unresolved source boundary prevents the
promised output. This typed capability is valid in ordinary and fully managed
flows and stops both at the same Route Gate.

Missing authority does not always block all output. For generated or mirrored
source whose upstream schema cannot be located, a `provenance-only` unit may
still record source identity, known derivation facts, and evidenced consumers.
Keep field semantics and compatibility claims material-required. Stop the
whole unit only when those semantics are the confirmed knowledge goal.

Run the Route-selected batch preview after every plan is evidence-backed. Its
projected Markdown count is authoritative per index unit:

- up to 100 pages: continue;
- 101–300 pages: report an advisory and continue;
- more than 300 pages: block and revise, including in fully managed mode.

A large batch also reports a batch-total advisory even when each unit remains
within its limit. Advisory risks describe quality or cost; they do not become a
new human Gate. `scale-limit-exceeded`, `ownership-ambiguous`, and
`material-required` capability gaps remain blocking.

Legal recovery includes narrowing `include`, excluding generated or mirrored
areas, using `exportedOnly`, changing a symbol catalog into an aggregated
`extractCustom()` output, or registering real child sources. Splitting one
`extractTs()` source into overlapping units is not a valid workaround. Group all
affected modules into one plan revision instead of creating one Gate per
module.
