---
id: context.sdk.package-outputs
kind: procedure
mediaType: text/markdown
---

# Package Outputs

Package outputs are generated folders under `dist/`. They turn approved
knowledge from `knowledge/` into a shape that another consumer can install,
read, or import.

Package output is a semantic decision: establish the intended consumer and output
shape before declaring it. Reuse the user's existing choice. A current managed
Route may delegate this decision to the Agent; it does not require a repeated
permission question.

Package build consumes approved and closed knowledge. If status reports that
close is required, run deterministic close before build. Current close derives
`knowledge/structure.yaml`, persists approved edge projection, and runs the
final verify gate without rewriting approved Markdown. References, changelog,
package index, and section fingerprint rebuilds are not current close output.

## Default New-Workspace Outputs: Knowledge Base + Website

Output channels support multiple selection. In a new workspace without explicit
preferences, the Agent proposes and configures KB + website as the default. Honor
user feedback, session authority and existing workspace declarations; LLMS is an
additional selectable channel. This is an Agent configuration default, not an SDK
change that silently enables websites for existing packages.

### Static documentation website

To include the default browser-readable site, enable `site` on the same
package. The normal `context build` produces both the Agent KB and a standalone
`dist/<base>-site/` directory containing `index.html`, article HTML,
local search, scripts, styles and the selected bundled resources.

`<base>` is the package name with one trailing `-kb` removed, when present.
For example, `project-kb` produces `dist/project-kb/` and `dist/project-site/`;
`project` produces `dist/project/` and `dist/project-site/`. Output directories
must not collide with another package or website. `site.base` controls URL
prefixes only, not filesystem output paths.

```ts
kbPackage({
  name: "project-kb",
  template: "src/package-templates/kb",
  site: { title: "Project knowledge", lang: "en-US", base: "/" },
});
```

`site` is opt-in; omission keeps the existing KB-only output. Optional fields
are `title` (defaults to the package name), `description`, `lang` (defaults to
`en-US`), and `base` (defaults to `/`; use `/docs/` when hosted under that path).
The website uses a full-width VitePress theme with system fonts, compact navigation,
a wide reading area and a smaller article outline. It starts in
light mode regardless of the operating system; an explicit reader choice is
remembered in browser storage. Search runs locally, without a search service.
Mermaid renders in the browser with a restrained theme; invalid diagrams retain
their source instead of blocking publication. Code samples and raw HTML are
displayed as content, not executed as Vue components or scripts.

The accepted `src/knowledge-map.yaml` controls sidebar organization. Entries
bind to `artifact_ref` and optionally `section_key`; the builder resolves these
against this package's selected approved articles. Navigation labels and parent
groups do not determine website paths. One article may have several navigation
placements while keeping one URL. Pending/excluded targets generate warnings
and no invented link. Every selected article with an artifact identity must have
a valid reading target before packaging, including packages without a website.
Missing bindings or invalid section references block the staged output and
return the missing article list plus a navigation-only task adjustment input.
Category nodes can remain empty while future articles are planned. The builder
does not infer business categories or alter article content.

Top navigation contains the first-level reading directories. Selecting
a section shows only its descendants in the left sidebar; opening an article
directly selects its section. Skills and their Markdown references remain
reachable as linked read-only pages, but have no automatically added navigation
section. A reader-facing usage guide can link them where appropriate.
Section landing pages have stable URLs separate from article URLs.

`dist/<base>-site/context-site-map.json` records each article's approved path, KB path and
site path, plus the projected menu and unresolved targets. URLs are derived from
article identity; legacy pages without `artifact_ref` use their approved path,
so moving those legacy files changes their URL. The shared knowledge map,
KB layout and production Markdown remain unchanged.

Article pages include a small source footer from recorded article source references and the source registry. Repository entries link to the recorded revision and module (or an explicitly referenced file); document entries link to their registered HTTP(S) URL. Unrecorded associations are not inferred from prose. Source-footer changes participate in the website build fingerprint without modifying knowledge Markdown.

The website reuses resource delivery already performed for the KB: bundled
resources are copied into the site's `resources/`; Git raw links remain remote,
and explicit resource omission remains omission. It does not copy source trees
or capture audits. Website generation completes in a sibling staging directory
before either output is published, so a failed website build preserves the
previous KB and website. The website is not included in the KB directory.
Disabling the option removes the old site on the next successful package build.

Preview through an HTTP static server. Deploy the **contents of `dist/<base>-site/`** using
the user's chosen static hosting tool; no hosting SDK, login, deployment or
platform-specific skill is part of Context's build. Keep hosting credentials
out of package templates and published content.

Typical output:

```text
dist/<package-name>/
├── AGENTS.md
├── skills/
│   └── knowledge-query/
│       └── SKILL.md
└── wikis/
    ├── index.md
    └── ...
```

Choose this when the user wants:

- agent-facing guidance generated from the reviewed knowledge;
- a package that can be installed as an agent knowledge base;
- a starting point that can later be refined into task-specific skills.

The underlying `kbPackage()` declaration requires a template containing at
least one `SKILL.md` and `wikis/index.md`.
The default `src/package-templates/kb/` template is only a starting point.
Inspect the generated `dist/<package-name>/` before calling it usable.

KB packages use flat package-relative knowledge roots:

```ts
kbPackage({
  name: "component-lib-kb",
  template: "src/package-templates/kb",
});
```

The package name already identifies the surrounding build folder, so the
output does not repeat it inside each root:

```text
skills/knowledge-query/SKILL.md
wikis/index.md
guides/...
rules/...
feats/...
others/assets/...
```

Do not ask for another distribution namespace. Older workspaces may still
contain `distribution.knowledgeNamespace`; Context accepts that legacy input
without using it to shape the package.

Skill names are separate. If a short prefix is useful, maintain the complete
final template directory name directly—for
example `skills/android-query/SKILL.md`. Package-root layout never renames a
Skill.

The default `knowledge-query` Skill is a complete generic query entry. It
carries the structure-first query discipline: start from OKF directory indexes, use
`context-build-inventory.json` edge records for package-visible relationships,
read candidate pages, cite their visible headings and relevant passages, and
report gaps when the package does not cover a requested fact. Consumer pages
omit `sources` and `context:section` metadata. For exact upstream attribution,
a maintainer needs the original workspace page mapped by the inventory; a
package-only reader must not claim to have read that source. It does not treat direct grep over bundled OKF root
directories as the primary discovery path. When indexes do not narrow the
scope, or a candidate page is too large to read directly, its bundled
`scripts/search.mjs` provides deterministic BM25 ranking over mechanically
bounded Markdown chunks. Search results are leads; page bodies and typed edge
records establish what the package actually says. Package authors edit the source
template when project-specific terminology, entry points or task workflows are
needed. Authoring instructions should be template comments or separate guidance,
not a final section addressed to authors in the delivered query Skill. The
current template-review Route can accept an intentionally sufficient generic
default under its applicable authority.

When approved pages reference materialized resources, Context keeps their
production copies in content-addressed `knowledge/assets/` paths and bundles
selected resources into `others/assets/` by default. Supported images are
adaptively compressed only when needed: every packaged image must be at most 1
MiB and all packaged images together must be at most 40 MiB. The CLI owns the
processor. Optimization changes only `dist/`, content-addresses smaller WebP
output, and leaves `sources/` and `knowledge/assets/` unchanged.

Configure Git raw delivery only when external immutable links are an explicit
project requirement. Context can derive supported Git URLs or use an explicit
HTTPS `urlPrefix`, but it does not publish or probe those resources. Explicit
omission remains available and reports unresolved links. Source audit XML and
capture reports are never distributed as reader assets. See
[Lark Resource Materialization](./lark-resources.md).

The same inventory exposes `structure.relationship_coverage`. It records
whether selected codeindex pages have current source-backed AST relationship
metadata, how many codeindex views were selected, and how many package-visible
edges were emitted. An empty edge list is therefore explicit evidence of a
coverage state, not permission to invent a dependency.

The generated `wikis/` directory is the default OKF root and follows the Context OKF
Profile. Internal production collections are mapped into package OKF roots such
as `wikis/`, `guides/`, `rules/`, or `feats/`; when selected, `context build`
copies them into the package and generates root-aware directory indexes for them
as needed. Selected OKF roots always have an index; smaller child directories
are folded into their nearest generated ancestor index by default. These roots
contain consumer-oriented Markdown with reader-facing frontmatter and no Context
lifecycle comments. Node identity, source metadata, code symbol lists,
relationship records, generated-child records, and candidate fingerprints are
kept out of each page. `context-build-inventory.json` maps distributed paths to
approved knowledge paths and exposes package-visible structure; exact Section
evidence remains in the mapped `knowledge/` page. The package root is an agent
package; the OKF-compatible interchange surface is the selected OKF root
subtrees under `dist/<package-name>/`. The required template entry and final
output path are both `wikis/index.md`.

Current collection mapping:

| Internal collection | Package path | Role |
|---|---|---|
| `codeindex` | `wikis/codeindex/` | Source-backed code indexes with optional structured relationships. |
| `business` | `wikis/business/` | Structured business entities and relationships. |
| `product` | `wikis/product/` | Structured product entities, behavior, and relationships. |
| `architecture` | `guides/architecture/` | Architecture explanations and design narratives. |
| `sop` | `guides/sop/` | Procedures and runbooks. |
| `faq` | `guides/faq/` | Question-oriented explanations and troubleshooting. |
| `decision` | `guides/decision/` | Decision records and trade-off narratives. |
| `incident` | `guides/incident/` | Incident timelines, response, and follow-up. |
| `standards` | `rules/standards/` | Normative standards and constraints. |
| `test` | `rules/test/` | Validation rules, scenarios, and acceptance checks. |
| `feats` | `feats/` | Feature capability records. |

`wikis/` is the structured entity-and-relationship layer. `guides/` and
`rules/` may explain, operationalize, or constrain that knowledge; their
placement does not create a relationship unless Context includes a typed edge.

`index.md` is reserved for OKF bundle and directory indexes. Source documents
may be named `index.md`, but generated concept pages must use a non-reserved
name such as `index-page.md`; `context build` rejects copied knowledge that
occupies `wikis/**/index.md`.

`src/package-templates/kb/wikis/index.md` is the bundle entry page template.
Tell the user it can be edited before build to describe the package scope,
intended users, and query guidance.

The default root index is a usable generic entry, not a project-specific
information architecture.
It links directly to pages in small child directories and to a child
`index.md` when that directory exceeds the configured navigation threshold.
The default threshold is 50 selected knowledge pages. Use Handlebars variables such as
`knowledgeGroups`, `knowledgeItems`, and `knowledgeTree` when a project needs
custom navigation. Before customizing it, read
[Template Variables](../reference/template-variables.md).

Newly initialized generic templates must be replaced, edited, or explicitly
accepted before the first build. `context status` exposes that choice as a
package template Review Gate. Use only the revision-bound command returned by
that Route to accept an unchanged generic default; edit files under
`src/package-templates/` when customizing. Context compares file digests and
records the decision without evaluating the meaning of template prose.

Template paths are rendered before selected knowledge is copied. A rendered
template path must not collide with a selected knowledge path. If the build
reports a collision, rename the template file or exclude that knowledge path
with `select.exclude`.

Template prose must not become a second knowledge source. If a template
describes package coverage, scope, known gaps, or known limits, it must cite
approved knowledge, `context-build-inventory.json`, or rendered structure data
inside the package. Otherwise `context build` reports a template-boundary
diagnostic. Repair the template under `src/package-templates/`; do not patch
`dist/` as the durable fix.

KB package index links are also checked. `context build` validates every
selected OKF root index and generated child `index.md` so relative links and
OKF bundle-root absolute links resolve inside `dist/<package-name>/`. Broken
index links are fixed by editing the template, approved knowledge path, or
package declaration and rerunning `context build`; do not patch `dist/`
directly as the durable fix.

## Alternative Output: LLM Text

Choose an LLM text bundle when the user wants a single text bundle for model
context, RAG import, or manual reading. After the user chooses this semantic
output shape, implement it with `llmsPackage()`.

Typical output:

```text
dist/<package-name>/
├── llms.txt                  # knowledge-map index
├── llms-full.txt             # consolidated approved text
└── llms/pages/<identity>.txt # individual approved articles
```

Choose this when the user wants:

- one consolidated text file;
- a format that is easy to copy, index, or upload elsewhere;
- no agent skill packaging yet.

## Skip Package Output

The user may choose to stop after approved Markdown. In that case, keep
`packages: []` and do not run `context build`.

Approved knowledge still lives in:

```text
knowledge/
└── ...
```

## Agent configuration and delivery recipe

Use this guide when the user asks to generate a documentation website, selects
outputs in the work-start report, or the current Route asks for package output.
Read the current Route and existing `src/index.ts` first. Reuse settled choices;
follow its configuration/read-acknowledgement contract rather than replaying a
previous revision. The Agent edits SDK configuration; the user need not write code.

1. Record all selected channels together. For new workspaces with no explicit
   preference, use KB + website. Preserve existing declarations and explicit
   KB-only, LLMS-only or deferred-delivery choices.
2. Configure the existing KB declaration below, substituting the actual name,
   title and workspace language. Retain its sources, phases, selection and resource
   policy. This is one KB package with an additional website channel, not two KBs.
3. If LLMS is selected, add its declaration and import in the same edit. Ensure
   both template directories exist and resolve generic-template review using the
   current Route. Do not independently ask approval for each already selected channel.
4. Refresh `context status --format json`. Follow the returned continuation for
   knowledge-map adjustment, required review, close, verification and build.
   Missing article bindings require explicit targets from current CLI diagnostics;
   do not classify articles from `wikis/` or `codeindex/` directory names alone.
5. Run `context build` when ready. Verify each selected output and report its
   actual location; a failed selected website is not completed delivery.
6. Preview the generated website directory through a local HTTP server. Verify HTTP succeeds
   before giving its URL. Publishing requires the user's chosen hosting tool and
   authorization; do not install a hosting SDK merely to build the website.

```ts
import { defineProject, kbPackage, llmsPackage } from "@c4a/context";

// Edit only the packages field of the existing defineProject declaration.
// Keep the actual project's other declarations intact.
const packages = [
  kbPackage({
    name: "project-kb",
    template: "src/package-templates/kb",
    site: { title: "Project knowledge", lang: "en-US", base: "/" },
  }),
  // Include this entry only when LLMS text is selected.
  llmsPackage({ name: "project-llms", template: "src/package-templates/llms" }),
];
// Existing defineProject({ ...existing declarations, packages }).
```

The configuration is a small source edit, not custom frontend implementation.
Website output reuses approved articles, knowledge map and packaged assets;
rendering/search generation adds build time and size, not another indexing pass.
Measure actual cost instead of quoting a universal estimate.

| User request | Agent action |
| --- | --- |
| KB + website | One `kbPackage` with `site` enabled |
| KB only / disable website | Omit `site` on that KB and rebuild; old site output is removed |
| Add website later | Add `site` to existing KB, repair missing reading bindings, rebuild |
| Website only for distribution | Explain the KB is still built; share only the sibling website directory |
| Also produce LLMS | Add `llmsPackage` alongside the KB in the same change |
| Keep current knowledge only | Postpone packaging; do not label it completed package delivery |

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist/project-site
```

The completion report lists KB root, website directory and LLMS file separately,
with generated/failed/not-selected status. Include website navigation coverage,
verified preview URL when running, and any remaining errors. The website contains
source cards and article update times; it does not imply an article history browser.

## How To Present The Choice

Include a compact multi-select list in the work-start report, and reuse it later:

- [x] Agent knowledge-base package — default for a new workspace.
- [x] Documentation website — default with the KB, local preview or later hosting.
- [ ] LLMS text — optional model-context or RAG input.

Explicit choices override defaults. When current Route authority requires a user
decision, ask once for the combination rather than a sequence of mutually exclusive
questions. If the host tool supports only single selection, let the user state the
combination in text instead of presenting it as multi-select. There is no `both`
factory, separate website skill, or second permission per selected output.

## Website deployment handoff after every successful build

After every successful website build, including intermediate delivery and an
unchanged output reused by build, tell the user the website can be deployed with
a deployment skill. Include the actual `dist/<base>-site/` directory and whether
it contains only the currently delivered scope. This notice does not wait for the
whole knowledge task to finish and does not block its next Route.

Reuse existing publishing configuration and the user's chosen target. Otherwise,
inspect the available deployment skills, recommend a compatible static-site skill,
or let the user specify one. Do not invent installed skills or a deployed URL.
If no compatible skill is available, report that and provide the site directory
for the user's deployment tool. Do not install a deployment dependency by default.

When publishing is already authorized for that target, follow the selected skill
with the built site directory; otherwise offer deployment and wait for the user's
publishing instruction. Preserve the configured base path; rebuild if the target
requires a different base. Pass only the website output, not sources, private
workspace state or the entire KB package. Report success only after checking the
hosting result and published URL. A failed deployment leaves the local build valid;
report the deployment failure and its next step separately.


### Persistent knowledge map and report proposals

`src/knowledge-map.yaml` is the persistent knowledge map; retain it after delivery.
Its protocol is `context.knowledge-map/v1`; structure and adjustment inputs use
`knowledge_map`, and SDK functions use `KnowledgeMap` naming. It organizes website
navigation and LLMS without changing article identities or section bindings.

The work-start report explains the proposed directory and chapters, followed by
a text wireframe of the website. Material changes are communicated with the updated
report link and a short explanation. This does not build a temporary website or
create a persistent article-plan file. Website packaging uses the accepted knowledge map
and approved articles; the report is not a configuration input.

### Website LLM Docs

Every website build also builds LLMS from the same selected approved articles and
knowledge map. The final top-navigation item is always **LLM Docs**, opening
`llms/index.html`. This page links to `llms.txt`, the structured index,
`llms-full.txt`, the complete approved text, and raw Markdown text articles under
`llms/pages/`. These files ship inside the sibling website directory and use the configured site base.
No separate LLMS package declaration or additional build command is required.
Website LLMS text files include a UTF-8 BOM so browsers can identify the encoding
when a static host omits the charset. Hosting should serve them as
`text/plain; charset=utf-8`. The HTML landing page shows one index/full-text
toolbar followed by the knowledge map; Changelog is available in the site navbar.

The index preserves knowledge-map grouping, order and repeated placements. The
full text includes each selected article only once, in first-placement order.
Only approved selected content is exported. A map or article change invalidates
both website and LLMS outputs; failure preserves the previous staged package.
Standalone `llmsPackage()` uses the same map organization and supplies the full
text and raw article files alongside its template-rendered `llms.txt` index.
