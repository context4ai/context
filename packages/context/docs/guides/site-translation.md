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

`prepare` returns section changes, title/description changes, exterior-text changes
(including the article tail), and section order changes. It writes draft files
and a `submission_path` template. Unchanged parts retain their translation;
changed parts contain the current primary-language text for the Agent to translate.
Review every pending part before submitting; generated source text is not a translation.

Older current translations acquire source-part baselines without changing their
reader text. Older stale translations report `diff: unknown` and get a full source
draft plus a `.previous.md` translation for comparison.

Repeated preparation preserves edited drafts. `draft: rebase-required` means the
source changed while a draft was being edited; that draft is excluded from the
submission template. Reconcile it with the current source, then explicitly add
the returned `source_digest` to that article's submission entry. Never copy a new
digest onto an unreconciled draft. Ordinary submissions still use `expected_digest`.
A draft without a generation record, such as one left by an older workflow, is
kept as `unrecorded_draft` beside a freshly generated draft.
