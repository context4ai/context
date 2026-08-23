# Package Templates

Packages project approved knowledge into `dist/<package-name>/`.

For the user-facing decision process, read
[Package Outputs](../guides/package-outputs.md) first. This reference only
documents the API and template behavior.

## Package Factories

```ts
import { llmsPackage, kbPackage } from "@c4a/context";
```

### `kbPackage`

```ts
kbPackage({
  name: "component-lib-kb",
  template: {
    path: "src/package-templates/kb",
    vars: { displayName: "Component Library KB" },
  },
  select: {
    collections: ["architecture", "sop"],
    okfRoots: ["wikis", "guides"],
    include: ["architecture/component-lib/**", "sop/component-lib/**"],
    exclude: ["**/internal/**"],
  },
  navigation: {
    foldDirectoryIndexes: true,
    maxInlineEntries: 50,
  },
  assets: { delivery: "bundle" },
});
```

### `llmsPackage`

```ts
llmsPackage({
  name: "component-lib-llms",
  template: "src/package-templates/llms",
  select: { include: ["codegraph/component-lib/**"] },
});
```

## Required Fields

| Field | Required | Meaning |
|---|---:|---|
| `name` | yes | Lowercase path-safe package name. Output goes to `dist/<name>/`. |
| `template` | yes | Project-relative template directory or `{ path, vars }`. |
| `select` | no | Approved knowledge selector. Omit to include all approved knowledge. Supports internal `collections`, OKF `okfRoots`, and `include` / `exclude` path patterns relative to `knowledge/`. |
| `navigation` | no | KB directory-index policy. Defaults to `{ foldDirectoryIndexes: true, maxInlineEntries: 50 }`. |
| `assets` | no | Resource delivery: bundled files by default, explicit Git raw links, or explicit omission. |
| `distribution` | no | Legacy input accepted from older workspaces. It no longer changes package paths and should not be added to new declarations. |

Bundled delivery is the default. Selected resources are written below
`others/assets/`. Supported images are automatically compressed when required
to keep each image at or below 1 MiB and all package images at or below 40 MiB.
The source snapshots and approved `knowledge/assets/` files are never changed.

Use Git raw delivery only when it is explicitly configured for resources
published from a Git repository.
Without `urlPrefix`, the Context workspace must be inside Git; GitHub remotes
are derived automatically and pinned to the current commit. Other hosts accept
an explicit HTTPS prefix. `{commit}` is replaced only when the workspace is
inside Git, because Context must resolve the current commit. A workspace outside
Git must use a literal, already-published prefix without `{commit}`. Context
appends the project-relative `knowledge/assets/...` path.

For a non-GitHub service that exposes raw files through the GitHub-compatible
same-host layout
`https://<host>/<namespace>/<repository>/raw/<ref>/<path>`, derive and configure
the explicit prefix before choosing Git raw delivery. For example, use
`https://git.example.com/team/knowledge/raw/{commit}` for a workspace at the
repository root. If the workspace is nested, append its repository-relative
directory to the prefix because Context appends only the project-relative
`knowledge/assets/...` path. This derivation is appropriate only when the
service's raw convention and repository identity are confirmed; otherwise ask
for the prefix or keep the default bundled delivery. Never invent a raw URL
only because Context does not automatically recognize a host.

The resolved commit and raw URL participate in package freshness, so changing
Git HEAD or the selected remote makes an existing package stale. Context does
not check whether resources are committed, pushed, or remotely readable;
publishing them is the package author's responsibility. A literal branch in the
prefix is allowed but intentionally follows that mutable branch. The configured
raw host must be reachable by the eventual package consumers.

```ts
assets: {
  delivery: "git-raw",
  urlPrefix: "https://code.example.com/team/knowledge/raw/{commit}",
}
```

Outside Git, use a literal published prefix or choose bundled delivery or
explicit omission:

```ts
assets: {
  delivery: "git-raw",
  urlPrefix: "https://code.example.com/team/knowledge/raw/published-assets",
}
```

```ts
assets: { delivery: "bundle" }
assets: { delivery: "omit" } // keeps unresolved links and reports them
```

Explicit `assets.optimize` overrides the automatic output policy.
`optimize.mode: "webp"` accepts `quality` from 1 to 100. Both modes accept
an optional positive `maxDimension`; images are never enlarged. Context adopts
a generated image only when it is smaller, uses a digest-derived `.webp` path,
and rewrites package links. If explicit settings cannot meet the package image
budgets, build stops before replacing the previous `dist/` package.

`template` is required. Do not call `kbPackage({ name })` or
`llmsPackage({ name })`.

## Flat Package Roots

`name` identifies the package boundary under `dist/`. Context does not repeat
that name inside the package's knowledge roots.

Templates keep a logical, consumer-neutral layout:

```text
skills/knowledge-query/SKILL.md
wikis/index.md
guides/...
rules/...
feats/...
```

For `name: "component-lib-kb"`, `context build` writes:

```text
skills/knowledge-query/SKILL.md
wikis/index.md
guides/...
rules/...
feats/...
```

The builder maps copied knowledge, generated indexes, links, and inventory
records into these roots without rewriting Markdown prose or inferring a
downstream registry identity. New declarations should omit `distribution`.
Older declarations that still contain `distribution.knowledgeNamespace` remain
loadable, but the value does not change output paths or the build fingerprint.

Use `{{wikisRoot}}`, `{{rulesRoot}}`, `{{guidesRoot}}`, or `{{featsRoot}}` in
Skill templates so references share the package-root contract. These variables
render to the flat root names above.

Each rendered Skill must live at `skills/<skill-name>/SKILL.md`, and its YAML
frontmatter `name` must equal `<skill-name>`. Use `{{skillName}}` in custom
Skill templates. Skill names are author-maintained: when a short prefix is
useful, rename the template directory to the complete final name, such as
`skills/android-query/`; Context does not derive it from
the package name.

## Template Variables

Templates are rendered with Handlebars. Variables are available in both file
contents and file paths.

Built-in variables:

| Variable | Meaning |
|---|---|
| `{{packageName}}` | Package name from the declaration. |
| `{{packageKind}}` | `kb` or `llms`. |
| `{{knowledgeNamespace}}` | Legacy configured namespace when an older workspace still declares one; otherwise empty. Do not use it for new output paths. |
| `{{namespacedKnowledge}}` | Always `false`; retained only so older templates remain renderable. |
| `{{skillName}}` | Current author-maintained Skill directory name. |
| `{{skillPath}}` | Current Skill's final package-relative `SKILL.md` path. |
| `{{wikisRoot}}`, `{{guidesRoot}}`, `{{rulesRoot}}`, `{{featsRoot}}` | Final package-relative OKF root paths. |
| `{{displayName}}` | Display name. Defaults to a title-cased `packageName`; override with `template.vars.displayName`. |
| `{{knowledgeCount}}` | Number of selected approved Markdown files. |
| `{{knowledgeTimestamp}}` | Latest `timestamp` from selected approved Markdown, or `1970-01-01T00:00:00.000Z` when empty. |
| `{{knowledge}}` | Concatenated selected approved Markdown bundle. |
| `{{approvedKnowledge}}` | Alias for `{{knowledge}}`. |
| `{{knowledgeItems}}` | Array of selected approved knowledge page metadata for loops. |
| `{{knowledgeGroups}}` | Selected approved knowledge pages grouped by OKF root and first directory segment; each item also exposes `internal_collection`. |
| `{{knowledgeTreeNodes}}` | Nested path tree for custom navigation. |
| `{{knowledgeTree}}` | Markdown tree preview. |
| `{{knowledgeItemsMarkdown}}` | Markdown page list. |
| `{{knowledgeGroupsMarkdown}}` | Markdown navigation for the current index: direct page links for folded directories and links to generated indexes for expanded directories. |

Custom variables come from `template.vars`.

For loops, conditionals, comments, and record fields, read
[Template Variables](./template-variables.md).

## Template Examples

Installed examples:

```text
node_modules/@c4a/context/templates/package-templates/kb/
node_modules/@c4a/context/templates/package-templates/llms/
```

Workspace convention:

```text
src/package-templates/
├── kb/
│   ├── AGENTS.md
│   ├── wikis/
│   │   └── index.md
│   └── skills/
│       └── knowledge-query/
│           ├── SKILL.md
│           └── scripts/
│               └── search.mjs
└── llms/
    └── llms.txt
```

`kbPackage()` is for an agent knowledge-base package. The package still uses a
`skills/` folder internally because Claude/Codex consume reusable agent
instructions from that convention. Its template must contain at least one
`SKILL.md` file and `wikis/index.md`. A template with only `AGENTS.md` is a
placeholder document package, not a usable kb package, and `context build`
rejects it.

The default kb template includes:

- `skills/knowledge-query/SKILL.md`, a reusable skill that teaches agents to
  query copied knowledge pages structure-first, cite page/section evidence, use
  `context-build-inventory.json` edge records for package-visible
  relationships, and report gaps instead of inventing unsupported answers. The
  build inventory also exposes `structure.relationship_coverage` so a consumer
  can distinguish an observed zero-edge result from unknown relationship
  coverage. The
  default entry OKF root is `wikis/`; packages that select additional internal
  collections expose
  `guides/`, `rules/`, or `feats/` indexes when those roots are selected.
- `skills/knowledge-query/scripts/search.mjs`, a dependency-free BM25 fallback
  for exact terms, mixed keyword queries, and large Markdown indexes. It chunks
  mechanically, returns inspectable paths and line ranges, and never replaces
  source-backed relationship evidence.
- `wikis/index.md`, the editable OKF bundle entry page for the generated
  `dist/<package-name>/wikis/` directory.

During `context build`, the root `wikis/index.md` is rendered from the template.
The builder always provides an index for every selected OKF root. With the
default navigation policy, smaller child directories are folded into their
nearest generated ancestor index, so a short collection can link directly to
its pages instead of producing one index per path segment.

## OKF Directory Indexes

The generated
`dist/<package-name>/wikis/` tree is the required default
KB entry surface. Internal collections are mapped into OKF roots during build:
`codegraph`, `business`, and `product` go to `wikis/`; `architecture`, `sop`,
`faq`, `decision`, and `incident` go to `guides/`; `standards` and `test` go to
`rules/`; and `feats` goes to `feats/`. Treat `wikis/` as the structured
entity-and-relationship layer. Guides and rules may explain, operationalize,
or constrain that knowledge, but directory placement alone does not establish
a relationship.

Default navigation rules:

- `wikis/index.md` is the required default bundle index. Other selected OKF
  roots always use their own `<okf-root>/index.md`.
- With `foldDirectoryIndexes: true`, directory indexes are planned bottom-up.
  A non-root directory gets its own `index.md` only when the page and child-index
  entries it would expose to its parent are greater than `maxInlineEntries`.
  The default threshold is `50`.
- A folded directory is not discarded. Its pages are listed in the nearest
  generated ancestor index, grouped by their relative directory path, while
  retained descendant indexes are linked directly from that ancestor. This
  also removes large but navigation-thin intermediate directories.
- The threshold counts visible navigation entries after descendant indexes are
  planned. It does not inspect Markdown line counts, headings, or content
  semantics.
- Set `foldDirectoryIndexes: false` to generate an `index.md` for every
  directory, matching the fully expanded navigation shape.
- A generated directory index uses OKF frontmatter with `type: Knowledge
  Directory`, `title`, `description`, `tags`, `timestamp`, `resource`,
  `package`, `package_kind`, and `knowledge_count`.
- Directory indexes list generated child indexes first, then pages from folded
  paths.
- `context build` validates links in OKF root indexes and generated
  child `index.md` files. Relative links must resolve to files inside
  `dist/<package-name>/`; broken links are reported as
  `package/index-link-invalid`.
- If a project needs curated default navigation, edit the template-owned
  `wikis/index.md`. Template files or copied knowledge pages that collide with
  an index path selected by the current navigation policy are rejected during
  build/status preflight.

The generated templates are complete generic defaults. Before publishing,
package authors should replace or edit `src/package-templates/kb/**` when the
package needs project-specific skills, prompts, routing rules, terminology, or
package instructions. If the generic behavior is intentionally sufficient,
explicitly accept the unchanged default through the package-template Review
Route. Do not add a package-name Skill by default; add one only when the user
wants project-specific behavior beyond knowledge lookup.

## Context OKF Profiles

Approved Markdown under `knowledge/` is the production source of truth:

- top-level YAML frontmatter uses OKF fields such as `type`, `title`,
  `description`, `tags`, `timestamp`, and `resource`;
- Context production metadata such as `sources`, `node_type`, `visibility`,
  `code_symbols`, relationship records, and `candidate_fingerprint` also lives
  at the top level;
- do not nest Context production metadata under `context`; fields such as
  `context.sources` and `context.code_symbols` are not part of the 0.6 profile;
- section provenance lives in `<!-- context:section ... source_ref="..." -->`
  comments;
- do not add frontmatter `source_refs`; page-level provenance is derived from
  section source refs when needed;
- do not add `context` or `schema` fields.

Package knowledge pages under `dist/<package-name>/` use a consumer projection.
They retain reader-facing fields such as `title`, `type`, `description`, `tags`,
`timestamp`, and custom non-lifecycle fields. Node identity, `resource`,
`sources`, Section evidence comments, and build-only fields are omitted from the
page. `context-build-inventory.json` records the distributed path, approved
knowledge path, node identity, source summary, and package-visible structure.
Maintainers return to the mapped `knowledge/` page for exact `sources` and
`source_ref` attribution. `knowledge/` is never rewritten by this projection.

Accepted section `source_ref` forms:

```text
src-N#symbol:<file>:<symbol-id>:<kind>@<digest>
src-N#span:<heading-hint> L<start>-<end>@<span-hash>
```

The code symbol form includes the source-relative file so same-name symbols in
different files resolve to one exact symbol-index row. Consumers should still
treat the complete `source_ref` as opaque. Production codegraph pages keep
`candidate_fingerprint` at the top level and do not duplicate this evidence in
`code_origin`.

`#span:` refs retain source snapshot line ranges for human review, diffing, and
stable re-pinning. They resolve against committed file/lark document snapshots,
not the code symbol index.

The kb package root may contain agent files such as `AGENTS.md` and `skills/`.
The OKF-compatible surface is the selected `wikis/`, `guides/`, `rules/`, and
`feats/` subtrees.

## Build Behavior

`context build`:

1. Selects approved Markdown from `knowledge/`.
2. Renders all files from `template.path`.
3. Projects selected approved Markdown into consumer-oriented package pages.
4. For `llmsPackage`, appends selected knowledge to `llms.txt` when the template
   does not already use `{{knowledge}}` or `{{approvedKnowledge}}`.
5. Writes deterministic package inventory such as
   `context-build-inventory.json`.
6. Writes output under `dist/<package-name>/`.

`context-build-inventory.json` records what was selected and why. Each selected
file includes `selected_by` entries such as `{ "kind": "collection" }` and a
`production_metadata` object for selected page-level production fields. Child
and relationship records use the inventory's canonical structure projection,
`{ "kind": "okf_root" }`, `{ "kind": "include" }`, or
`{ "kind": "default" }`. The inventory also exposes package-visible typed
edges under `structure.edge_records`; these records are filtered to edges whose
endpoints are present in the selected package. Use those edge records for
relationship citations inside the package instead of assuming the workspace
`knowledge/structure.yaml` file is bundled.

For KB packages, the inventory records `package.distribution` as
`layout: "flat"`, `knowledge_namespace: null`, and the four package-relative
OKF roots. Selected file and group records expose both the logical `okf_root`
and final `okf_root_path`, so consumers do not need to infer paths.

Build expects approved knowledge to be closed when the project has source-bound
document knowledge. When `workflow.current.reason_code` is
`route.close.projection-stale`, run the exact returned close command. Current
close derives
`knowledge/structure.yaml`, persists approved edge projection, and runs the
final verify gate. References, changelog, package index, and section
fingerprint rebuilds are not current close output; build only packages the
current closed state.

Before writing output, `context build` validates that rendered template paths
are safe, unique, and do not collide with copied knowledge paths. For example,
a template file that renders to `wikis/codegraph/foo.md` is rejected if
selected knowledge such as `knowledge/codegraph/foo.md` maps to that same OKF
output path. Rename the template file or use `select.exclude` when the
collision is intentional.

After writing KB output, `context build` checks selected OKF root `index.md`
files and generated child directory indexes. If an index link is broken, fix
the package template, approved knowledge path, or directory index generation,
then rerun `context build`; do not patch `dist/` directly as the durable fix.

If a template describes package coverage, scope, known gaps, or known limits,
it must cite approved knowledge, `context-build-inventory.json`, or
explicitly rendered structure data. Otherwise build reports a
template-boundary diagnostic. Keep factual claims in approved knowledge and
structure; templates only package and route that material.

After build, inspect the output shape. `context build` and `context verify`
validate protocol structure; they do not decide whether the selected knowledge
is meaningful enough for the user.

## Select Patterns

Package selection is evaluated in this order:

1. `collections` filters by internal approved collection, for example
   `architecture`, `sop`, `standards`, or `feats`.
2. `okfRoots` filters by output root after OKF mapping: `wikis`, `guides`,
   `rules`, or `feats`.
3. `include` patterns are matched against approved paths relative to
   `knowledge/`.
4. `exclude` patterns remove matches after the previous filters.

Path patterns are relative to `knowledge/`.

```ts
select: {
  collections: ["architecture", "sop"],
  okfRoots: ["wikis", "guides"],
  include: ["architecture/component-lib/**", "sop/component-lib/**"],
  exclude: ["**/internal/**"],
}
```

If `include` is omitted, all approved knowledge is included unless excluded.
When `collections` or `okfRoots` are present, a file must pass those filters
before include/exclude path matching is considered.
