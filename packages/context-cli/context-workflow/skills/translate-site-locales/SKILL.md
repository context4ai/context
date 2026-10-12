---
name: translate-site-locales
description: Translate approved knowledge for the website locales declared in site.locales when the workspace Route selects this action.
---

Run `context translate prepare --format json`. The task lists every article and
knowledge map title that is missing or stale for each declared locale, with the
`expected_digest` to submit. Approved knowledge in the primary language remains
the only source of truth; translations never change it.

For each article, read the approved file and write a complete translation to a
temporary file under `.tmp/agent-payloads/`. Keep its structure exactly:

- frontmatter contains only a translated `title` and optional `description`;
- keep every `context:section` marker, id and order unchanged;
- keep every fenced code block, language and content unchanged; only Mermaid
  labels may be translated;
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
