---
id: procedure.production-stage-files
kind: procedure
mediaType: text/markdown
---

# Production stage files

The stage entry links CLI-owned requirements, planned skill guidance and task
directories. Read relevant source text before writing; a skeleton is navigation,
not semantic evidence. Skill names guide work, not article ownership or versions.

Choose relevant code directories while planning or writing. A task brief may
name useful reading scope; module labels do not imply directory permissions.
No module mapping file, version receipt or article-level scope fields are needed.
Read related code as needed within the user's authorized sources.

Write results under the returned Agent directory. All submission paths are
relative to that stage directory, even when the manifest is in `submissions/`.
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
