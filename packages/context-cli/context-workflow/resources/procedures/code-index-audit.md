---
id: procedure.code-index-audit
kind: procedure
mediaType: text/markdown
---

# Code-index Agent audit

This Route is a required semantic review of the complete proposed code index.
The CLI reports mechanical signals; the Agent reads the affected candidate
content and evidence, compares registered sources with the user-confirmed
scope, and decides whether the index is fit for its declared output profiles.
Reader metrics exclude Context lifecycle comments and evidence annotations.
Improve the source-backed knowledge itself; do not change Markdown syntax,
sentence count, or pagination solely to influence a mechanical counter.
The complete inventory is evidence, not the default reader-facing output. Do
not create one sentence, bullet, table row, or page for every discovered file
or symbol merely to satisfy coverage or density. Group related identities by a
reader-visible capability, entrypoint, protocol boundary, lifecycle stage, or
handoff, then explain the group's responsibility, stable inputs and outputs,
state or failure boundary when applicable, next handoff, and exact supporting
sources. A granular catalog is appropriate only for a declared public API,
protocol, or command reference.

When the report shows low density, add source-backed explanation or a complete
relationship chain. Never add repeated `Observed ...` rows. When symbol
coverage is low, use a verified evidence-backed group or a profile-appropriate
catalog instead of copying the inventory into prose. Normalized template
repetitions do not count as semantic facts, and enumeration-heavy output has a
profile-specific ceiling.

Identity groups and chain candidates are mechanical contracts, not optional
notes. A group counts only when its members belong to the target inventory, its
source files belong to the eligible inventory, and its reader-facing page cites
those files. Every chain candidate must be documented, merged into a documented
candidate, excluded with a concrete reason, or routed to missing-material input.
For each discovered external boundary family, retain a representative
source-backed chain or an explicit material gap.
When the boundary inventory contains adjacent families such as operation and
handler, handler and downstream, command and effect, event and processor, or a
cross-source handoff, the adapter must return the corresponding candidate
family. Returning an empty candidate list does not bypass chain review.

The report contains no aggregate score. Every dimension is computed
independently with its observed value, floor, recommended target, ceiling,
mechanical score, uncovered identities, and legal repair actions. A dimension
outside its absolute bounds cannot be accepted or offset by another strong
dimension. Every elevated signal must receive an assessment tied to inspected
content. Submit one `context.code-index-audit-decision.v1` payload for the
complete batch.

Read the complete inventory before deciding. It separates eligible and
analyzed files/LOC, read documents, target and exported symbols, stable entries,
protocol boundaries, exclusions, and parser gaps. For each failed or
below-target dimension, use the returned uncovered identities, affected pages,
recommended template resources, and action vocabulary. Do not replace those
facts with an inferred file list.

For custom adapters, file and symbol identity arrays are complete denominators,
not samples: their lengths must match the declared counts, analyzed identities
must belong to eligible identities, and exported identities must belong to the
target-symbol set. For a single-source unit, the CLI independently enumerates
the represented language families plus Markdown/MDX after declared exclusions;
an adapter cannot make its ratio pass by reporting only hand-picked evidence
files. Conventional sibling page entries, Go route-register calls, and exported
operations from a declared Go handler source of truth are also independently
enumerated; include every discovered identity in the target-symbol and boundary
denominators even when one aggregate page explains them. Section evidence may
contain multiple files and may overlap
another Section when one fact crosses a boundary. It must not be reduced to one
arbitrary primary file, and every Section must not repeat the complete page
evidence set merely to satisfy coverage. Distinct structured relationships must
cite the concrete evidence for their own handoff instead of repeating one whole
page evidence set across every destination.

## Decisions

- `accept`: the requested scope is represented, every dimension is within its
  absolute bounds, and every real content-depth, evidence-scope, template, and
  relationship issue is resolved. A below-target dimension remains visible
  and needs a concrete reason in ordinary operation.
- `revise`: one or more real problems remain. Identify the affected units and
  describe changes to scope, aggregation, sections, evidence, or structured
  handoffs. The Route returns to `src/index.ts`, Preview, extraction, and a new
  audit revision.
- `request-input`: reliable revision requires material unavailable in the
  registered sources, such as an external protocol or missing source boundary.
  Ask only for that material, then submit a new decision.

## Fully managed operation

Fully managed authority does not bypass the audit. When an absolute dimension
fails, choose a returned repair action and continue through configuration,
Preview, extraction, and audit without asking the user. Aim for the recommended
target instead of stopping immediately at the floor. The retry ledger is bound
to unit, source revision, profile, and problem fingerprint; superficial wording
changes do not reset it. After three unsuccessful revisions of the same
problem, Context combines all affected modules into one human-guidance Gate.
Pause earlier only for unavailable material, source access, or missing parser
capability.

After each decision, briefly tell the user which decision was selected, the
affected units, and the next Graph path. Do not stop a managed run merely to
announce a successful automatic revision.

The current `context.code-index-audit-report.v2` is computed from proposed or
approved knowledge. Only its decision receipt and compact retry metrics stay
under `.tmp/context-runtime/code-index-audit/`. Package output records only the
selected report digest and decision; page metrics, exclusions, template
fingerprints, and repair history are never published.
