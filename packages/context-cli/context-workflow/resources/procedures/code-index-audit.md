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

The report is not a numeric rejection. A signal may be a false positive, but
it may not be ignored. Every elevated signal must receive an assessment tied
to inspected content. Submit one `context.code-index-audit-decision.v1`
payload for the complete batch.

## Decisions

- `accept`: the requested scope is represented and every real content-depth,
  evidence-scope, and relationship issue is resolved. An acceptable or
  non-applicable signal needs a concrete reason.
- `revise`: one or more real problems remain. Identify the affected units and
  describe changes to scope, aggregation, sections, evidence, or structured
  handoffs. The Route returns to `src/index.ts`, Preview, extraction, and a new
  audit revision.
- `request-input`: reliable revision requires material unavailable in the
  registered sources, such as an external protocol or missing source boundary.
  Ask only for that material, then submit a new decision.

## Fully managed operation

Fully managed authority does not auto-accept this audit. When a signal is a
real problem, choose `revise` and continue the revision loop without asking the
user. Repeat until the proposed index matches the requested scope and its
module maps, contracts, and handoffs contain useful source-backed explanation.
Pause only for unavailable material, source access, tool failure, or a
concrete no-progress blocker.

After each decision, briefly tell the user which decision was selected, the
affected units, and the next Graph path. Do not stop a managed run merely to
announce a successful automatic revision.
