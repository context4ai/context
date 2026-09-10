# Section editorial policy

Apply editorial decisions to one source-backed Section at a time. A signal is a
review lead with a recommended outcome; it is not authority to change facts,
cross Section boundaries, or discard evidence. Preserve exact links, code,
commands, identifiers, numbers, conditions, attachments, and source meaning.

The Agent owns scenario interpretation and content assessment. Context checks
structured inputs, source references, protected values and safe writes; it does
not infer content quality from words, punctuation, Markdown layout or table size.
The catalog below is review guidance, not a CLI scanner or readiness checklist.
Suspected unfilled placeholders may be mentioned during the existing Review;
they do not create another gate or require a rewrite to make a counter pass.

## Signal catalog

| Signal | Meaning in the current Section | Confidence | Recommended outcome | Eligible omission reason |
| --- | --- | --- | --- | --- |
| `unanswered-question-set` | Multiple reader questions have no answer, decision, or next action. | `review` | `omit` only when the Section is only the unresolved question set; otherwise separate the supported material. | `unanswered-question` |
| `answered-question-set` | Multiple questions already have source-backed answers. | `review` | `reshape` as a concise FAQ without deleting answers. | none |
| `empty-table-row` | A reader-visible table row carries no value. | `high` | `repair` the table structure. | none |
| `placeholder-content` | The Section contains only placeholder material. | `high` | `omit` the non-knowledge Section. | `empty-or-placeholder` |
| `wide-table` | A table combines many columns with complex cells. | `high` | `reshape` into a short index and evidence-preserving details. | none |
| `long-table-cell` | A table cell contains prose that no longer works as a lookup value. | `high` | `reshape` without summarizing away facts. | none |
| `raw-or-unlabeled-link` | A destination is shown without a descriptive reader label. | `high` | `repair` the label or surrounding sentence while preserving the destination exactly. | none |
| `adjacent-links` | Neighboring links do not explain their relationship. | `high` | `repair` the separator or labels without changing destinations. | none |
| `volatile-query-url` | A destination appears session-, signature-, token-, or time-bound. | `review` | `request-input` unless current evidence proves a stable destination or the signal is a false positive. | none |
| `strikethrough-only-block` | The Section contains only obsolete-looking struck-through material and no replacement. | `review` | `omit` when it has no continuing historical reader value. | `obsolete-without-replacement` |
| `brainstorm-without-decision` | Proposals or open considerations appear without a recorded decision. | `review` | `omit` only the decision-free draft; do not infer an answer. | `draft-without-decision` |
| `duplicate-fragment` | Equivalent reader-visible content already has a canonical source-backed representation. | `high` | `omit` the duplicate only after authority, lifecycle, and meaning are proved equivalent. | `duplicate-content` |
| `unstable-owner-reference` | The Section appears to depend on a named individual rather than a durable responsibility. | `review` | `request-input`, or `keep` only when Section evidence proves the label is a stable role and the signal is a false positive. | none |
| `sensitive-value-candidate` | Authorized evidence contains a credential-shaped or sensitive value candidate. | `review` | `request-input`; never reproduce a secret-like example in guidance or output. | none |
| `heading-hierarchy-invalid` | Heading levels do not form a valid reader hierarchy. | `high` | `repair` headings without changing Section meaning. | none |
| `heading-content-overloaded` | A heading contains link inventory or body content. | `high` | `repair` by moving details into the Section body. | none |
| `markdown-syntax-damaged` | Reader Markdown is structurally incomplete or malformed. | `high` | `repair` the syntax before publication. | none |
| `conversion-artifact` | Source-conversion annotations remain reader visible. | `high` | `omit` only the conversion residue. | `conversion-artifact` |
| `mixed-facts-and-draft` | Stable statements and unresolved draft material are mixed together. | `review` | `reshape` to preserve supported facts and isolate the unresolved part. | none |

Compact tables, answered limitations with impact and action, deprecations with
a current replacement, and historical evidence with continuing reader value
are knowledge. Do not omit them merely because a nearby signal name appears to
fit. File length, page count, deadline, or effort never changes the outcome.

## Outcomes

- `keep`: use when the Section already serves its reader, including when a
  suggested edit would damage source fidelity. The presence of a signal name
  does not require an assessment or prevent keeping the Section.
- `repair`: make a local presentation correction without changing facts or
  protected values.
- `reshape`: reorganize the same supported material without broadening,
  narrowing, or summarizing away its evidence.
- `omit`: remove only an explicitly eligible non-knowledge fragment with the
  exact omission reason supplied by the plan.
- `request-input`: pause for information that cannot be recovered from the
  authorized Section or evidence view. It is an outcome, not a silent `keep`.

Resolve safe actions across the complete current workset. A large batch is not
a reason to default to `keep`, skip a Section, or lower the quality standard.
In managed operation, complete every independently safe action without adding a
routine review pause. Managed authority does not lower these rules and does not
turn genuinely missing input into `keep`; ask once for the remaining batched
input after completing the independent analysis.

## Content assessment

A Section-specific assessment can explain an editorial choice when useful; it
is not a required signal-clearing receipt. Either confidence label is advisory.
There is no CLI post-revision prose rescan, required keyword, or automatic
failure for retaining a signal. Decide from source meaning and the reader task;
keep legitimate examples, placeholders being documented, and historical facts.
Protected-value and reference checks remain mechanical safeguards.

## Anonymous decision examples

- Two unanswered planning questions with no decision: choose `omit` with
  `unanswered-question`; never invent the answers.
- Two source-backed question/answer pairs: choose `reshape` into an FAQ and
  retain both answers and their evidence.
- A compact two-column lookup table: choose `keep`; width alone is not a
  `wide-table` signal.
- A five-column table containing long links and prose: choose `reshape` into an
  index plus details while preserving destinations and values.
- `Owner: platform-operations` where the same Section defines that string as a
  durable role: `keep` may be justified with
  `unstable-owner-reference: false-positive because the source defines a stable responsibility`.
- A signed or expiring destination with no stable replacement in evidence:
  choose `request-input`; do not copy its sensitive query value into the
  assessment.
- A current rule followed by an undecided proposal: choose `reshape`, retain
  the rule, and isolate the proposal rather than omitting the whole Section.
- Struck-through text that is the only surviving historical record may be kept
  when it has continuing reader value; no signal-specific receipt is required.

Before returning a decision, confirm every Section has one outcome and no
revision accidentally changes authority, evidence, identity, or protected values.
