# Context SDK

[简体中文](./README.zh-CN.md)

`@c4a/context` is the declarative model behind a Context knowledge workspace.
It lets the workspace describe which sources contribute knowledge, how evidence
is processed, where human review applies, and which reusable outputs should be
built.

Most users do not install or operate this SDK directly. They start through the
Context Agent entry, describe a knowledge goal, and let the selected workflow
Route guide the Agent when `src/index.ts` needs configuration. This README is
for knowledge-project authors, Agent maintainers, and developers who need to
understand that project declaration.

The SDK is intentionally declarative. It does not read sources, write workspace
state, execute an Agent, or build packages by itself. Those operations belong
to the [Context workflow runtime](../context-cli/README.md).

## Place in the knowledge workflow

```text
User intent + source boundaries
              ↓
       src/index.ts declaration   ← this package
              ↓
  Context Route + Agent judgment
              ↓
 approved knowledge → package output
```

The declaration answers four stable questions:

- Which registered source boundaries may contribute evidence?
- Which capture, extraction, alignment, compilation, and review phases exist?
- Which approved collections belong in each output?
- Which templates and asset-delivery policies shape the built package?

It does not encode current progress. Workspace facts and the bundled workflow
Provider select the next Route at runtime, so `src/index.ts` remains a project
contract rather than a second state machine.

## Project Model

A Context project follows a sources-to-phases-to-packages model:

```ts
import {
  defineProject,
  extractTs,
  kbPackage,
  reviewValidity,
  source,
} from "@c4a/context";

const sampleLib = source("20260712", "sample-lib");

export default defineProject({
  sources: [sampleLib],
  phases: [
    extractTs({ source: sampleLib, collection: "codeindex" }),
    reviewValidity({ collection: "codeindex" }),
  ],
  packages: [
    kbPackage({
      name: "sample-lib-kb",
      template: {
        path: "src/package-templates/kb",
        vars: { displayName: "Sample Library KB" },
      },
      select: { collections: ["codeindex"], okfRoots: ["wikis"] },
    }),
  ],
});
```

`src/index.ts` is similar to a build configuration for knowledge. It defines
what enters the project, which transformations and gates are available, and
what can be built at the end. The installed Agent entry stays thin; the current
workflow Route selects the exact procedures, schemas, and manuals needed to
maintain this declaration from the user's requirements.

## Public Surface

| API | Purpose |
|---|---|
| `defineProject()` | Declares the complete project graph. |
| `source()` and `allSources()` | References registered repo, file, or Lark source boundaries. |
| `extractTs()` | Extracts TypeScript/JavaScript and TSX/JSX symbols and relationships into `codeindex` candidates. |
| `extractCustom()` | Runs a project-owned code extractor while Context owns candidate, evidence, freshness, and Review state. |
| `alignProse()` and `compileProse()` | Structures document evidence and compiles source-bound knowledge candidates. |
| `reviewValidity()` | Declares the review gate for one collection or the project. |
| `customPhase()` | Adds project-specific orchestration when built-in phase factories are not enough. |
| `kbPackage()` | Builds an Agent knowledge-base package from approved knowledge and templates. |
| `llmsPackage()` | Builds a single text bundle for model context or RAG import. |

Use `extractCustom()` when a repository needs a non-TypeScript or aggregated
code extractor. Use `customPhase()` only for orchestration that does not publish
knowledge candidates; it is not a replacement for source, extraction, Review,
and package lifecycle rules.

Context CLI intentionally does not bundle every language or repository parser.
Optional structural libraries can be installed by the knowledge project and
used inside `extractCustom()`:

| Package | Structural facts |
|---|---|
| `@c4a/extract-go` | Go declarations, imports, calls, and common HTTP route registrations |
| `@c4a/extract-rush` | Rush projects, tags, entry signals, workspace dependencies, and owner boundaries |
| `@c4a/extract-ts` | TypeScript extraction plus reusable React Router route facts |

These libraries do not create Context phases or candidates by themselves. The
project maps their deterministic facts to its own candidate identities and
review summaries; Context continues to own evidence validation, freshness,
Review, close, and package output.

## Knowledge Collections

Approved Markdown is organized under `knowledge/<collection>/`:

| Collection | What it contains | Typical sources |
|---|---|---|
| `codeindex` | Code symbols, modules, and relationships | Code repositories |
| `business` | Business concepts, roles, and relationships | Business and Lark documents |
| `product` | Product capabilities and behavior | Product and requirement documents |
| `architecture` | System structure and design explanations | Architecture and design documents |
| `sop` | Procedures, runbooks, and operational steps | Handbooks and operation documents |
| `faq` | Common questions and troubleshooting | FAQs, support documents, experience notes |
| `decision` | Decisions, alternatives, and trade-offs | Design reviews and decision records |
| `incident` | Incident timelines, response, and follow-up | Incident reports and retrospectives |
| `standards` | Normative rules and constraints | Engineering standards and business rules |
| `test` | Validation rules, scenarios, and acceptance criteria | Test plans and acceptance documents |
| `feats` | Capability records for a specific use case | Custom project workflows and approved knowledge |

Collections are semantic classifications, not final package directories.
Package build maps selected collections into OKF roots such as `wikis/`,
`guides/`, `rules/`, and `feats/`. One source may contribute to several
collections; classification should be based on evidence and user confirmation,
not filenames.

## Package Templates

Package declarations point at editable templates under
`src/package-templates/`. Installed examples are available at:

```text
node_modules/@c4a/context/templates/package-templates/
```

The default KB template includes:

```text
kb/
|-- AGENTS.md
|-- skills/
|   `-- knowledge-query/SKILL.md
`-- wikis/index.md
```

The `knowledge-query` Skill teaches consuming Agents how to navigate indexes,
inspect approved knowledge, and cite evidence. A project can add more Skills or
template files under `wikis/`, `guides/`, `rules/`, and other package paths.

Templates use Handlebars variables in file contents and paths. Common variables
include `{{packageName}}`, `{{displayName}}`, `{{knowledgeCount}}`,
`{{knowledgeGroups}}`, `{{knowledgeItems}}`, `{{knowledgeTree}}`, and
`{{buildInventory}}`.

Every KB package emits flat roots such as `wikis/`, `guides/`, `rules/`, and
`feats/`. The package `name` defines only the `dist/<package-name>/` boundary;
it is not repeated inside knowledge paths. Context still accepts
`distribution.knowledgeNamespace` from older workspaces, but the legacy value
no longer changes build output and new declarations do not need it. Skill names
remain author-maintained and independent.

New KB setup should offer `assets: { delivery: "git-raw" }` first. Build
rewrites resource links to Git raw URLs; committing and publishing the resource
files remains the package author's responsibility. Non-Git workspaces may use
an explicit `urlPrefix`; without one they can bundle resources or explicitly
omit them and retain unresolved references. Bundled delivery may
install `sharp` in the workspace and configure `assets.optimize`; Context
itself has no image dependency and never changes source snapshots or approved
resources.

For advanced routing and retrieval, a template may carry a local script such as
`query.ts`, with a Skill describing when and how an Agent should call it. The
Skill can also route the Agent to MCP servers, CLI commands, or other tools to
form a package-specific Agentic Search workflow.

Long-lived, multi-source production workspaces can copy
`templates/project-skills/maintain-project-knowledge/SKILL.md` into their
`.agents/skills/` directory and customize it with project ownership, source
impact mappings, and readiness criteria. This project adapter is not included
in knowledge packages; lifecycle authority remains with the installed Context
Skill and current Route.

## State Boundary

The SDK stays declarative. It may describe reads, writes, phases, review, and
package selection, but the CLI owns source materialization, capture, extraction,
review application, approved Markdown materialization, verification, and build.
Do not replace CLI lifecycle operations with direct edits to `sources/`,
`knowledge/`, `dist/`, or the ignored `.tmp/context-runtime/lifecycle/` runtime
state. The CLI owns that runtime state and removes it after a successful close.

## Documentation

- [Documentation index](./docs/README.md)
- [Getting Started](./docs/getting-started.md)
- [Agent Guide](./docs/guides/agent-guide.md)
- [Project API](./docs/reference/project-api.md)
- [Package Outputs](./docs/guides/package-outputs.md)
- [Lark Resource Materialization](./docs/guides/lark-resources.md)
- [Package Templates](./docs/reference/package-templates.md)
- [Template Variables](./docs/reference/template-variables.md)

The [documentation index](./docs/README.md) explains which references should be
read for each workflow decision. Agents should prefer Route-selected resources
over preloading every manual.
