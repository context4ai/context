# Registration and reading

Workspace-root `repo-content.yaml`:

```yaml
protocol: context.repo-content/v1
entries:
  cli-docs:
    kind: docs
    group: cli
    path: packages/cli/docs
    exclude: [drafts/**]
  cli-skills:
    kind: skills
    group: cli
    path: packages/cli/.agents/skills
```

Kinds: `docs` (document directory), `document` (single file), `skills` (Skills directory),
`skill` (single Skill directory). Optional `title` and `description` describe the entry.
Default mount is `[group/]<last path segment>`; use optional `mount` only to resolve
collisions, keeping at most one group and agreeing with `group`. Do not register nested
overlapping entries, submodules, external paths, or an ancestor containing Context itself.
`exclude` is an entry-relative glob, not an access-control mechanism. No remote, branch,
commit or per-file digest ledger belongs in this registry.

Navigation: `[Development](context:repo/cli-docs/development.md)` resolves to the original
repository in built articles; it is not an immutable evidence claim. Evidence instead uses
`source_ref: repo-content:cli-docs@<full-source-SHA>` and `locator.path` equal to the real
repository-root-relative path **at the time read**. Preserve line range and content digest.
Use `+worktree` after the SHA for changed working content; do not present its HEAD URL as
the exact evidence. Moving an entry does not change historical locator paths or old SHAs.

Local search can use `rg -L` over the selected view. On a checkout with symlink placeholders,
read the same registry and search real paths instead. Remote readers use the same fixed
commit throughout. Only explicit `Meta.Coverage.Symlinks: followed` supports assuming
the view was followed; mixed, not_followed, missing coverage or expansion limits require
checking the registry and relevant real-path coverage. Missing indexed targets are a
coverage gap, not proof content does not exist. Never request index-management rights
or silently switch to a newer commit to fill it.

Optional packaging: `kbPackage({ name: "project-kb", repoContentPage: true })` emits
only a README/Skill-summary entrance in `wikis/`, not ordinary docs or Skill scripts.
`repoContentPage: { site: true }` additionally exposes it on a configured website.
Existing packages remain unchanged. For a new workspace with registered content,
include the entrance in the selected KB output, but keep website exposure opt-in.
Check README suitability before making it public. Do not enable extra output channels
or rewrite existing package choices without the user's request.
