# Context Project API

The project has two durable declarations with separate responsibilities:

- `src/index.ts`: source references, document capture, custom non-knowledge
  orchestration, and package outputs.
- `src/indexers.yaml`: long-term reader requirements, authorized target/supporting
  sources and confirmed exclusions. Skill choices belong to the temporary plan.

Do not describe the same knowledge transformation in both files.

## `defineProject`

```ts
defineProject({
  sources: [],
  phases: [],
  packages: [],
});
```

The definition is declarative. Loading it must not mutate knowledge or runtime
state.

## Sources

For optional directory inventories and recoverable registration, see
[Resumable source operations](../guides/source-batches.md). These operations do
not select or expand the current production scope.

```ts
const repo = source("20260901", "component-lib");
const docs = source("20260901/product-docs", { type: "file" });
const handbook = source("20260901/handbook", { type: "lark" });
const note = source("20260908/decision-context.md", { type: "note" });
const session = source("20260908/design-discussion.md", { type: "sessions" });
const everyRepo = allSources("repo"); // array: use ...everyRepo inside sources
const everySession = allSources("sessions");
```

Repo, file and Lark references resolve against their respective
`sources/<type>/index.yaml`. Their names include the registration date and module.
Register or refresh them through `context source ...`.

Note and Sessions references resolve directly to saved Markdown under
`sources/note/YYYYMMDD/topic.md` and `sources/sessions/YYYYMMDD/topic.md`.
Use `context source import` to save them; they have no separate registry or
capture phase. Explicitly include the desired typed references in `sources`,
for example `sources: [note, session]`, or use `sources: [...everySession]`
when all saved sessions are intended. Merely saving a source does not select it.

A project's source list enables acquisition and initial selection; requirements
and the selected Indexer's target/read scopes determine what it owns and may read.
Supporting text does not require a separate page or primary Indexer. See
[note preparation](../guides/note.md), [sessions preparation](../guides/sessions.md)
and [knowledge updates](../guides/knowledge-updates.md).

## Capture phases

For ordinary acquisition, add `--configure` to `context source add repo`, `file`,
`lark` or `batch`. The command registers the selected inputs and generates explicit
source references and default document capture phases in `src/index.ts`. It does
not fetch content, select other registrations or change package outputs.

Generation supports a literal `defineProject` with literal source/phase arrays
and recognizable SDK calls. Existing capture settings are preserved, repeated
registration is idempotent, and custom/dynamic entries remain untouched with a
`configuration.status: manual` hint. Registration is still saved; edit only the
needed declarations through the normal configuration path. For special processors
or resource options, configure them before following the capture Route. Omitting
`--configure` keeps registration-only behavior.

```ts
captureFile({ source: docs });
captureFile({ source: docs, processor: mdxJsonDocs() });
captureLark({ source: handbook });
```

Capture only creates a deterministic readable snapshot. Classification,
partitioning and authoring use the selected Provider's guidance. The CLI owns
worksets, Candidate creation, Review application and delivery. Code, Markdown,
Note and Sessions Providers can use authorized supporting documents without
creating a second capture or knowledge pipeline.

### Batch capture from the source registry

For documents with shared capture settings, prefer registry-driven configuration
over repeating source declarations and capture calls, even for two documents.
Select the task's intended registrations first. The example below assumes all
registered Lark documents are in scope, with the standard `src/index.ts` entry:

```ts
import { fileURLToPath } from "node:url";
import {
  captureLark, defineProject, loadSourcesRegistry, source,
} from "@c4a/context";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const registry = await loadSourcesRegistry({ rootDir: workspaceRoot });
// For a subset, filter registry.larks by the authorized namespace/names here.
const documents = registry.larks.map(entry =>
  source(entry.name, { type: "lark" }),
);

export default defineProject({
  sources: documents,
  // Shared settings, independent source identities and capture phases.
  phases: documents.map(document => captureLark({ source: document })),
  packages: [],
});
```

Merge this pattern into existing declarations; preserve unrelated phases and
package outputs. Adjust the root calculation if the entry lives elsewhere.
Registry loading only reads local registrations; it does not fetch documents.

- `sources/lark/index.yaml` owns document identities, URLs and titles. The project
  selects those identities and declares capture settings. This example includes
  future registrations too; use it only when the entire registered set is intended.
- For a subset, filter registry entries by the intended namespace or names before
  mapping. Apply exceptional resource settings within the same map instead of
  declaring a second phase for the same document.
- File documents use `registry.files`, `source(entry.name, { type: "file" })`
  and `captureFile`. Group by actual processor needs; do not apply `mdxJsonDocs()`
  indiscriminately to all file sources.
- `allSources("lark")` selects a collection; its array contains a collection
  reference, not individual documents. It neither expands capture phases nor
  supports mapping its entries into `captureLark`.
- The map declares one phase per document. It does not fetch URLs, change capture
  permissions, or request parallel execution. Run the declared phases through the
  existing CLI flow so each document retains independent refresh and retry behavior.
  This reduces configuration repetition, not the number of capture operations.
- Capture boundaries do not dictate article boundaries. During planning and
  writing, combine related captured documents around reader tasks when useful;
  do not create one article or a complete production cycle per source by default.

## `customPhase`

```ts
customPhase("project:refresh-catalog", async (ctx) => {
  await ctx.ensureSources();
});
```

Use it for project orchestration that does not publish knowledge or bypass the
Indexer lifecycle. Declare stable reads/writes when the phase has them.

## Packages

```ts
kbPackage({
  name: "component-kb",
  template: "src/package-templates/kb",
  select: { collections: ["codeindex", "architecture"] },
  site: {
    title: "Component knowledge",
    lang: "en-US",
    base: "/",
    home: {
      title: "Component knowledge",
      slogan: "Build with the public contract in view",
      description: "Browse components, usage guidance and implementation boundaries.",
      resources: [{
        title: "Project workspace",
        description: "Open the repository that maintains this knowledge.",
        href: "https://example.com/project",
        featured: true,
      }],
    },
  },
});

llmsPackage({
  name: "component-context",
  template: "src/package-templates/llms",
  select: { collections: ["codeindex"] },
});
```

Package selection reads approved `knowledge/` only. `dist/` is generated and
may be rebuilt; it is not an authoring source.

`kbPackage.site` optionally adds a VitePress website at `dist/<base>-site/` in
the same build, beside the KB directory. `<base>` removes one trailing `-kb`
from the package name, if present. Omit it for KB-only output. It accepts `title`, `description`,
`lang`, a deployment `base` path, and an optional `home` presentation. `home`
accepts `title`, `slogan`, `description`, hero `actions`, and `resources` shown
below the generated site map. Each resource needs an `href`, a copyable
`command`, or both. Omit unknown resources; the builder never invents service
or repository links. Knowledge map is projected from
`src/knowledge-map.yaml` independently of KB directories; see
[Package Outputs](../guides/package-outputs.md#optional-static-documentation-website).

`site.extensions` optionally names a trusted `src/site` root, homepage and floating
`slots`, and custom Markdown `pages`. Place custom pages in the same knowledge map
with `target.artifact_ref: "site:<page-key>"`. See
[Page content customization](../guides/page-customization.md) for the configuration
and the boundary between presentation code and approved knowledge.

## Knowledge requirements and Indexer Skills

When `src/indexers.yaml` is absent, the configuration Route supplies its schema.
Write `requirements` only; do not add `protocol`, `indexers`, Provider selections
or profiles. Re-evaluate after changing confirmed requirements.

Installed Indexer Skills guide investigation and writing. Relevant Skill choices
and optional configuration use `indexer_usage` in the temporary production plan,
not this durable file. There is no separate Provider selection or resolution gate.
The Agent writes task drafts and reference files under the returned temporary
directory; the CLI accepts them and owns Candidate, Review and formal output.
See [Indexer guidance](../guides/indexer-provider-and-customization.md).

## Persistent versus runtime state

Source registries and snapshots, saved notes/summaries, project declarations,
package templates and approved knowledge are durable inputs. Version them only
when Git operations are authorized. Keep `.tmp/context-runtime/` out of Git;
it contains unfinished execution state, not the sole source of recovery truth.

`knowledge/structure.yaml` keeps shared page/source metadata and compact
`processed_scopes` for completed requirement/source/module ranges. A partial
update or failed build does not advance the whole range's processed version.
Session commit/MR associations stay in the saved source frontmatter, not copied
into every knowledge page. Use the CLI to adjust or roll back current work;
do not edit these baselines or remove runtime files to simulate completion.

## Source visual conversion preference

Workspace `package.json` accepts `context.convertVisuals` (boolean, default `true`). Initialization writes it explicitly; older workspaces without the field also default to enabled. This lets a capable Author Agent attempt faithful structural diagram/table conversion. Explicit session instructions override the saved preference. It does not disable native table capture or existing Mermaid when false.

Diagram style follows the workspace’s editable `AGENTS.md`; newly initialized workspaces default to minimal theme-aware diagrams without decorative colors. If the Agent cannot read the image or cannot preserve its meaning, it retains the original through the existing asset workflow. Source-based reuse avoids rereading unchanged visuals; file integrity and package hashes continue to reflect actual output changes.
