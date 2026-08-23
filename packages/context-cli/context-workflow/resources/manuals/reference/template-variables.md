---
id: context.sdk.template-variables
kind: procedure
mediaType: text/markdown
---

# Template Variables

Context package templates are rendered with Handlebars during `context build`.

This reference covers the template variables available to files under
`src/package-templates/**`. Templates can render values, loop over arrays,
branch with conditionals, and use template-only comments. They cannot run
JavaScript.

## Syntax

### Value

```md
Package: {{packageName}}
Approved pages: {{knowledgeCount}}
```

Values support dotted paths:

```md
{{context.package}}
```

### Loop

```md
{{#each knowledgeItems}}
- [{{title}}]({{href}}) - {{type}}
{{/each}}
```

Nested loops are supported:

```md
{{#each knowledgeGroups}}
## {{title}}

{{#each items}}
- [{{title}}]({{href}})
{{/each}}
{{/each}}
```

Inside a loop, `{{@index}}` is zero-based. Use the built-in `inc` helper when
you need a one-based number:

```md
{{#each knowledgeItems}}
{{inc @index}}. [{{title}}]({{href}})
{{/each}}
```

### Conditional

```md
{{#if description}}
Description: {{description}}
{{/if}}
```

The block renders when the value exists, is not `false`, and is not an empty
string or empty array.

### Template-only Comments

Use Handlebars comments, or HTML comments that start with `context:template`,
for guidance that should not appear in the generated package:

```md
{{! This comment is removed by Handlebars. }}

<!-- context:template
Explain why this section exists and where to edit it.
Read node_modules/@c4a/context/docs/reference/template-variables.md.
-->
```

`context build` strips these comments from rendered output.

## Helpers

| Helper | Example | Meaning |
|---|---|---|
| `inc` | `{{inc @index}}` | Adds 1 to a numeric value. Useful for numbered lists. |
| `json` | `{{json knowledgeGroups}}` | Renders a value as formatted JSON for debugging or machine-readable docs. |

## Built-in Variables

| Variable | Type | Meaning |
|---|---|---|
| `packageName` | string | Package name from `kbPackage()` / `llmsPackage()`. |
| `packageKind` | string | `kb` or `llms`. |
| `knowledgeNamespace` | string | Legacy configured namespace when an older workspace still declares one; otherwise empty. It does not change output paths. |
| `namespacedKnowledge` | boolean | Always `false`; retained so older templates remain renderable. |
| `skillsRoot` | string | Skills root, currently `skills`. |
| `wikisRoot` | string | Final wikis root: `wikis`. |
| `guidesRoot` | string | Final guides root: `guides`. |
| `rulesRoot` | string | Final rules root: `rules`. |
| `featsRoot` | string | Final feats root: `feats`. |
| `skillName` | string | Author-maintained name of the Skill currently being rendered. Empty outside a `skills/<name>/...` template. |
| `skillPath` | string | Final package-relative `SKILL.md` path for the Skill currently being rendered. Empty outside a Skill template. |
| `knowledgeCount` | number | Selected approved Markdown file count. |
| `knowledgeTimestamp` | string | Latest selected approved Markdown `timestamp`, or epoch when empty. |
| `knowledge` | string | Concatenated selected approved Markdown bundle. Use carefully; it can be large. |
| `approvedKnowledge` | string | Alias for `knowledge`. |
| `knowledgeItems` | array | One record per selected approved Markdown page. |
| `knowledgeGroups` | array | Selected pages grouped by OKF root and the first directory segment under that root; each item also exposes `internal_collection`. |
| `knowledgeTreeNodes` | array | Nested path tree for selected pages. Useful for custom navigation. |
| `knowledgeTree` | string | Markdown tree preview of selected pages. |
| `knowledgeItemsMarkdown` | string | Markdown list of up to 50 selected pages. |
| `knowledgeGroupsMarkdown` | string | Markdown navigation for the current index. Folded directories render direct page links; expanded directories render links to generated indexes. |
| `buildInventory` | object | Deterministic package build inventory, including selected files, selected-by reasons, collection summaries, and package-visible edge records. |
| `buildInventoryJson` | string | Pretty JSON form of `buildInventory`. |
| `buildInventoryPath` | string | Package-relative inventory path, currently `context-build-inventory.json`. |
| `knowledgeStructure` | object or null | Selected-package projection derived from workspace `knowledge/structure.yaml` at build time. It contains only selected views, their nodes, and package-visible edges. Templates may inspect it, but the default package consumer should rely on `context-build-inventory.json`. |
| `knowledgeStructureJson` | string | Pretty JSON form of `knowledgeStructure`, or `null`. |
| `knowledgeStructurePath` | string | Workspace source structure path, currently `knowledge/structure.yaml`; the variable itself is not copied into the package unless a template renders selected structure data. |

Custom variables from `template.vars` are also available.

`buildInventory.structure.edge_records` contains typed edge records whose
endpoints are visible in the selected package. Use those records when a
template or generated skill needs package-local relationship evidence. The
workspace `knowledge/structure.yaml` is not automatically copied into the
package unless a project-specific template explicitly renders it.

## `knowledgeItems`

Each item contains:

| Field | Meaning |
|---|---|
| `path` | Package-relative OKF path, for example `wikis/component-lib/symbol/button.md`. |
| `sourcePath` | Approved knowledge path before OKF output mapping, for example `architecture/entity/button.md`. |
| `approved_path` | Alias for `sourcePath`. |
| `dist_path` | Alias for `path`. |
| `internalCollection` | Internal approved collection, for example `architecture`. |
| `internal_collection` | Alias for `internalCollection`. |
| `collection` | Internal approved collection; alias for `internalCollection`. |
| `okf_root` | OKF output root, for example `wikis`, `guides`, `rules`, or `feats`. |
| `okf_root_path` | Final flat package-relative OKF root. |
| `node_ref` | Stable NodeRef from approved frontmatter, for example `entity/button`. |
| `view_ref` | Stable ViewRef from approved frontmatter, for example `architecture:entity/button`. |
| `pathWithinCollection` | Path below the OKF root, for example `component-lib/symbol/button.md`. |
| `href` | Link relative to the template file currently being rendered. Use this in custom templates. |
| `hrefFromTemplate` | Alias for `href`. |
| `hrefFromPackageRoot` | Link from a package-root file such as `AGENTS.md`, for example `./wikis/component-lib/symbol/button.md`. |
| `hrefFromCollectionIndex` | Link from the current OKF root index, for example `./component-lib/symbol/button.md` for a `wikis` item. |
| `title` | Page title from frontmatter, or a title derived from the file name. |
| `type` | OKF `type` from frontmatter. |
| `description` | OKF `description` from frontmatter, when present. |
| `timestamp` | OKF `timestamp` from frontmatter, when present. |
| `source` | First top-level `sources` entry without the `repo:` prefix, or the group name. |
| `group` | First path segment under the OKF root. |
| `parentPath` | Parent path below the OKF root. |
| `depth` | Segment count below the OKF root. |
| `segments` | Path segments below the OKF root. |
| `tags` | Comma-separated tags from frontmatter. |

Example:

```md
{{#each knowledgeItems}}
- [{{title}}]({{href}}) — {{type}}{{#if description}}: {{description}}{{/if}}
{{/each}}
```

## `knowledgeGroups`

Each group contains:

| Field | Meaning |
|---|---|
| `name` | First directory segment under the OKF root, or `root` for pages directly under the OKF root. |
| `collection` | Internal approved collection for this group. |
| `internalCollection` | Internal approved collection; alias for `collection`. |
| `internal_collection` | Alias for `internalCollection`. |
| `okf_root` | OKF output root for this group, for example `wikis`, `guides`, `rules`, or `feats`. |
| `okf_root_path` | Final flat package-relative OKF root. |
| `title` | Display title; defaults to `name`, or the OKF root title for a root group. |
| `count` | Number of selected pages in this group. |
| `hasIndex` | Whether the active package navigation policy generates `indexPath`. |
| `has_index` | Alias for `hasIndex`. |
| `indexPath` | OKF-root-aware index path, for example `wikis/component-lib/index.md`, `guides/component-lib/index.md`, or `rules/index.md` for a root group. |
| `indexHrefFromTemplate` | Link from the template file currently being rendered to `indexPath`. Check `hasIndex` before rendering it. |
| `indexHrefFromCollectionIndex` | Link from the OKF root index to `indexPath`. |
| `items` | `knowledgeItems` in the group. |

Example:

```md
{{#each knowledgeGroups}}
## {{title}} ({{count}})

{{#if hasIndex}}
[Open directory index]({{indexHrefFromTemplate}})
{{/if}}
{{#each items}}
- [{{title}}]({{href}}) - {{type}}
{{/each}}
{{/each}}
```

## `knowledgeTreeNodes`

`knowledgeTreeNodes` is a nested representation of selected pages. Each node
contains:

| Field | Meaning |
|---|---|
| `name` | Path segment name. |
| `title` | Display title derived from `name`. |
| `path` | Path below the OKF root. |
| `depth` | Depth below the OKF root. |
| `count` | Number of pages under this node. |
| `items` | Pages directly under this node. |
| `children` | Child nodes. |

Use it when a package needs navigation by source, module, category, or symbol
folder. Handlebars does not include recursive partials by default, so keep
starter templates shallow or add project-specific sections for the levels you
care about.

## Starter `wikis/index.md`

The default KB template uses the variables above to generate a starter index:

- bundle count and timestamp in OKF frontmatter;
- direct page links for directories folded by the active navigation policy;
- links to generated directory indexes when a directory exceeds the configured
  inline-entry threshold.

`context build` always provides selected OKF root indexes. By default,
directory indexes are planned bottom-up, and a non-root directory gets its own
index only when it would expose more than 50 page or retained child-index
entries to its parent. Configure this with
`kbPackage({ navigation: { foldDirectoryIndexes, maxInlineEntries } })`.

The output is only a starter. Edit the files under
`src/package-templates/kb/` when the package needs different reading paths or
navigation before `context build`. An unchanged generated starter must instead
be explicitly accepted through the current package-template Review Route.
