---
id: procedure.document-capture
kind: procedure
mediaType: text/markdown
---

# Document capture

Capture creates a reproducible local snapshot of a registered document source.
It does not classify, summarize, approve, or build knowledge.

Before capture:

1. every registered document module must have a matching capture declaration;
2. the user must have allowed the external read in the current conversation;
3. perform the Agent's task-wide image acquisition preflight below before capture;
4. execute only the current route command.

An explicit request to capture, ingest, fetch, or read named file/remote
documents grants source-read permission for those named modules. A mention,
possible-source discussion, or register-only request does not. An explicit
refusal always wins.

When that permission is already present and the Agent's image acquisition
preflight is complete, execute the
Gate's returned authority-carrying command. In managed mode it runs the
deterministic capture batch until the next real blocker; in ordinary mode it
reevaluates status with `context.source-read`. The authority remains in the
current command chain and is never persisted in the project. Never bypass the
Route by running a bare capture phase.

Document capture is an external action. Execute a returned command with
`execution.target: agent-host` through the Agent host so its network and
credential-store access remain available; do not nest it inside a restricted
child sandbox. If the CLI reports an external-environment requirement, retry
the same returned command through the host. Never downgrade credential
protection as a recovery step.

Capture targets are a batch. Process one current target, evaluate status again,
and continue until the graph reports the batch complete. Never treat one
successful module as completion of the whole batch.

The CLI owns normalization, snapshot identity, hashes, manifests, and
idempotency. For Lark sources it also owns embedded-resource download,
structured export, completeness reporting, and link projection. Required
resource failures block work that depends on that material; reference-only resources remain
explicit in the report. Never hand-write or repair captured snapshots or their
asset links. If a selected local
boundary is a documentation site rather than plain Markdown, use the
Context-provided processor/configuration diagnostic; do not invent rendered
text or scan outside the confirmed boundary.

For Lark reads, set `CONTEXT_LARK_IDENTITY=user|bot` in the environment of every
Context invocation that may read Lark; the default is `user`. A host/Bot prompt
setting alone is not an exported environment variable. User mode reads only
as the current user. Bot mode may fall back once to the current user only when
reading the document body fails with a credential, scope or access denial.
The fallback restarts the entire body, including pagination; never combine body
pages from different identities. Once the body is available, its identity is
fixed for all media, synced references, Sheets, Base and whiteboard reads.
Resource failures do not request user authorization or restart the article.
Network, rate-limit and format errors do not switch identity.

An image download denied by permissions may use the official preview endpoint
once with the same identity. A captured preview is explicitly marked as such.
Unavailable resources retain their location and failure reason; continue with
other resources and usable body text. Never infer missing image contents or
present a partial snapshot as a complete original. Assess any evidence gaps
before approving conclusions that depend on those resources.

This setting does not grant source access or change the intended audience of
the resulting knowledge. Do not use another person's credentials. For direct
host reads, explicitly pass the article's selected identity on every read.
Only an article-level fallback may request the current user's authorization;
use the managed runtime's authorization flow once when needed.
Local help and embedded skill discovery require no document authorization;
do not request user OAuth just to read a CLI guide.

If `docs +fetch` lacks the required `--doc-format`
capability, follow the returned `lark-cli update` recovery and rerun the same
Route command; do not replace the capture with a hand-written export.

An active production stage can continue planning and writing articles whose sources
are available while another capture remains pending. Keep unresolved sources in
`pending_scopes`; do not cite their unavailable snapshots. The Route returns to
pending capture after the active production/review work, before delivery completes.
This does not mark failed captures as complete or waive source-read authorization.

## Image acquisition before capture

The workflow instruction setting `DOCUMENT_IMAGE_CAPTURE` accepts `ON`, `OFF`,
or a positive integer document threshold; when absent it defaults to **10**.
Read it from the current task instructions or workspace guidance; a current
conversation instruction takes precedence. This is an Agent-interpreted setting,
not a CLI flag, environment variable, or SDK field. Hosts need not add a setting.

| Setting | Acquisition policy |
| --- | --- |
| `ON` | Include images without a document-count cutoff, subject to existing resource limits and explicit exclusions. |
| `OFF` | Capture bodies and image references only, regardless of document count. |
| positive integer `N` | Include images under the existing policy for at most `N` documents; above `N`, use references only. |
| absent | Use `10`. |

For an invalid value, report it and use `10` rather than silently enabling all
images or blocking the task. An explicit current-conversation request to include
all images selects `ON` for this task; an explicit request to skip images selects
`OFF`. If neither is present, use the configured setting. Do not write a temporary
conversation override back into permanent workspace guidance.

Count distinct documents
selected for this task, including Wiki descendants and in-scope linked documents,
not all historical workspace sources, API pages, retries, or output articles.
Deduplicate shortcuts and repeated links. Splitting the task into batches or
resuming it does not reset the count. Exactly 10 documents is within the default.

Before starting capture, the Agent separately checks the document count (or known
lower bound), setting, and effective image policy. This is an Agent self-check,
not a user confirmation gate: do not ask a question or wait for a reply. Above the
numeric threshold, automatically capture bodies with image references only; at or
below it, retain the existing image policy. `ON` and `OFF` apply regardless of count.
A generic
"capture everything", source-read permission, managed mode, or an old bundle setting
does not. Briefly report the count and applied policy in the work-start update and
retain the decision in task notes; do not repeat the update for every document.

If the count is unknown, first perform only authorized directory/metadata discovery
without image downloads. If body reads are needed to discover linked documents,
use a body-and-reference-only discovery pass within existing read authorization.
With a numeric setting, unknown totals do not authorize image acquisition; `ON`
does not require counting to enable images, and `OFF` never enables them.
Recalculate the task total before enabling images under a numeric setting.
If later expansion crosses the numeric threshold, apply the
reference-only policy before further acquisition and report the change without
waiting for a reply; retain any explicit all-image override and existing evidence.

For `OFF` or above-threshold tasks without an `ON` override, apply
`resources: { images: "reference-only", gifs: "reference-only" }` to the selected
Lark capture declarations before executing the Route. Preserve unrelated sources,
resource settings and existing stricter exclusions; inspect generated/dynamic
configuration rather than assuming registration applied the policy. Host prefetch
and import paths must honor the same choice, not download images before import.
Other resource types retain their existing policies. Do not edit snapshots or
invent unsupported flags; when a capture adapter cannot exclude images, explain
that limitation and resolve the acquisition method before downloading.

Preserve source links/placeholders and report skipped images as not acquired or
interpreted. This is a workflow instruction using existing resource policies, not
a new CLI hard gate or automatic document counter. For tasks that still include
images, retain the existing handling workflow for more than 30 distinct images
and reuse an explicit choice; do not invoke it for images skipped by this
preflight. Never substitute temporary signed media URLs as permanent
public image links.
