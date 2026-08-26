---
id: procedure.document-optimization
kind: procedure
mediaType: text/markdown
---

# Source-constrained editorial revisions

This optional phase improves the publication value and readability of approved
file and document prose without mutating the approved page. It runs only when
`package.json.context.documentOptimization` is true.

Run the Route-selected plan command. Each fragment is one source-backed Context
Section and includes mechanical readability signals, allowed actions, exact
line ranges, and source identity. Read every returned Section and write one
decision for each fragment to the returned `payload_target`:

- `keep` when it is already useful and readable. If the fragment has any
  mechanical signal, include a concrete `assessment` that explains why every
  signal is a false positive or why changing the Section would reduce source
  fidelity. Name every reported signal code in that assessment so the CLI can
  verify complete coverage; do not use one generic assessment for a batch;
- `repair` for local typography, Markdown, spacing, or a descriptive link label
  whose purpose is already stated in the same Section;
- `reshape` for source-preserving structural changes such as a wide table into
  a short index plus detail entries, or a long paragraph into stable headings;
- `omit` only when the plan permits it and the selected reason matches a
  mechanically identified non-knowledge Section.

An unanswered question set, empty placeholder, decision-free draft, duplicate,
or obsolete-only Section may be omitted. Questions with answers, limitations
with impact and action, and deprecations with a replacement remain knowledge.
Mechanical signals are review leads, not a complete readability verdict. Read
every fragment even when it has no signal. A mixture of false positives and
valid repair candidates does not justify keeping the whole batch unchanged.
Every actionable signal must end in a safe edit, an eligible omission, a
batched input request, or a Section-specific explanation that the signal is a
false positive or that the edit would damage source fidelity. Time, token or
compute cost, workload, batch size, deadline, and desire to finish sooner are
never valid reasons to keep, skip, defer, or reduce an optimization. Do not
default a batch to `keep` because it contains many fragments; finish the
complete current batch with the same quality standard as a single fragment.
Signals that recommend `request-input` identify ambiguous currency, ownership,
link purpose, or sensitive values. The plan returns all of them in
`input_requests`: ask one concise, batched question and wait before applying
the complete optimization payload. Do not convert a required input into
`keep` merely to avoid a pause. Preserve the exact destination of a volatile
URL and safely improve its descriptive label or surrounding layout when the
same Section already states its purpose; ask only for information that cannot
be recovered from the approved Section or its source evidence.

In fully managed operation, apply every safe `repair`, `reshape`, and eligible
`omit` autonomously and continue until the optimization status is current.
Managed authority removes routine review pauses, not quality work or genuine
missing-input boundaries. A large repair set is expected work, not a blocker.
If an `input_requests` batch remains after completing all independently safe
analysis, ask once for that batch and resume from the returned Route.

Keep all work inside the same source Section. Preserve link destinations,
images, code, commands, numbers, identifiers, conditions, and source markers
exactly. Do not introduce facts, infer an answer, or replace a complete
contract with a summary.

After the complete payload is ready, execute the exact `next_action.command`
returned by the plan. Context rejects stale, incomplete, duplicate,
cross-Section, protected-value, semantically broad, or unexplained signaled
`keep` decisions. The assessment is used only to audit the current decision and
is not stored in approved knowledge, revisions, or package output. Unchanged
Sections reuse their previous decision; changed Sections alone return to this
phase.

Only pages with reader-visible changes are stored. A revision is a full
Markdown sidecar beside its approved page: `knowledge/guides/setup.md` becomes
`knowledge/guides/setup__revision.md`. Default knowledge discovery excludes the
reserved suffix. The filename derives the base page; the revision stores only
the base digest that cannot be derived. Unchanged Sections inside a full
revision are inferred. A page with no changes stores one derived negative cache
key below `.tmp/context-runtime/document-optimization/`; replacement prose and
Section metadata are never duplicated there. An omitted Section keeps its
lifecycle marker in the revision so its source identity remains auditable, but
its reader-visible body and all revision audit state are absent from `dist/`.

For a later user-requested correction, use `context revise "<title or approved
path>" --format json`. The resulting `route.document-revision.requested` owns
target selection, revision editing, and validation; it also works when broad
document optimization was not previously enabled. The compatibility entry
`context optimize-docs revise` accepts the same selectors. Validation rejects
lifecycle metadata changes, stale page baselines, protected-value changes,
cross-Section rewrites, unsupported omissions, and invalid Markdown structure.
A source change makes the revision a blocking conflict instead of silently
applying it. Do not create fragment JSON files or another revision namespace.
