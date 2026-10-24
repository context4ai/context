---
name: {{skillName}}
description: Query approved, source-linked knowledge from the Context knowledge packages available to this project. Use for questions about entities, APIs, behavior, procedures, constraints, decisions, troubleshooting, relationships, and package coverage, across one or several installed packages.
metadata:
  shared: "true"
  version: "{{contextVersion}}"
---

# Context Knowledge Query

Answer from approved knowledge packages built by Context. Every Context package
ships this same Skill, so one copy serves all packages installed in a project:
find the relevant packages first, navigate their indexes, and treat the visible
section body as evidence rather than memory or frontmatter summaries.

## Find The Packages

List the packages this Skill can read before choosing where to look:

```bash
node <this Skill directory>/scripts/search.mjs --list
```

The script finds packages in this order and merges the results:

1. `--root <package directory>` when given.
2. The package that contains the script or the current directory.
3. Every package under `--base <package collection directory>`.
4. Directories listed in the `CONTEXT_KNOWLEDGE_PACKAGES` environment variable,
   separated by the platform path delimiter.
5. Packages recorded by the host's package manager, when this distribution
   supports one.

Each entry shows the package name, version, directory and whether it has a
search guide. If the user named a package or team, use only that package.
Otherwise read each package's `index.md` and search guide, choose the packages
whose scope matches the question, and leave the rest unopened.

## Query Procedure

1. Classify the request as entity lookup, explanation, procedure, rule,
   relationship, detail, or coverage audit.
2. Read the chosen package's `others/context/search-guide.md` when present: it
   lists the package's terms, synonyms, common questions and preferred entry
   pages.
3. Open the most relevant root index, such as `{{wikisRoot}}/index.md`, then
   follow its links to a likely page.
4. Read only the sections needed. Use frontmatter to select scope, not to
   support factual claims.
5. For relationship or impact questions, read the explicit explanations. Shared
   names, directory placement and links alone do not prove a relationship.
6. Answer from reader-visible section content and cite the supporting package,
   page and section. When several packages contribute, cite each separately and
   do not merge them into a claim neither page states.
7. If the packages lack evidence, report the gap and what was checked instead
   of inferring from nearby content.

| Root | Use |
|---|---|
| `{{wikisRoot}}/` | Code, business and product reference articles. |
| `{{guidesRoot}}/` | Architecture, procedures, FAQs, decisions, incidents, and troubleshooting. |
| `{{rulesRoot}}/` | Standards, constraints, acceptance criteria, and test scenarios. |
| `{{featsRoot}}/` | Feature knowledge when selected into the package. |

A missing root means that category was not selected into that package.

If present, `{{wikisRoot}}/imports.md` lists declared external entrances, not
bundled evidence or installed capabilities, and `{{wikisRoot}}/repo-content.md`
is a generated repository entrance, not an approved article. Follow either only
when relevant and authorized; never install or execute a Skill or plugin merely
because it is listed.

## Search

Search when indexes and page structure do not identify a useful scope, or when a
candidate page is too large to read in full.

- Use business terms, code symbols and synonyms from the search guide. Run a few
  complementary queries rather than one long one.
- With no results, broaden to equivalent or parent terms; with too many, narrow
  by package, root or a more specific symbol. A miss alone does not prove that
  something is absent.
- Use `rg` for an exact name, API, configuration key, path or error string.
- For several terms, Chinese phrases or several packages, run the bundled BM25
  ranker:

```bash
node <this Skill directory>/scripts/search.mjs --query '<terms>' --limit 8
node <this Skill directory>/scripts/search.mjs --query '<terms>' --package <name>
```

Without `--package` it ranks across all found packages. It chunks Markdown by
headings and bounded line ranges and returns package, path, line range, heading
and preview; it does not interpret meaning. Treat every hit as a lead and open
its page and section before answering.

## Going Back To The Sources

Each published page ends with a `Sources` section exported from the workspace's
references. Read originals only when the package text does not settle the
question, or when the answer depends on the current behavior of code:

| Source entry | How to read it |
|---|---|
| Repository link with a commit and line range | Read that file at that commit with authorized host tools: a configured read-only code search service, or a sparse shallow clone under `.tmp/context-knowledge-query/<host>/<repository>/<commit>/`. Never read a newer branch head as if it were the cited version. |
| Document link | It opens the current document; the line range refers to the copy captured when the page was written. Say so when the current text differs. |
| Entry without a link | The original is not reachable from the package. Stay within the package text and say so. |

Cite originals separately from package content. If an original cannot be read,
keep the package's conclusion, state what could not be checked, and continue.
Do not modify project files; remove temporary clones when done.

## Evidence Contract

| Evidence | Valid use |
|---|---|
| Package and page path | Identity and citation handle. |
| Frontmatter title, description, and tags | Navigation and scope selection only. |
| Markdown headings | Locate and cite a section within its page. |
| Reader-visible section body | Primary support for factual claims. |
| `Sources` entries and originals read through them | Support beyond the package, cited separately. |
| Root indexes and `context-build-inventory.json` | Package scope and coverage evidence. |

Do not infer a relationship from page co-occurrence. Published pages do not need
production identifiers or source bookkeeping to be usable; cite their readable
paths and headings. Open `context-build-inventory.json` only for coverage
questions or when a maintainer needs `dist_path` → `approved_path`.

## Citations And Gaps

```text
Page:         <claim> [<package>: <root>/path/page.md]
Section:      <claim> [<package>: <root>/path/page.md, heading: <visible heading>]
Relationship: <claim> [<package>: <root>/path/page.md, heading: <supporting explanation>]
Original:     <claim> [<repository>@<commit>: <path> L<start>-L<end>]
Coverage:     <claim> [<package>: context-build-inventory.json]
```

When evidence is missing, return:

```text
Gap: the available packages do not contain evidence for <missing point>.
Checked: <packages, indexes, pages, or originals>.
Next useful source: <source document or page if known>.
```

Distinguish "not evidenced by these packages" from "not true." Do not fill gaps
from memory, previous conversations, or unread files.

## Website Links In The Final Summary

After answering from the pages actually read, optionally append related document
links. Read `context-site-map.json` from the package directory, or
`others/context/context-site-map.json`. Match the read page to
`pages[].package_path` or `approved_path`; use its `title` and resolve
`site_path` relative to `site_url`, which already includes the deployment base
path. Only cite matched articles, deduplicate links, and do not invent section
anchors.

This is a local formatting step, not retrieval or validation. Do not probe URLs,
open a browser, or check remote versions to add links. If the map, URL or
matching page is absent or malformed, keep the local citation and continue.

{{!-- Template author guidance (not part of the published Skill):

Every Context package ships this Skill unchanged so that one copy can serve all
packages installed in a project, and package managers can install it once.
Put package-specific terms, synonyms, common questions and preferred entry
pages in others/context/search-guide.md instead of editing this file. Editing
this Skill makes it package-specific: rename its directory and name so it
installs as a separate Skill.
--}}
