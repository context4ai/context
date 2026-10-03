---
id: context.sdk.repo-content
kind: procedure
mediaType: text/markdown
---

# Same-repository content

Keep project documentation and authored Skills at their original locations.
Context registers an entrance without copying their bodies to knowledge or
source snapshots. For selection and editing use `context-repo-content`.

At the Context workspace root, create `repo-content.yaml`:

```yaml
protocol: context.repo-content/v1
entries:
  docs:
    kind: docs
    path: docs
  tools:
    kind: skills
    path: .agents/skills
```

Paths are Git-root-relative, not workspace-relative. Kinds are `docs`,
`document`, `skills`, and `skill`. Optional `group` is one module level;
`mount` overrides the default `[group/]<basename>`. Optional `exclude` globs
are relative to the entry; they are not access control. Overlapping entries,
outside targets, nested repositories and cycles are rejected.

`context source ensure repo-content --format json` maintains relative symlinks
in `repo-content/`; `source inspect repo-content` and `status` inspect without
repairing. Ordinary files are not overwritten. With disabled symlinks, search
real paths from the registry rather than reading Git placeholders. No Git
configuration or index is changed. Registry and relative links can be committed
by the user; originals remain the only authoring location.

Invalid registration is advisory in `status` and automatic pre-operation link
maintenance: correct `repo-content.yaml`; existing links are left unchanged.
The repair command is suggested only for missing or misdirected symlinks, not
invalid registration, missing targets, ordinary-file conflicts or disabled
symlinks. Fix those reported conditions rather than repeatedly running ensure.
Explicit repository-content updates and `context build` require valid
registration. An invalid registry stops build before replacing existing package
outputs; it is not treated as an empty registry. Missing source files and
unavailable Git objects follow the documented fallback behavior instead.

Article navigation uses `[Guide](context:repo/docs/guide.md)`. Build projects
this to an upstream link when available, otherwise a plain location. Evidence
instead records `repo-content:docs@<full-commit>` plus real historical path,
line range and content digest. Uncommitted evidence uses `<commit>+worktree`.
The evidence Wasm supports these references without treating their existence
as proof that the source was read in the current query.

## Optional entrance page

```ts
kbPackage({
  name: "project-kb",
  template: { path: "src/package-templates/kb" },
  repoContentPage: true,
});
```

SDK default is off. New initialization with an existing nonempty registry
creates a KB declaration with the entrance enabled; existing declarations are
preserved. It projects a group's README and Skill names/descriptions under
`wikis/repo-content.md` and optional group pages, not all docs or Skill scripts.
HEAD objects are preferred without network fetching, with declared worktree
fallback when unavailable. Review README sensitivity before exposing it.
With a configured website, `{ site: true }` opts into a top-level site entrance;
plain `true` keeps these pages out of the site.

Other repositories and externally installed Skills are not same-repository
content. Registering an entrance does not imply installation, execution,
production or publication authority.
