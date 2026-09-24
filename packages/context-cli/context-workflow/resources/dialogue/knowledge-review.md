---
id: dialogue.knowledge-review
kind: procedure
mediaType: text/markdown
---

# Knowledge-review dialogue

Present one current report for the complete agreed candidate scope. Ask the user
to read it and confirm or return revision notes. Use the host's user-question
tool when a response is needed. In a host supporting an opt-in feedback
confirmation presentation, use that presentation with an optional feedback input
and one explicit Confirm submit action. Otherwise use the existing question
surface. Do not require review codes, exact magic phrases, read receipts, or
per-article decisions from the user.

Interpret the full reply in its conversation context:

- Feedback alone: preserve the instructions, repair the affected candidates,
  inspect the resulting content, generate an updated report, and ask again.
- Explicit confirmation, approval, or permission to continue: apply approval to
  the presented scope using the current revision-bound confirmation command.
  There is no additional confirmation step.
- Feedback plus explicit approval to continue after fixing it: repair first,
  verify the resulting content against the instructions, then approve only the
  affected resulting revisions and previously presented unchanged candidates.
  Share the updated report for information and follow the next Route without
  asking again. If the correction cannot be completed, report the remaining
  issue instead of approving it.
- A request to continue editing and show the result afterward authorizes editing,
  not approval. Generate the revised report and wait for the user's decision.

An explicit Confirm submission with empty optional feedback is approval. Nonempty
feedback alone is a revision request even when sent with that same submit button;
only an explicit instruction to approve after revision adds that authority.
An ignored card, timeout, read progress or silence is not approval. Do not decide
by matching isolated keywords. Quoted examples inside feedback are not approval.

Resolve notes by canonical article ID or title against the presented candidates.
If a title is ambiguous, ask only for that missing identity. Retain the report
reference, scope and user intent in the conversation; do not make the user copy
an internal JSON payload. The Agent prepares scoped JSON from the current review
resource when needed. It may record pending instructions as repairs containing
candidate_id and instruction, separate from approve/reject decisions. Applying
repair instructions never approves a page. Follow returned repair commands and
inspect actual new content, not just successful command receipts.

A content change invalidates the old mechanical snapshot. For approved-after-fix
intent, materialize the new scope after verifying the fix and explicitly map the
result back to the authorized articles; leave unrelated new drafts pending. Do
not widen prior consent to a new article or an unrelated change. Use explicit
per-candidate decisions when the current batch also contains unapproved work.
Keep source, identity, baseline, revision and atomic-apply checks intact.

Retain the exact report URL or local path and the user's reviewed scope for the
final summary. A generated or accessible report is not proof that it was read.
Do not report fully managed or inaccessible material as read by the user.

With explicit session-managed authority, consume the required current Markdown
review resource and use its scope template and Route's atomic apply command.
Read pages before deciding, leave repair and undecided pages pending, and reuse
still-available review of unchanged pages. Do not open HTML or create a parallel
review ledger. After any apply or repair, follow the freshly evaluated Route.
