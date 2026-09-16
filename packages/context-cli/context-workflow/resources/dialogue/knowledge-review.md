---
id: dialogue.knowledge-review
kind: procedure
mediaType: text/markdown
---

# Knowledge-review dialogue

Explain that Review is the boundary between draft candidates and approved
Markdown. In ordinary mode:

1. open the complete current Review report;
2. let the user approve, reject, or request revisions to candidates;
3. ask them to copy the review code back into the conversation; and
4. apply only that exact review code through the returned command.

The user does not need to create a payload file; the Agent may write the pasted
review code to ignored scratch storage for the CLI command. Preserve it exactly;
do not decode, regenerate, summarize, or edit it. The code carries decisions and
revision instructions together. If it exceeds 1,000 characters, use a direct
reply (mention the Bot when relevant) instead of a length-limited form. Older
segmented codes still require every segment in the same input file. If the CLI
reports damaged or stale feedback, follow its diagnostic and request a fresh
report/code; never repair a code by hand.
Never derive a payload
from HTML, candidate ids, snapshots, or a default decision.

When the user completes a decision from the report, retain the exact report URL
or local report path and reviewed scope in the current conversation for the
final completion summary. Do not persist a separate workspace ledger or count a
report as user-reviewed when it was inaccessible, fully managed, or bypassed by
force approval.

Do not mention force approval when first presenting Review. If the user replies
without a review code that they approve or want to continue, explain that the
report review code remains the normal path. Only at that point, when the report is
unavailable to them, tell them they may explicitly reply with the exact phrase
`强制批准` to approve the complete current scope without per-candidate choices.
Execute the Route's `after-human-confirmation` force-approval command only after
that exact phrase appears in the current conversation. Phrases such as `我批准`,
`继续`, or `全部通过` do not invoke this escape path.

Do not open Review for one page or module while another confirmed item in the
same round is still being generated. If a repeat codeindex run has no delta,
state that existing approvals were preserved and no Review gate remains.

When the user explicitly requested fully managed operation, materialize the
required `context.review-current` Markdown Resource once, read its index and
the pages being decided, then use the revision-bound atomic apply command with
the index's current scope template. Approve only pages actually reviewed; leave
undecided and repair pages pending. Do not open HTML or persist a parallel review
ledger. A partial review code in ordinary mode likewise leaves pending pages
unchanged; all segments of that code are still required.

After applying feedback, follow each returned repair command with the user's
exact instruction. Repairs remain pending; neither copying nor applying the
code approves them. Pending instructions are retained by the CLI and exposed in
the current review resource after a session restart. Re-read and review the
resulting candidate before approval. Do not silently replace a revision request
with rejection or bulk approval.
