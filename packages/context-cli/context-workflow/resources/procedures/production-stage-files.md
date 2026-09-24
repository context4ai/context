---
id: procedure.production-stage-files
kind: procedure
mediaType: text/markdown
---

# Production stage files

The stage entry links CLI-owned requirements, planned skill guidance and task
directories. Read relevant source text before writing; a skeleton is navigation,
not semantic evidence. Skill names guide work, not article ownership or versions.

Use the [reader organization guidance](knowledge-updates.md#reader-tasks-names-and-reading-order)
for article names, placement and manually arranged navigation.
Use `context task adjust --inspect --format json` to obtain current categories,
reading order and the exact revision before preparing a navigation adjustment. Check the draft's
main reader task against its planned title and group; adjust through the existing
plan, revision or knowledge-map flow when needed. A navigation change alone does
not call for rewriting valid prose.

Restore repository checkouts only when needed for the current investigation or
article. Independent notes/documents can proceed while unavailable code remains
an explicit gap. For a required repository, read the
[recovery procedure](repository-source-recovery.md) and inspect only its registered
name, not every repository. Never claim missing material was checked.

Plan article paths are relative to `knowledge/`, for example `business/example.md`.
`indexer_usage.scopes` contains stage source refs, not collection names. Declare
selected skills through the plan; no separate Indexer registration is required.

Choose relevant code directories while planning or writing. A task brief may
name useful reading scope; module labels do not imply directory permissions.
No module mapping file, version receipt or article-level scope fields are needed.
Read related code as needed within the user's authorized sources.

Keep planning proportional to this request. For a short document task or one
bounded module, decide whether to add or revise related articles and their reading
position; do not redesign unrelated modules or the whole site. Start with relevant
existing topics, not every navigation page. Expand investigation when the material
requires it, not to fill a planning template. One batch is sufficient unless real
dependencies or useful parallel work call for more. Source count is not a page
count or a CLI threshold.
For a broad request, identify its major capability families and document tasks;
lightweight planning limits initial depth, not the authorized range. Use existing
questions and briefs to distinguish checked entry points from explanations and
keep unplanned work visible. A first batch is not the whole requested outcome.

For restructuring, assess existing articles as well as proposed additions.
Preserve useful text until approved destinations carry it; then repair links and
navigation. Splitting/merging uses ordinary article tasks and fragment edits.
After their delivery, explicitly obsolete approved pages can use the retirement
preview described in the knowledge-updates guide. Removing a plan task or menu
entry does not retire its approved article.

During an approved stage, use the existing plan-amendment path for in-scope
additions and preserve completed work. Do not restart planning solely because
another article is ready to write. Keep remaining investigation explicit; a small
current task does not mean other authorized work is finished. New source or purpose
authorization still follows the current Route.

Write results under the returned Agent directory. All submission paths are
relative to `.tmp/agent-work/production-stages/<stage>/`, even when the manifest is in `submissions/`. They are never relative to `.tmp/context-runtime/` or to the manifest location. Each task lists the complete workspace-relative Markdown and reference output paths.
Copy the CLI's submission template, keep completed tasks only, and keep each
task's prefilled `input`. Submit the manifest using the returned command.
Do not edit submitted files until the command returns.

A complete article uses `content` (Markdown) and `references` (YAML/JSON).
Markdown has reader-facing title and description frontmatter, followed by the
complete article with stable `context:section` markers. References contain
`sections`, each with its matching `id` and `references` list. A reference is
`source_ref` plus `locator: {path, start_line, end_line}` from actual authorized
text. CLI computes source digests. A fragment may cite at most three distinct
source positions; an article may have multiple fragments.

A revision uses `edits` instead of `content`/`references`. The file contains an
`edits` list. Each item maps `replace: [old-fragment-ids]` to `with: [...]`, whose
entries contain `id` and the changed `markdown` and/or `references`.
Omitted fields retain the previous value only for the same fragment identity.
New identities require both fields. Empty `with` deletes the named fragments.
A split or merge explicitly names old and new identities; merging cannot
silently delete intervening article text. Insert with empty `replace` and
`after: <existing-id>`, or `after: null` before the first fragment.
Fragment Markdown excludes its outer markers, which CLI generates.

The same edits format can repair a failed complete draft retained temporarily
by CLI. If that draft is missing or structurally unusable, resubmit a corrected
complete article. Failed tasks report a file/fragment when available; accepted
tasks remain saved even if preparation of the next directory fails.

The default is one batch. Supply `--multi-agent` only when this caller supports
coordinating multiple batch directories. Omitting it safely downgrades scheduling
without invalidating already-issued tasks or overwriting worker drafts.

If the user explicitly asks to receive completed articles before the remaining
work finishes, run `context run --deliver --format json`. This pauses writing,
not approval: follow the returned Review, close and build routes. A successful
build resumes the same stage; a failed build retains the pause and all tasks.
To cancel that pause explicitly, use `context run --resume-writing --format json`.
It preserves approved articles, candidates and existing task input handles.
Partial delivery must include the approved articles needed by its local links.
