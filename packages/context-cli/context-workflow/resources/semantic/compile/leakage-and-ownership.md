---
id: context.semantic.compile.leakage-and-ownership
kind: procedure
media-type: text/markdown
applies-to:
  - ownership
  - context_only
  - support
---

# Context-only Leakage and Ownership Repair
<!-- Context workflow semantic resource. -->

Consult this reference when current compile validation or review diagnostics say
a source ref is not owned by the selected planned section, is context-only, or
belongs to another node/section.

## What The Diagnostic Means

Compile is source-bound to the confirmed structure. A section action may cite
only source refs owned by the planned section it targets. Background/context
evidence may explain the node, but it cannot become the support basis for an
active section until align confirms that ownership.

This is a hard boundary. Do not paraphrase context-only evidence, do not switch
to a looser summary, and do not add an unsourced claim to avoid the diagnostic.

## Repair Routes

Use the same three-way repair discipline as the current semantic review gate,
and express it through the current compile/align surfaces:

| Situation | Route |
|---|---|
| Another owned planned-section ref supports the same claim | Repair the compile action to cite that owned ref from the same node-context and revalidate. Do not keep the leaking ref as secondary evidence. |
| No owned evidence exists and the claim is not load-bearing for this node | Ask the user whether to leave it unwritten; if confirmed, emit a current `skip` with a business reason when the schema supports reviewed skips, or leave an align handoff note. |
| The context-only / secondary evidence contains facts this node legitimately needs | Stop compile and return to prose align. Revise `context.structure.v1` so the source refs are owned by the correct planned section, or keep an `unresolved[]` ownership issue. |
| The evidence belongs under another node | Return to prose align and move the planned section/source refs to that node, or add an unresolved structure issue. |
| The ownership problem indicates a missing relation | Return to prose align and add a source-backed typed edge or unresolved relation. |

Do not collapse the second and third rows into a generic skip. If the evidence
is load-bearing, skipping hides a structure defect; the correct long-term
repair is to reconfirm structure.

## What Not To Do

- Do not use full-text/detail views as an ownership upgrade. They expose text;
  they do not change the confirmed structure.
- Do not cite a secondary or context-only ref for active body text.
- Do not paraphrase the offending evidence while still citing it. The support
  boundary remains wrong even if the prose changes.
- Do not silently skip to clear the diagnostic; this may hide a real evidence
  gap or missing ownership decision.
- Do not switch the action to a different node, target section, or edge merely
  to dodge the ownership rule. Return to align and reconfirm the structure.
- Do not add a cross-node link inside verbatim content.
- Do not write content that depends on evidence outside the planned section.
  Return to align first.

## Self-verify

- [ ] Every active compile action cites only refs owned by its planned section.
- [ ] Ownership repairs were revalidated.
- [ ] Structure-level repairs returned to prose align.
- [ ] User-confirmed no-write was used only for non-load-bearing evidence.
- [ ] Context-only evidence was not converted into reader-facing fact text.
