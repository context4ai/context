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
fenced code block with its language and content (Mermaid labels may change), and
every link target. Submission validates all items first and saves nothing when
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
