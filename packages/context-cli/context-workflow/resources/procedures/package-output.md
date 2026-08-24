---
id: procedure.package-output
kind: procedure
mediaType: text/markdown
---

# Package output

Package selection decides how approved knowledge is presented to downstream
agents or text consumers. Explain the available Context package kinds and their
directory shape before asking the user to choose.

After confirmation, declare the package in `src/index.ts` using the SDK schema
resource. The current Route's `configuration.contract` lists the supported
output choices, required fields, mechanical defaults, and follow-up status
command; do not infer another factory or hidden default. Templates may customize presentation, but they must not overwrite
approved knowledge paths or remove required indexes.

Generated generic templates carry a mechanical digest marker. Before the first
build, replace or edit the declared template source, or explicitly accept the
unchanged generic default through the current Route. Editing the template
changes its digest and resolves the review without a separate command.
Acceptance records only that decision; Context does not judge template prose
or infer audience, scope, or navigation semantics.

An Agent knowledge-base package writes flat package-relative roots such as
`wikis/`, `guides/`, `rules/`, and `feats/`. The package name already provides
the surrounding `dist/<package-name>/` boundary. Do not ask the user for a
distribution namespace or add `distribution.knowledgeNamespace` to a new
declaration.

Ask whether the author wants a short optional Skill prefix. If so,
maintain the complete final Skill directory name in the template, such as
`skills/android-query/`. Package-root layout never renames Skills.

Package output is incremental: a built package is current only for the approved
knowledge and template digests recorded by its receipt.

KB packages bundle referenced resources by default. Images are copied to
`others/assets/`; when necessary, Context compresses supported images so each
output image is at most 1 MiB and their combined package size is at most 40
MiB. This changes only `dist/`, never captured or approved source resources.

Configure `assets.delivery="git-raw"` only when the author explicitly wants
external links and accepts responsibility for publishing and access. Use a
confirmed immutable HTTPS prefix where possible; do not infer or probe an
unknown host convention. Explicit omission keeps unresolved links and must be
described as such.
