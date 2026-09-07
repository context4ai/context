---
name: {{skillName}}
description: Query the approved, source-linked knowledge bundled with {{displayName}}. Use for questions about included entities, APIs, behavior, procedures, constraints, decisions, troubleshooting, relationships, and package coverage.
---

# Knowledge Query

Answer from the approved knowledge bundled with this package. Navigate through
its indexes before opening individual pages, and treat the visible section body
as evidence rather than relying on memory or frontmatter summaries.

## Query Procedure

1. Classify the request as entity lookup, explanation, procedure, rule,
   relationship, detail, or coverage audit.
2. Open the most relevant root index, such as `{{wikisRoot}}/index.md`, then
   follow its links to a likely page.
3. Read only the sections needed for the question. Use frontmatter to select
   scope, not to support factual claims.
4. For relationship or impact questions, inspect
   `context-build-inventory.json` `structure.edge_records` before reading the
   endpoint pages.
5. Answer only from reader-visible section content and source-backed edge
   records. Cite the supporting page or section.
6. If the package lacks evidence, report the gap and what was checked instead
   of inferring from nearby content.

## Package Roots

| Root | Use |
|---|---|
| `{{wikisRoot}}/` | Structured entities and relationships from codeindex, business, and product knowledge. |
| `{{guidesRoot}}/` | Architecture, procedures, FAQs, decisions, incidents, and troubleshooting. |
| `{{rulesRoot}}/` | Standards, constraints, acceptance criteria, and test scenarios. |
| `{{featsRoot}}/` | Feature knowledge when selected into the package. |

Start from the root that matches the request. A missing root means that category
was not selected into this package.

## Route By Intent

| Intent | First move |
|---|---|
| Vague topic or unknown name | Open the likely root index and choose a page from its grouping. |
| Named entity, API, domain, or action | Open the matching page or nearest group index. Show candidates if names are ambiguous. |
| Architecture, procedure, FAQ, decision, or incident | Start from `{{guidesRoot}}/index.md`. |
| Standard, constraint, acceptance, or test question | Start from `{{rulesRoot}}/index.md`. |
| Relationship or impact | Inspect typed edges, then read both endpoint pages. |
| Detail inside a known page | Read the relevant Markdown heading and its body. |
| Coverage, gap, or inventory | Inspect the root indexes and `context-build-inventory.json`. |

## Evidence Contract

Use each opened page or package artifact as an evidence card:

| Evidence | Valid use |
|---|---|
| Page path | Page identity and citation handle. |
| Frontmatter title, description, and tags | Navigation and scope selection only. |
| Markdown headings | Locate and cite a section within its page. |
| Reader-visible section body | Primary support for factual claims. |
| `context-build-inventory.json` edge records | Typed relationship evidence. |
| Root indexes and build inventory | Package scope and coverage evidence. |

Do not infer a relationship from page co-occurrence. Published pages do not need
production identifiers or source bookkeeping to be usable. Cite their readable
paths and headings; do not search for missing technical metadata or ask users
to supply it. Open the build inventory only for relationship or coverage questions,
or when a maintainer needs to locate the original approved page via
`dist_path` → `approved_path`. Original source attribution belongs to that
workspace's `knowledge/`, not to the published page. If the original material is
not bundled, answer only from the visible approved content and state its limits.

## Search Fallback

Search only when indexes and page structure do not identify a useful scope, or
when a candidate page is too large to read in full. Use `rg` for an exact name,
API, configuration key, path, or error string. For multiple terms, Chinese
phrases, or several large indexes, run the bundled
[`scripts/search.mjs`](scripts/search.mjs) BM25 ranker:

```bash
node <current knowledge-query Skill directory>/scripts/search.mjs --query '<terms>' --limit 8
```

The script locates `{{packageName}}` when it runs inside the package tree. If a
package manager copied this Skill elsewhere, add `--root <package directory
containing context-build-inventory.json>`, or use `--base <package collection>`
to locate this package by its inventory name. It chunks Markdown mechanically
by headings and bounded line ranges, then returns paths, line ranges, headings,
and previews; it does not interpret meaning.

Treat every hit as a lead and open its page and section before answering. For
relationship or impact claims, use typed edges from
`context-build-inventory.json`; BM25 scores and text co-occurrence are not
relationship evidence.

## Citations And Gaps

Use compact citations tied to claims:

```text
Page:         <claim> [<root>/path/page.md]
Section:      <claim> [<root>/path/page.md, heading: <visible heading>]
Relationship: <claim> [context-build-inventory.json#structure.edge_records edge:<type>]
Coverage:     <claim> [context-build-inventory.json]
```

When evidence is missing, return:

```text
Gap: this package does not contain evidence for <missing point>.
Checked: <indexes, pages, or artifacts>.
Next useful source: <source document or page if known>.
```

Distinguish “not evidenced by this package” from “not true.” Do not fill gaps
from memory, previous conversations, or source files outside the package.

## Package Boundary

- The bundled OKF-compatible roots are the source of truth for this Skill.
- The package contains approved knowledge selected by its Context workspace; it
  does not claim complete coverage of the underlying product or codebase.
- Do not scan every page or edge when a narrower indexed scope answers the
  request.

Approved knowledge files: `{{knowledgeCount}}`

{{!-- Template author guidance (not part of the published query Skill):

This is a complete generic query Skill, but package authors should replace or
edit it before publishing when the package has project-specific terminology,
common user intents, preferred entry pages, known limits, or task workflows.
Update the description, routing table, and package-boundary guidance to match
the actual package. If the generic behavior is intentionally sufficient,
explicitly accept the unchanged default during Context package-template review.
--}}
