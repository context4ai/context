---
name: translate-site-locales
description: Translate approved knowledge for the website locales declared in site.locales when the workspace Route selects this action.
---

Run `context translate prepare --format json`. The task lists every article and
knowledge map title that is missing or stale for each declared locale, with the
`expected_digest` to submit. Approved knowledge in the primary language remains
the only source of truth; translations never change it.

Edit each returned draft `file` and submit the returned `submission_path`. With
`draft: generated`, a stale article's draft is its current translation; when
`source_diff` is a path, apply those source changes. A missing article's draft
is the approved source to translate in a natural tone. With `draft: kept`, or
whenever `source_diff` is `null`, align the whole draft with the current
approved article before submitting. Keep the translation's structure exactly:

- frontmatter contains only a translated `title` and optional `description`;
- keep every `context:section` marker, id and order unchanged;
- keep every fenced code block and language marker; translate prose in `text`,
  `txt`, and `plaintext` blocks, preserving commands, paths and placeholders such
  as `<repository>`. Mermaid labels may be translated. Keep content unchanged
  in every other block, including blocks without a language marker;
- keep every link target unchanged; translate link labels only;
- keep product names, commands, file paths, identifiers and API names as written.

Translate knowledge map titles as short navigation labels. Submit with
`context translate submit --input <file> --format json`. Input fields:
`expected_digest`, `articles` (list of `{locale, approved_path, file}`) and
`map_entries` (list of `{locale, key, title}`). Validation is all-or-nothing:
fix each reported item and submit again. A large task may be submitted in
several batches with the same digest; untranslated pages show the original with
a notice.

When the user declines translation for this iteration, run
`context translate skip --digest <expected_digest> --format json`. The website
then publishes the pending pages in the primary language with a notice. Do not
skip on your own judgment.

Consume the returned `workflow.current` directly. In managed mode resume
`context run --managed --until blocked-or-complete --format json`. Translating
does not authorize a commit, upload or deployment.
