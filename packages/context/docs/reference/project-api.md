# Context Project API

The project has two durable declarations with separate responsibilities:

- `src/index.ts`: source references, document capture, custom non-knowledge
  orchestration, and package outputs.
- `src/indexers.yaml`: knowledge requirements, Provider selection, target/read
  scopes, profiles, and Provider customization.

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

When all registered Lark documents are intended for this project and share capture
settings, read the registry once instead of copying its module names into
`src/index.ts`. For the standard `src/index.ts` entry:

```ts
import { fileURLToPath } from "node:url";
import {
  allSources, captureLark, defineProject, loadSourcesRegistry, source,
} from "@c4a/context";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const registry = await loadSourcesRegistry({ rootDir: workspaceRoot });
const documents = registry.larks.map(entry =>
  source(entry.name, { type: "lark" }),
);

export default defineProject({
  sources: [...allSources("repo"), ...documents],
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
  site: { title: "Component knowledge", lang: "en-US", base: "/" },
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
`lang` and a deployment `base` path. Knowledge map is projected from
`src/knowledge-map.yaml` independently of KB directories; see
[Package Outputs](../guides/package-outputs.md#optional-static-documentation-website).

## Indexer registry

When this file is absent, the configuration Route supplies the initial schema:
write confirmed `requirements` with `indexers: []`, then re-evaluate. The Provider
selection Action supplies its own completion schema; that payload is not the
configuration file. Subsequent changes use typed proposals and applicable gates. Each selected Indexer binds requirements and scopes to one
primary Provider, with optional declared layers or composers. Provider code
must return the current Indexer result protocol; it must not write Candidate,
knowledge, or Review files directly.

Detailed Provider protocol and customization guidance is selected by the
current workflow Route when it is needed.

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
