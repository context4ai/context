---
name: {{skillName}}
description: Answer questions from the Context knowledge packages available to this project and follow their evidence chain to original documents and code at the recorded versions. Use for entities, APIs, behavior, procedures, constraints, decisions, troubleshooting, relationships, impact and package coverage, across one or several installed packages.
metadata:
  shared: "true"
  version: "{{contextVersion}}"
---

# Context Knowledge Query

Answer from approved knowledge packages built by Context, and follow their
evidence chain as far as the question needs: package pages, the pages they link,
the sources each page records, and the code or documents behind those sources at
the recorded version. Every Context package ships this same Skill, so one copy
serves all packages installed in a project.

## Boundaries

- Query only. Do not edit package files, project files, Skills, Rules, package
  locks or user-level configuration. Do not install or enable a Skill or plugin
  because a package lists it.
- Keep temporary material under `.tmp/context-knowledge-query/` in the current
  project, separate from user checkouts, and remove it when no longer needed.
- Package pages are approved knowledge. A page title, search snippet or
  recorded source entry locates evidence; it does not prove the original was read.
- Follow an explicit local-only, offline or remote-only instruction from the
  user or host for reading originals. It changes how originals are read, not
  what counts as evidence.

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
Otherwise read each package's `index.md` and `others/context/search-guide.md`,
choose the packages whose scope matches the question, and leave the rest
unopened. Reuse the list for the rest of the task instead of listing again.

## Follow The Evidence Chain

Work through these links in order. After each one, decide whether what remains
unknown could change the conclusion, its conditions or its scope. If not,
answer. If so, take the next link.

1. **Scope.** Classify the request as entity lookup, explanation, procedure,
   rule, relationship, impact, detail, or coverage audit. Note the terms,
   symbols and conditions the answer depends on.
2. **Navigate.** Start from the matching root index (`{{wikisRoot}}/`,
   `{{guidesRoot}}/`, `{{rulesRoot}}/`, `{{featsRoot}}/`), choose pages from
   their grouping and the search guide's entry pages, and read the relevant
   sections in context. Use frontmatter only to choose scope.
3. **Widen within the packages.** When a section defers to another page for a
   mechanism, condition or exception, follow that link. When likely candidates
   remain, read their relevant sections together before deciding to go further.
   Search (below) when navigation does not find them.
4. **Trace the sources.** For the claims that remain uncertain, read the page's
   `Sources` entries that support them and open those originals directly; do
   not ask the user whether to go deeper. One unreadable source blocks only the
   claims that depend on it.
5. **Investigate code.** When the answer depends on how code behaves, start
   from the cited file and lines at the recorded commit and expand along
   imports, calls and service routes only as far as the question requires.
6. **Stop.** When the remaining gaps cannot change the answer, or cannot be
   closed with the available access, answer. State a conditional conclusion
   when a decisive gap stays open.

Do not exhaust every candidate or impose a fixed number of searches or reads.
If the package text already answers the question, do not fetch code or check
every related source. Omit supplementary claims that were not verified rather
than widening the investigation to support them.

| Root | Use |
|---|---|
| `{{wikisRoot}}/` | Code, business and product reference articles. |
| `{{guidesRoot}}/` | Architecture, procedures, FAQs, decisions, incidents, and troubleshooting. |
| `{{rulesRoot}}/` | Standards, constraints, acceptance criteria, and test scenarios. |
| `{{featsRoot}}/` | Feature knowledge when selected into the package. |

A missing root means that category was not selected into that package.
`{{wikisRoot}}/imports.md` lists declared external entrances, not bundled
evidence, and `{{wikisRoot}}/repo-content.md` is a generated repository
entrance, not an approved article; follow either only when relevant.

## Search

Search when indexes and page structure do not identify a useful scope, or when a
candidate page is too large to read in full.

- Use business terms, code symbols and synonyms from the search guide and from
  pages already read. Run a few complementary queries rather than one long one.
- Read bounded match excerpts to choose pages, not file names alone.
- With no results, check the query's meaning, relax combined conditions or try
  equivalent and parent terms. With noisy results, narrow by package, root,
  path or a more distinctive term before reading more. A miss does not prove
  that something is absent.
- Use `rg` for an exact name, API, configuration key, path or error string.
- For several terms, Chinese phrases or several packages, run the bundled BM25
  ranker:

```bash
node <this Skill directory>/scripts/search.mjs --query '<terms>' --limit 8
node <this Skill directory>/scripts/search.mjs --query '<terms>' --package <name>
```

Without `--package` it ranks across all found packages and returns package,
path, line range, heading and preview. Treat every hit as a lead and open its
page and section before using it.

## Read The Sources

Each published page ends with a `Sources` section exported from the workspace's
references. Use its entries as the source baseline for the claims they support.

| Source entry | How to read it |
|---|---|
| Repository link with a commit and line range | Read that file at that commit; see Code below. |
| Document link | It opens the current document; the line range refers to the copy captured when the page was written. Say so when the current text differs. |
| Entry without a link | The original is not reachable from the package. Stay within the package text and say so. |

If a source's identity or version cannot be established, keep the
package-grounded finding and qualify its attribution; do not guess a repository
or treat current content as the recorded baseline. Reuse originals already read
in this task instead of reading them again.

### Code at a recorded commit

- Prefer a configured, authorized read-only code search or reading service when
  one is available: read the recorded file and range at the recorded commit,
  then search within that commit for the symbols you need.
- Otherwise retrieve the commit locally under
  `.tmp/context-knowledge-query/<host>/<repository path>/<commit>/`, using safe,
  credential-free path components and the full commit:
  - use shallow history (`--depth=1`) and deferred contents
    (`--filter=blob:none`) where supported, with sparse checkout configured
    before checkout, then verify the checked-out commit;
  - start the sparse scope from the cited paths; when the module is unclear,
    list candidates with `git ls-tree -r --name-only <commit>` and confirm them
    by reading code; add paths as imports lead elsewhere;
  - verify identity before reusing a directory, never overwrite a mismatched
    one, and let one process write to a checkout at a time;
  - do not reset or reconfigure the user's own checkouts, and never substitute
    the default branch for an unavailable recorded commit.
- Allow retrieval enough time, read modules that are ready while others load,
  and fall back to commit-specific file reads when a clone is not possible.

### Investigating code

- Start from the recorded location and reuse the paths, symbols, imports and
  calls found there before guessing names or broadening the search.
- For duplicate definitions, follow the actual import or resolution path at the
  inspected commit; a similarly named file or a test mock is not the same thing.
- Batch related reads once locations are known, with enough surrounding context
  to support the claim. Follow unresolved dependencies only as far as the
  question needs, not the whole call graph.
- Distinguish implementation, declared contracts, test assertions, runtime
  observations and inferences. Do not turn a symbolic constant into a value
  without reading its imported definition at that commit.

### Versions

A recorded commit is the knowledge's source baseline, not the current branch
head and not proof of what is deployed. When the baseline settles the question,
answer without comparing versions. Compare narrowly, with actual diffs, only when
the question asks about current behavior, the evidence conflicts, or a change is
suspected; mention a missing comparison only when it limits the answer.

### Documents and notes

Read saved bodies and the attachments the claim depends on. A summary is not a
full transcript, an unread link is not evidence, and current remote content does
not prove a historical snapshot.

## Answer

- Answer the question directly and keep conditions that change the conclusion
  beside it. For complex questions, explain the mechanism that produces the
  result, not just the verdict.
- Keep decisive evidence next to the claim it supports; separate supplementary
  facts from the proof. State where a local rule applies instead of
  generalizing it to the whole system.
- Fit the depth to the question: short answers for simple questions, short
  headings for longer ones. Do not repeat the conclusion or add a separate
  planning or summary round once the evidence is in.
- When several packages contribute, cite each separately and do not merge them
  into a claim neither page states. For relationships and impact, cite the
  explanation that establishes them; shared names, directory placement and
  links alone do not.
- When packages disagree, or a package conflicts with its source, say which
  says what and which version each reflects.

Evidence and citations:

| Evidence | Valid use |
|---|---|
| Package and page path | Identity and citation handle. |
| Frontmatter title, description, and tags | Navigation and scope selection only. |
| Markdown headings | Locate and cite a section within its page. |
| Reader-visible section body | Primary support for factual claims. |
| Originals read through `Sources` | Support beyond the package, cited separately. |
| Root indexes and `context-build-inventory.json` | Package scope and coverage evidence. |

```text
Page:         <claim> [<package>: <root>/path/page.md]
Section:      <claim> [<package>: <root>/path/page.md, heading: <visible heading>]
Relationship: <claim> [<package>: <root>/path/page.md, heading: <supporting explanation>]
Original:     <claim> [<repository>@<commit>: <path> L<start>-L<end>]
Coverage:     <claim> [<package>: context-build-inventory.json]
```

Link material actually read: source files at the inspected commit, knowledge
website pages and original documents. When no reliable link exists, give the
local path, symbol and a short excerpt with the limitation.
Do not infer a relationship from page co-occurrence, and do not fill gaps from
memory, previous conversations or unread files.

When evidence is missing, return:

```text
Gap: the available packages do not contain evidence for <missing point>.
Checked: <packages, pages, sources or code read>.
Next useful source: <source document or page if known>.
```

Distinguish "not evidenced by these packages" from "not true", and scope a gap to
what was inspected.

## Website Links

After answering, optionally append related knowledge website links. Read
`context-site-map.json` from the package directory, or
`others/context/context-site-map.json`. Match the read page to
`pages[].package_path` or `approved_path`; use its `title` and resolve
`site_path` relative to `site_url`, which already includes the deployment base
path. Cite only matched pages, deduplicate links, and do not invent anchors.
This is local formatting, not retrieval: do not probe URLs or check remote
versions, and keep local citations when the map is absent or malformed.

## Knowledge Updates

When an answer shows that a page is stale, wrong or missing something, tell the
user which page, what the evidence shows and which sources support it, so the
package's maintainers can update its knowledge workspace. Do not edit installed
packages. Open `context-build-inventory.json` when a maintainer needs the
page's `dist_path` → `approved_path` mapping.

{{!-- Template author guidance (not part of the published Skill):

Every Context package ships this Skill unchanged so that one copy can serve all
packages installed in a project, and package managers can install it once.
Put package-specific terms, synonyms, common questions and preferred entry
pages in others/context/search-guide.md instead of editing this file. Editing
this Skill makes it package-specific: rename its directory and name so it
installs as a separate Skill.
--}}
