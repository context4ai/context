# Choose the reader outcome

Classify useful passages, not the entire file. Source type, reader-facing form
and operation are independent choices. One source can correct an existing FAQ,
add a decision explanation and contain irrelevant conversation at the same time.
Explain classifications in the user's language in the work-start report; the
profile IDs below are protocol identifiers, not headings for the reader.

| Material and reader need | Suitable profile | Action |
| --- | --- | --- |
| A concrete question with a supported answer | faq-support | Update the matching answer; create only if the question is distinct |
| A repeatable task with prerequisites and checks | technical-guide / user-and-developer-guide | Integrate steps into the existing guide or propose a missing task |
| Operational diagnosis and recovery | runbook | Preserve symptoms, checks, safe actions and verification |
| Confirmed choice with rationale and limits | decision-record | Explain the choice, applicability and meaningful alternatives |
| Agreed intended behavior and acceptance conditions | product-requirements | Keep intended behavior distinct from current implementation |
| A reusable term, relationship or domain rule | domain-reference | Define it with scope and useful examples |
| An incident account supported by observations | incident-review | Separate observations, causes and unverified hypotheses |
| A test method or reported validation result | test-validation | Retain method, scope and what the result actually demonstrates |
| Repetition, superseded claims, unresolved speculation without reader value | No new target | Support, defer or exclude with a concrete reason |
| A required reader outcome needs a capability this Provider does not supply | `unsupported` for the affected material | Name the actual missing capability using the current Route; report its scope and recovery |

“FAQ”, “knowledge improvement” and “knowledge accumulation” are not three source
storage types. FAQ is a reader form; improvement usually revises approved prose;
accumulation may add a topic or enrich an existing one. Decide from the actual
reader question and existing coverage. Never route every note/session into FAQ.

Choose the closest applicable declared profile by reader task, then adapt its
outline to the useful content. Headings, grouping and examples are writing
choices, not new capabilities. An existing project template override takes
precedence; use supported customization when a reusable local template is
needed, not as a prerequisite for ordinary writing. Do not invent profile IDs
or claim unsupported tools, source access or output contracts.

Reserve `unsupported` for a real capability gap that prevents the requested
outcome within the authorized scope, not a mismatch with a stock outline. Name
the missing capability in the current Route payload and explain which work is
affected; follow its recovery instead of imposing an extra approval or stopping
unrelated work yourself. Missing metadata or an unresolved claim can usually be
bounded in useful prose. Request material only when the missing evidence is
necessary to answer the reader's question; exclude material with no reader value.

Reach for it rarely. The forms above are broad, and an awkward fit is not an
absent one — a benchmark someone reported is test-validation, a complaint thread
that reached a supported answer is faq-support, a walkthrough given in the
discussion is a guide. What decides is the reader question, not how the
conversation happened to unfold. A rambling thread, an unsettled status and an
unfamiliar topic are none of them capability gaps; the first two are ordinary
authoring work and the third is usually one of these forms under a name you have
not seen before.

Keep one subject identity for the same reader topic across updates. Two topics
with the same title are not necessarily the same page; compare audience, scope
and task. Do not merge different versions or platforms just to reduce page count.
Conversely, do not split a coherent answer into thin pages because the source
has many headings. Close the actual current inventory using the Route schema,
including explicit dispositions for excluded material.
