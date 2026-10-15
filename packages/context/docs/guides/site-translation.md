# Site translation

A knowledge package website can publish translated copies of approved
knowledge for each language tag declared in `site.locales`. Approved knowledge
in the primary language remains the only source of truth; translations are a
reader projection and never change Review, Verify or the KB output.

## Storage

| Path | Content |
| --- | --- |
| `translations/<tag>/<approved-path>.md` | Translated article. Frontmatter holds `title`, optional `description` and a `translation` record with `locale`, `artifact_ref`, `source_digest` and `translated_at`. |
| `translations/<tag>/knowledge-map.yaml` | Translated navigation titles keyed by knowledge map entry `key`. |

`<approved-path>` is the path below `knowledge/`. Translations are formal
workspace content: they are included in workspace versions and package
fingerprints, so changing one rebuilds the website.

## Freshness

Each translation records the digest of the approved title, description and
body it was written from. A translation is `current` when the digest matches,
`stale` when the approved article changed, and `missing` when no file exists.
Runtime metadata changes do not make a translation stale. Files whose approved
article no longer exists are reported as orphans and removed by the next
submission.

When a package declares locales and any item is not current, the workspace Route
selects `translate-site-locales` after package template approval and before the
workspace version is recorded.

## Commands

```bash
context translate status --format json
context translate prepare --format json
context translate submit --input <file> --format json
context translate skip --digest <expected_digest> --format json
```

`prepare` lists each pending article and navigation title with
`expected_digest`. `submit` accepts:

```yaml
expected_digest: <from prepare>
articles:
  - locale: zh-CN
    approved_path: knowledge/codeindex/app/start.md
    file: .tmp/agent-payloads/translations/zh-CN/codeindex/app/start.md
map_entries:
  - locale: zh-CN
    key: getting-started
    title: 入门
```

A translated article keeps every `context:section` marker, id and order, every
fenced code block and its language marker, and every link target. Prose in
`text`, `txt`, and `plaintext` blocks may be translated; keep commands, paths,
and placeholders such as `<repository>` unchanged. Mermaid labels may change.
All other blocks, including blocks without a language marker, keep their content
unchanged. Submission validates all items first and saves nothing when
any item fails. A digest from before an approved content change is rejected.

`skip` records that the current pending items are published in the primary
language. Use it only when the user declines translation for this iteration;
the next approved change asks again.

## Website

Each page is published once and contains every language; the reader's language
selects what is shown at the same URL. A stale page shows the translation with
an outdated notice and a button that switches to the original; a missing page
shows the original with a notice. Navigation titles without a translation use
the translated article title, then the primary title. Site search covers every
language; opening a result in another language switches to it.

## Incremental drafts

`prepare` writes a draft for each pending article and a `submission_path`
template. A stale article's draft is its current translation; a missing
article's draft is the approved source. When Git history contains the approved
version the translation was made from, `source_diff` names a diff from that
version to the current article. Without such history `source_diff` is `null`;
compare the draft with the whole approved article. Update only what changed and
submit the draft. History is missing, for example, when several approve and
translate rounds ran without a commit in between: the version each translation
was made from was never recorded. Committing approved knowledge and translations
after a round lets the next generated draft carry a diff; it does not guarantee
one, because a kept draft never has a diff.

An existing edited draft is kept (`draft: kept`) as unfinished work, with
`source_diff: null`; a draft whose body is still the unedited starting text is
regenerated with its diff. A kept draft has no diff because the source may have
changed again, even back, since it was written, so align the whole draft with
the current approved article. Delete it
to start again from the current translation. Successful submission removes the
drafts and diffs it saved.
