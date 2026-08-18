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

When declaring a new KB package, make resource delivery an explicit author
choice. Offer Git raw when the workspace is in Git or the author supplies a
raw `urlPrefix`; it keeps package payloads small and uses either the derived
commit-pinned URL or that explicit prefix. Context does not check whether those
files are committed, pushed, or remotely readable; that remains the package
author's responsibility. If neither Git nor an explicit prefix is available,
offer bundled resources or explicit omission; omission keeps unresolved links
and must be described as such. Do not infer repository identity or invent a raw
host URL.

Large image optimization applies only to bundled delivery. Without an `assets`
declaration, existing workspaces continue to copy selected resources
byte-for-byte. If build or status reports
`package.assets.optimization-recommended`, explain that the current package is
valid but contains more than 20 MiB of eligible PNG/JPEG resources. Do not
install a dependency or edit project configuration automatically. If the user
chooses to optimize the package, use the exact reported setup command and add
the reported `kbPackage().assets.optimize` value. The processor is installed in the
Context workspace, not bundled into Context itself. Optimization changes only
`dist/`; source snapshots and approved resources remain unchanged.
