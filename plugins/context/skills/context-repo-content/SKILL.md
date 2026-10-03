---
name: context-repo-content
description: Create, edit or register same-repository project documentation and authored Skills in a Context workspace without starting knowledge production. Use for repository content maintenance, not external imports or knowledge article publication.
---

# Repository content

Maintain one original in its project directory. `repo-content.yaml` registers entrances;
`repo-content/` is a relative-symlink view, not a second authoring location.
This is an independent editing task: do not start production, update knowledge,
advance processed baselines, build, publish or commit merely because a document changed.

## Select the boundary

Identify the Context workspace and its Git root before writing. Paths in the registry
are relative to that Git root, even when Context lives in a subdirectory.
For a large multi-domain monorepo, use a workspace per direction; within one workspace
use at most one project/module group. Preserve existing workspaces and user choices.

During authorized onboarding, examine only the selected project's tracked README,
`docs/`, and `.agents/skills`, `.claude/skills`, `.codex/skills`. Select useful directories,
not every Markdown file in the repository. Other locations require an explicit user
request. Read-only questions do not authorize new registration.

Git tracking permits automatic discovery but does not prove ownership. Exclude
installed third-party Skills and de-duplicate copies across host directories. Ignored
Skills are external installations; untracked, nonignored content needs ownership
assessment. A Skill authored in the current task stays self-owned before its first commit.
Non-same-repository material, including registered source repositories, is not repo-content.
Do not copy it here or pretend imports support is provided by this skill.

## Edit and register

Edit the real project files, preserving local conventions. For a new project suggest
only useful documents (for example overview, development, architecture, feature/spec,
operations); do not create empty template sets or invent facts. Keep feature/spec under
documentation engineering. Keep executable Skill resources with their `SKILL.md`.
When creating a new document, use the optional [document outlines](references/document-outlines.md)
to select only the sections needed for the reader's task; do not generate a template set.

Read [registration.md](references/registration.md) when creating or changing a registry.
Register directories where appropriate: adding a file inside a registered directory
does not require another entry. Keep stable IDs when paths move. Do not change another
workspace's registry or infer cross-domain ownership.

After an authorized registry edit, run `context source ensure repo-content --format json`
to maintain the view; use `context source inspect repo-content --format json` for a
read-only check. Ordinary files occupying a mount must be preserved. When symlinks are
disabled or targets are absent, use the registered real path and report the limitation;
do not change Git settings, checkout, clone or fetch just to repair the view.

## Finish without triggering production

Report the originals changed and registrations/views maintained, plus any unresolved
paths. Explain that linked knowledge may need a later impact check; do not automatically
run it during editing. For a separately requested knowledge update, return to the normal
Context update workflow with `repo-content:<id>` as the source scope.

Original documents remain authoritative. If the user explicitly asks to rewrite selected
content into knowledge for an audience, capture those selected originals as document
sources and follow ordinary production/review; do not mirror the whole registry.
