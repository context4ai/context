---
id: context.sdk.imports
kind: procedure
mediaType: text/markdown
---

# External associations

Workspace-root `imports.yaml` declares external entrances without downloading,
installing or capturing their contents. Maintain it through the Context entry when
the task requests a lasting association. Temporary query reads do not register
dependencies. Same-repository authored documents and Skills use
[repo-content](repo-content.md) instead.

```yaml
protocol: context.imports/v1
imports:
  engineering-guide:
    kind: knowledge
    url: https://docs.example.org/engineering/
    description: Engineering conventions
  release-check:
    kind: skill
    url: https://github.com/example/skills/tree/v1/skills/release-check
    path: skills/release-check
    version: v1
```

The stable ID and `url` are required. `kind`, `format`, `title`, `description`,
`path` and `version` are optional. Kind and format are open strings; versions are
opaque hints, not necessarily SemVer. Paths are source-relative without traversal.
Reader URLs must be HTTP(S), without credentials or whitespace; this is local
syntax validation, not a provider whitelist or availability check. Do not put
access tokens in query strings. The SDK exports `importsRegistrySchema` for local
validation. Unknown providers and offline operation do not cause network checks.

Use a new ID when replacing the source identity. A declaration is neither proof
of reading nor an installation record. Do not expand transitive imports or infer
permission from a readable service. Only relevant originals are read through
existing host tools. Installed capability identity belongs to the host, not a
Context lock file.

## Entrances and evidence

An import is a reader entrance, not recorded evidence. It adds no entry to
`knowledge/structure.yaml` `references[]`, produces no review hint and has no
`import:` reference format. When an article's conclusion must be traceable or
tracked for change, register the needed external content as a source and capture
it; the import can remain as the reader entrance.

The CLI never contacts providers or compares versions. When asked to update or
check imports, the Agent observes current versions with existing authorized host
tools and compares them with `version`. Unreachable, unauthorized or failed checks
are reported as "version unknown" and are never treated as a change.

## Links and output

`[Engineering guide](context:import/engineering-guide)` in an article projects to
the declared URL. Build never guesses a provider-specific URL, appends `path` or
rewrites the version. Use an entrance that already opens the intended target.
Missing IDs keep the reader label as non-clickable text and produce a build link
warning. An invalid or unreadable declaration skips the optional directory and
degrades affected links the same way; unrelated outputs still build. Correct
`imports.yaml` or the article link to restore navigation. Merely registering
entries emits no page.

For an optional declaration-only directory:

```ts
kbPackage({
  name: "handbook",
  template: { path: "src/package-templates/kb" },
  importsPage: true,
})
```

This generates `wikis/imports.md` and includes it in package navigation. With an
existing `site` configuration, `importsPage: { site: true }` also adds a website
navigation item. `false` or omission disables generation. Initialization enables
the package directory when a valid `imports.yaml` already exists. An invalid
declaration is preserved with a warning; initialization continues without enabling
that directory. When first configuring
a new workspace's KB later, enable it if the declaration is present; preserve
existing settings and explicit user choices. The directory contains only declared metadata,
not approved article bodies or installation commands. Check audience suitability
before exposing private entrances.

Navigation links are not source evidence. Imports declaration support alone does
not authorize fabricated `import:` fragment references or advancement of article
evidence baselines.
