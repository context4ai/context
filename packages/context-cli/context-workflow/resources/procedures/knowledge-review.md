---
id: procedure.knowledge-review
kind: procedure
mediaType: text/markdown
---

# Knowledge Review

Agent policy: `context.gate.knowledge_review`. An instance-specific Bot may
override the managed default and require the ordinary HTML review decision.

Review is the authority boundary between candidates and approved knowledge.
Open one report for the complete current candidate set and apply only a payload
that matches its collection scope and candidate-set digest.

Before Review, Context checks both sides of approved page identity: whether a
candidate path is already owned by another `article_id`, and whether
the candidate `view_ref` is already approved at another path. Either conflict
blocks Review. Follow the returned identity-coordination route: the default
mechanical repair preserves the approved identity and approved path, then
recompiles only the affected source. It keeps the candidate batch intact while
replacing affected candidates in place. Changing an approved identity or moving
an approved path is a migration within the user's requested scope; do not ask
again when that scope is already clear. The resulting Candidate still enters
Review.

Without explicit session-managed authority, open the report returned by the
Route and request confirmation or revision notes through the host user-question
tool. Follow the selected knowledge-review dialogue to distinguish feedback,
approval and approval-after-repair. Keep the exact report reference, presented
scope and user intent in this conversation. The HTML contains reading progress
and plain revision notes, not approval authority. Normal explicit confirmation
uses the Route's revision-bound resolution Action and the report's scope snapshot.
No review code or special approval phrase is required.

For old automation, `review approve-all --force` remains a deprecated explicit
approval alias and applies the current candidate scope without requiring a new
report. Prefer `--confirmed` for new calls. The CLI also accepts existing legacy
review files and translates their decisions and repair notes, retaining scope,
content and baseline checks. Compatibility notices go to stderr, preserving JSON
stdout. Never request or generate a review code; the page exposes only reading
progress and revision notes. Existing pending repairs must still be resolved.

With explicit session-managed authority, materialize the required
`context.review-current` Markdown Resource once. Read its index and every
reader-facing batch file listed there. Each Candidate appears in exactly one
bounded batch; keep the decisions in the current Agent context and do not write
a Review ledger. Use the current scope template in that index with the Route's
atomic apply command. Add explicit decisions only for reviewed pages; leave
repair or undecided pages out of decisions and do not set a default. For a fully
reviewed acceptable set, default approval remains available. Do not generate,
open, or parse the ordinary HTML report. Reopen repair pages through their
current repair command; unrelated approvals remain valid. The
authority exists only in the current conversation. It does not bypass source
permission, validation, close, or verify, and it is not proof that the files
were read.

After apply, re-evaluate. Do not infer that close or package output is current.
Do not persist a duplicate review-report ledger in the workspace.

For restructuring, compare replacement content with the affected approved pages:
useful conditions, steps and explanations must have a destination before removal.
Review omission rejects a candidate; it does not retire an approved article.
Pure retirement does not enter this HTML report. Use the explicit retirement
preview after replacement delivery, and repair its
reported incoming references. Navigation removal alone does not remove content
from search or packages. A renamed menu does not require a new article identity.

Before requesting human review, follow the report's navigation diagnostics.
Bind unplaced drafts to suitable existing categories using the returned adjustment
action, then regenerate the report. Draft placement does not require content
approval. Ask about placement only when the existing structure and task do not
establish a reasonable destination. Keep unplaced pages visible for diagnosis;
do not describe the report as ready while placement is unresolved.

The report opens on a change overview, with the existing navigation and an
expected workspace file tree. The CLI collects approved titles, navigation and
candidate bodies; it renders their changes mechanically. Do not write a second
summary in place of candidate content or rewrite the HTML. New workspaces show
all candidate pages as New. Existing unchanged pages show titles only; changed
blocks and previous text remain available for comparison. Navigation without a
Git baseline is labelled as current context, not an invented historical diff.

Opening a candidate marks it READ once for that browser and content version.
Read counts and revision notes are local convenience state, never approval or
required CLI receipts. The total includes only current candidates. Typing notes
immediately marks a page for revision; clearing notes preserves its READ state.
The revision counter opens a card list of titles and notes, with links back to
the articles. Copy exports plain notes with article IDs and titles. After copying,
a five-second dialog previews the text; only that preview is truncated at 400px.

The Agent converts conversation intent into current scoped CLI decisions or
revision instructions. A rejection durably omits a candidate; it does not request
a rewrite or retire an approved article. Repair first, inspect the actual result,
and obtain a new decision unless the user already explicitly authorized approval
after the correction. The latter applies only to the same agreed article scope.

Use the affected page's `Repair` command in the review material, replacing only
the correction instruction. Current candidates are repaired within this batch;
`--timing priority` is not needed and does not queue them behind delivery.
`--regenerate` schedules program regeneration for approved pages. If supplied
for a current candidate, follow the CLI's returned repair command instead.
After the repair, read the new Route and review the changed material before
approving the batch. Pending maintenance requests for other pages remain queued.

For a repaired generated table, inspect the new Candidate's affected rows, not
only its Repair ID or accepted Author/Composer outcome. Check the reported error
against the available source version and facts. A missing value is not always a
missing source: the source may be present but unsupported by the parser, or the
correct fact may have been lost during rendering. Describe which case the
available material establishes. An explicit limitation may be acceptable for the
reader's task; a known false value must be repaired. If the same error remains
after regeneration, preserve the batch and report the affected page, field and
source/fact comparison. Repeating the same repair without new material or a tool
fix is not progress. Do not approve, omit, or hand-edit a block to hide the error.

## Interpreting generated API output

Check fields, types, requiredness and supported defaults against the selected
source version. A table can completely express a simple declaration; omitting
that duplicate folded declaration is intentional. Complex relationships or
constraints not represented in rows remain in a named declaration. Program
`declaration_status`, when present, distinguishes `table-complete`,
`component-wrapper`, `retained` and `not-provided`; its `fact_ref` and `source_ref`
locate the input. Missing folds alone do not establish a parser failure.

If the user explicitly requires a different presentation, explain the difference
and resolve that choice before accepting it. Do not rerun unchanged Repair to
force a format the program deliberately omits. Check the actual resulting page;
accepted tasks or an empty Composer result alone do not demonstrate a correction.

## Delivering approved pages while others need repair

A partial decision keeps remaining pages in Review. It does not build after each
approval. When the user asks to see approved results now, use
`context run --deliver --format json` and follow its new Route through close and
build. The CLI checks that the approved pages do not depend on unresolved pages;
if they do, finish the linked pages first. No draft is approved or omitted by
this request. Remaining drafts, accepted work and source baselines stay in place,
and the Route returns to their Review/repair after the selected output builds.

## Check usefulness as well as factual accuracy

Use the current requirements and agreed scope to check whether a reader can
complete the promised task with these pages. For navigation, check a specific
file/symbol or source section and an actionable next hop; for explanations or
procedures, check the necessary conditions, steps and examples. Source citations,
task acceptance and navigation bindings alone do not establish either outcome.
Compare representative pages with their
actual definitions: keep defaults and members attached to the correct callable
or type; inspect inherited members and static entry points when needed for the
reader's task. Do not infer that an unexpanded type has no options or callbacks.

Look for promised integration steps, examples or troubleshooting answers that
may be missing across the relevant pages. Check neighboring pages before
requesting additions. Repeated prose is a reason to inspect the actual content,
not an automatic rejection rule. If the source is insufficient, identify what
is unavailable and its effect on the reader instead of inventing content or
forcing another identical regeneration. Keep correct pages eligible for the
partial approval and delivery path above.

Compare the batch with the agreed whole scope and remaining investigation, not
only its own titles. When revising or merging, preserve useful existing detail
instead of replacing it with generic lookup advice. Repair affected pages or
use the current planning route for missing topics. These are Agent judgments,
not minimum article counts, a new coverage ledger or an extra CLI approval gate.

For image-heavy work, show the selected task image policy and actual retained,
converted and placeholder counts from the candidates and capture reports. Explain
any fallback affecting reader understanding. Reuse the planning choice; do not
turn image handling into another per-article approval. Missing image content must
not be presented as read or fully covered. Build-only media fallbacks are reported
in the build receipt and do not rewrite approved evidence.

Within the current revision scope, remove research-baseline prose (repository
commit IDs or capture revisions repeated in the article). Preserve source
references and exact citation destinations. Keep versions or comparison baselines
that explain business behavior, compatibility, migrations or measured performance.
Do not turn this editorial check into a keyword gate or an unrelated cleanup.
