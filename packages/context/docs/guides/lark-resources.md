# Lark Resource Materialization

Lark documents can contain evidence that is not present in the readable text
body. Context handles these resources mechanically during `captureLark`; the
Agent does not reconstruct resource bytes or substitute a summary for them.
When the host already fetched the document, `context source import` accepts the
actual full response files and downloaded media for the same normalization and
resource checks; it does not fetch that supplied body again. See
[importing an existing response](knowledge-updates.md#import-a-document-response-already-read-by-the-host).

## Resource policy

| Resource | Default capture behavior |
|---|---|
| Image | Download the original; on explicit download permission denial, try a same-identity preview once and mark it as a preview. |
| Attachment | Download the original file and link it from the Markdown projection. |
| Sheet | Read the complete selected sheet, render a Markdown table, and retain a CSV snapshot. |
| Base | Read the selected table/view with pagination, render a Markdown table, and retain a canonical JSON snapshot. |
| Whiteboard and diagram | Retain a readable preview plus the raw structured export. |
| Synced block | Resolve the exact source block, project its body, and retain a Markdown evidence snapshot. |
| Poll | Preserve exported options and metadata as non-interactive Markdown; warn when the export omits them. |
| Bookmark, citation, sub-document, chat, and generic embed | Preserve a stable navigation reference and provenance. |
| Video | Preserve a stable reference by default; download only when `resources.videos` is `bundle`. |

Required inline resources fail closed when their stable identity, bytes, or
complete structured data cannot be obtained. When the remote API explicitly
confirms that a referenced whiteboard or diagram no longer exists, Context
preserves an unavailable-resource notice with the reason code
`document.resource.source-missing`, reports a warning, and continues capture;
it does not pretend that the deleted content was materialized. When the current
identity can read the document body but the API explicitly returns
an explicit permission denial (including HTTP 403) for an embedded resource, Context records
`document.resource.permission-denied`, keeps the stable resource identity in
the audit layer, renders the same unavailable-resource notice, and continues
with a warning. Explicit missing-scope and access-denied resource responses are
likewise recorded without changing identity. Transient network errors, malformed
payloads, and unclassified failures still block capture. Reference-only
resources remain explicit in the capture report. Unknown non-empty XML blocks
stay auditable in the raw XML and receive a warning; the CLI does not infer
their meaning.

Document and resource reads share one access identity. The configured default is
user. Bot mode permits one whole-document user fallback for a body authorization
failure, restarting all pages. After the body is read, resources remain under
that identity. A resource failure never requests another identity's credentials.
Legacy explicit auto mode may select Bot when user credentials are unavailable;
all resources still use the identity that supplied the complete body.

## Storage lifecycle

Resources have three distinct locations:

```text
sources/lark/<date>/
├── <module>.md
├── manifest.json
└── assets/<module>/
    ├── source.xml
    ├── capture-report.json
    └── materialized/**
knowledge/assets/<resource-kind>/<content-sha256>.<ext>
dist/<package>/others/assets/<resource-kind>/<content-sha256>.<ext>
```

- `sources/` is the captured source and audit layer. `source.xml` preserves the
  structured source, one `capture-report.json` closes fidelity and resource
  handling for the document, and `materialized/` contains downloaded files and
  structured exports. Resource descriptors are consolidated in the report;
  capture does not create one metadata file per embedded resource.
- The date-level `manifest.json` is a compact inventory. It records hashes,
  asset roles, the report path, and status summaries without duplicating the
  complete report.
- `knowledge/assets/` contains only resources referenced by approved pages.
  Paths are content-addressed, so identical bytes are reused and changed bytes
  produce a new identity. Review apply rewrites page links mechanically;
  verification compares the underlying content identity, so this deterministic
  path projection does not count as a change to a verbatim section.
  Markdown files below `knowledge/assets/` remain evidence resources and are
  never interpreted as approved knowledge pages or structure views.
- `others/assets/` is the portable package projection. Build copies only
  resources referenced by selected package pages and rewrites their relative
  links. Audit-only source files are not distributed.

Deleting an approved page allows unreferenced `knowledge/assets` files to be
cleaned. A missing approved or packaged resource is a verification error rather
than a silent broken link.

Source assets are part of the reproducible evidence snapshot and should not be
ignored when the workspace is versioned. Repositories with many binary source
assets can use Git LFS for `materialized/` while keeping Markdown, XML, JSON, and
CSV directly reviewable in Git. The workspace must remain private when the
captured source or screenshots are access-controlled.

## SDK configuration

Defaults are suitable for ordinary documents:

```ts
captureLark({ source: handbook });
```

Projects can opt into bundled video and adjust deterministic byte limits:

```ts
captureLark({
  source: handbook,
  resources: {
    videos: "bundle",
    maxBytesPerResource: 20 * 1024 * 1024,
    maxTotalBytes: 200 * 1024 * 1024,
  },
});
```

The limits are capture constraints, not semantic filters. Context does not
decide which resources are important from their business content.

## Agent behavior

Use the capture command returned by the current Route. Inspect the structured
resource summary and fidelity diagnostics; do not manually edit `sources/`,
`knowledge/assets/`, or package links. Required materialization failures other
than a confirmed source-side deletion or an explicit resource-level permission
denial must be resolved by recapturing after access or source problems are
fixed. Accepted failures remain visible as warnings and unavailable-resource
notices; they are never represented as downloaded evidence. Review shows
available previews, references, and warnings so the human or managed policy can
assess the page with its non-text evidence.

## Image choices for a production task

Before capture, the Agent follows the document-capture Route procedure's task-wide
document threshold and image self-check, without asking for user confirmation.
Set `DOCUMENT_IMAGE_CAPTURE` in task instructions or workspace guidance to `ON`
(include images), `OFF` (references only), or a positive integer document threshold.
Omitting it uses `10`; exactly the threshold remains within normal acquisition.
Current-conversation instructions override workspace guidance for that task only.
For example, `DOCUMENT_IMAGE_CAPTURE: 20` skips image downloads when the task
contains more than 20 distinct documents. This is an Agent instruction, not an
environment variable, CLI flag or SDK field; no Bot configuration is required.
Above a numeric threshold, the default is body capture with image references,
unless the effective setting is overridden to `ON`. This workflow
choice uses the existing resource fields; it does not change SDK defaults or add
a CLI hard gate. Apply it before bulk capture or host prefetch, not after images
have already been downloaded.

The work-start report asks once when a task contains more than 30 distinct images
that will be acquired and has no explicit image handling policy. Reuse the
current-conversation image instruction when it already settles this choice. The choices are intelligent conversion and
inclusion (recommended), include all as images with compression, or include none
with placeholders. Count the whole task, not each capture or writing batch.
Review reports show the resulting image handling and any fallbacks.

To skip image acquisition while preserving visible source placeholders:

```ts
captureLark({ source: handbook, resources: { images: "reference-only" } });
```

To retain static images but exclude GIF files:

```ts
captureLark({ source: handbook, resources: { gifs: "reference-only" } });
```

Both fields also accept `bundle`; omitted fields retain normal capture behavior.
Known GIF metadata avoids downloading; when a source only supplies an opaque
media token, identification may require downloading the file. Such a GIF is then
excluded from the snapshot assets and knowledge, rather than decoded or retained.
Existing evidence is not deleted by changing a policy. Already approved image
references must be revised through the normal Review flow to change their content.

Inclusion does not mean lossless original-byte delivery. The package optimizer
preserves animations without decoding every frame or silently flattening them.
Codec failures and images that cannot fit delivery budgets become visible output
placeholders with a build warning; approved source bytes remain unchanged.
Do not rewrite approved prose to repair a codec error or disable pixel safety
limits. The reading meaning of an image is handled in writing and Review.

Source document links can be retained for viewing under the reader's permissions.
Temporary signed media links are not durable image hosting. Do not embed access
tokens in generated pages or claim that excluded images have been interpreted.

### Capture identity and unavailable media

The selected document identity remains fixed for resource reads. In Bot mode,
only an authorization failure while reading the body can restart the article
as the current user. Resource failures never trigger that identity fallback.
Images may use the official same-identity preview endpoint after download
permission is denied. Previews are marked explicitly; unavailable resources
retain references and diagnostics. Use available body evidence without inferring
missing resource contents, and review evidence gaps before approving conclusions.
