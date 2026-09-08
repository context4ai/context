# Write useful knowledge

Start with the answer or action the reader needs. Explain when it applies and
what they should do next. Source chronology is not the page structure. Keep the
smallest source span supporting each claim; link the stored summary when that
is all you read. Never pretend its original conversation or linked document was
available. Missing originals limit confidence, not permission to invent detail.

Select the declared profile template for the actual reader task. Its headings
are prompts, not required empty sections. A FAQ answers a coherent reader question
or related set of questions; a guide teaches a task; a decision explains a choice and its
limits. Do not make one page per source heading or one page per input file.
Separate unrelated topics even within one source, and combine corroborating
passages from several sources when they answer the same question.

Write claims at the strength of their sources. “Participants chose X for the
next rollout” is not “X is running in production.” A report of a passing test
is a reported result until the actual result is available. Quote only when the
wording itself matters. Preserve dissent, dates and applicable versions when
leaving them out would change the meaning. Do not publish personal exchanges,
secrets or incidental tool logs that do not serve the authorized reader goal.

Distinguish proposed, agreed, implemented and verified when the distinction
matters; they describe different facts, not automatic stages every page must
traverse. Agreement needs explicit confirmation by the relevant decision maker
or a record that clearly attributes that confirmation. A confident closing
message, silence or an Agent's summary alone is not approval. Preserve a
confirmation recorded in a supplied summary without pretending to have read the
original conversation. Implementation needs supporting code or maintained
material in scope, and verification needs an actual relevant result. A report
of implementation or verification can still be useful when attributed as such.

Where the source carries an optional `changes` association, use it as a readable
pointer for a reader who needs to check the change itself — name the repository,
commit or MR in the prose of the section that discusses it. It stays out of the
knowledge frontmatter, and it never raises a claim's strength: an association
records what was discussed, not that the change merged, deployed or passed tests.
When no code has been read, qualify the implementation claim rather than letting a
change link stand in for having read it.

For factual conflicts, compare scope, date and authority before choosing a
statement. A confirmed future requirement can coexist with current code. Keep
that distinction local to the explanation; do not silently overwrite one with
the other. Ask about a missing decision if it changes scope or correctness.
Other uncertainty can remain clearly bounded in a useful page.

Use plain language. Avoid pipeline names, internal counts and execution receipts
in the prose. Keep session IDs, change associations and Provider identities out
of knowledge frontmatter. Existing structure.yaml page/section source links
point to the stored source, where its optional metadata lives. Do not introduce
a parallel registry or copy change metadata onto every page.

Adjust the selected outline when the reader task needs different headings or
grouping. Use the capability-gap criteria in [classification](classification.md)
only when writing choices cannot solve the missing capability. Explain an actual
tooling gap and the available recovery in the user's language, outside the
knowledge page; do not turn an unfamiliar topic into a request for a new Provider.

Before returning the current Route payload, read the page as a reader: can they
answer the selected question without reconstructing the conversation? Check
that each meaningful source topic is included, supporting, deferred or excluded
with a concrete reason. A generic overview that drops the actual decision,
exception or resolution is incomplete even if its headings look correct.
