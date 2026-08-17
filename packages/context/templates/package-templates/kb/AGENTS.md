# {{displayName}}

This package was generated from a Context knowledge workspace.

Package: `{{packageName}}`
Kind: `{{packageKind}}`
Approved knowledge files: `{{knowledgeCount}}`

## How To Use

Use the Markdown files in this package as source-linked product and code
knowledge. Prefer cited facts from the included knowledge pages over memory.

The bundled knowledge-query Skill teaches agents how to navigate OKF indexes
and cite copied OKF root directories, starting with `{{wikisRoot}}/`.

Selected OKF root directories such as `{{wikisRoot}}/`, `{{guidesRoot}}/`,
`{{rulesRoot}}/`, and `{{featsRoot}}/` follow an OKF-compatible Context profile:
OKF fields and Context extension fields stay at the top level, and no `context`
or `schema` field is emitted. Root mapping:
`{{wikisRoot}}/` maps from structured `codegraph`, `business`, and `product` knowledge;
`{{guidesRoot}}/` maps from `architecture`, `sop`, `faq`, `decision`, and `incident`;
`{{rulesRoot}}/` maps from `standards` and `test`; `{{featsRoot}}/` maps from `feats`. Treat
`{{wikisRoot}}/` as the entity-and-relationship layer; guides and rules may
explain or constrain that layer. Other selected OKF root indexes are generated
unless the template supplies them.

## Included Knowledge

The approved Markdown files are copied into this package during `context build`.
