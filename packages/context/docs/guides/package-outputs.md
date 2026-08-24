# Package Outputs

Package outputs are generated folders under `dist/`. They turn approved
knowledge from `knowledge/` into a shape that another consumer can install,
read, or import.

Package output is a human decision gate. Do not add package declarations until
the user chooses the intended consumer and output shape.

Package build consumes approved and closed knowledge. If status reports that
close is required, run deterministic close before build. Current close derives
`knowledge/structure.yaml`, persists approved edge projection, and runs the
final verify gate without rewriting approved Markdown. References, changelog,
package index, and section fingerprint rebuilds are not current close output.

## Recommended First Output: Agent Knowledge-Base Package

Choose an agent knowledge-base package first when the knowledge should help
Coding Agents work with the project. After the user chooses this semantic
output shape, implement it with `kbPackage()`.

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

Skill names are separate. Ask whether the author wants a short optional Skill
prefix, then maintain the complete final template directory name directly—for
example `skills/android-query/SKILL.md`. Package-root layout never renames a
Skill.

The default `knowledge-query` Skill is a complete generic query entry. It
carries the structure-first query discipline: start from OKF directory indexes, use
`context-build-inventory.json` edge records for package-visible relationships,
inspect page `sources` / `context:section` source_ref metadata, cite
page/section evidence, and report explicit gaps when the package does not cover
a requested fact. It does not treat direct grep over bundled OKF root
directories as the primary discovery path. When indexes do not narrow the
scope, or a candidate page is too large to read directly, its bundled
`scripts/search.mjs` provides deterministic BM25 ranking over mechanically
bounded Markdown chunks. Search results are leads; page bodies and typed edge
records remain the evidence. Its final template-author section
requires package authors to replace or edit the generic routing when the
package needs project-specific terminology, entry points, known limits, or
task workflows. Authors may explicitly accept the generic default when it is
intentionally sufficient.

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
whether selected codegraph pages have current source-backed AST relationship
metadata, how many codegraph views were selected, and how many package-visible
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
| `codegraph` | `wikis/codegraph/` | Structured code entities and relationships. |
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
`node_modules/@c4a/context/docs/reference/template-variables.md`.

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
└── llms.txt
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

## How To Ask The User

When `workflow.current.reason_code` is `route.package.output-required`,
explain the choices with the output tree. Do not ask the user to pick from
unexplained labels.
Use the host's native multi-choice tool when available. If unavailable, fall
back to a short Markdown A/B/C question. The option labels should be:
agent knowledge-base package, LLM text bundle, and skip package output for now.

Recommended question shape:

```text
The reviewed knowledge is approved. The next decision is how to package it.

Recommended: agent knowledge-base package
dist/<name>-kb/
├── AGENTS.md
├── skills/knowledge-query/SKILL.md
└── wikis/
    ├── index.md
    ├── <group-page>.md
    └── <large-group>/index.md

This is best if agents should use the knowledge as a reusable knowledge base.

Alternative: LLM text bundle
dist/<name>-llms/
└── llms.txt

This is best if you need one text bundle for model/RAG import.

We can also skip package output for now and keep only knowledge/.

Which one should I declare first?
```

If the user chooses the Agent knowledge-base package, explain that its OKF
roots are flat within `dist/<package-name>/`; do not ask for a second namespace.
Ask whether its Skills need a short prefix. The author maintains final Skill
names independently from package paths.

Do not offer `both` as a shortcut. If the user wants multiple outputs, add one
package first, verify the shape, then add another package after confirmation.
The default adaptive index policy avoids one-page directory indexes. Configure
`kbPackage().navigation` when a package needs a different inline-entry
threshold or a fully expanded index at every directory.
