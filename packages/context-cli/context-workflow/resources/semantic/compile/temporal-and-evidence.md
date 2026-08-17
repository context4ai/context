---
id: context.semantic.compile.temporal-and-evidence
kind: procedure
media-type: text/markdown
applies-to:
  - temporal
  - source_ref
  - stale
  - evidence_boundary
---

# Temporal Priors and Evidence Boundary Pointers
<!-- Context workflow semantic resource. -->

Consult this reference when current compile or review diagnostics mention:

- source capture time, stale evidence, or temporal-prior context;
- source-ref boundary problems;
- long `summary` text that may be lost during repair;
- command, config, URL, table, or code-fence evidence.

## Temporal Priors

Temporal information explains context; it does not authorize a write by itself.

- It can explain why previous approved content may need review.
- It cannot prove a replacement, conflict resolution, or deletion without
  source-backed evidence.
- It must not change the default semantic route by itself. A newer capture time
  can justify asking a stale-source question; it cannot by itself prove that the
  newer wording supersedes older approved knowledge.
- It is never enough on its own to auto-merge, auto-replace, auto-deprecate, or
  auto-skip a claim.
- It should appear in user-facing rationale only when it helps the user decide a
  concrete conflict or stale-source question.

Do not copy temporal metadata into compile actions unless the current schema
explicitly accepts that field.

## Evidence Boundary Repair

When a diagnostic says a source ref is invalid, stale, too narrow, too broad, or
owned by the wrong section, repair with current CLI views only:

- use canonical `source_refs[]` from `node-context`, `source-index`,
  `span-detail`, or `span-text`;
- treat nearby refs, line ranges, chunk ids, or headings returned by diagnostics
  as repair hints, not automatic broadening permission;
- broaden a range only when the entire broader range supports the final claim;
- split the claim when different sentences require unrelated refs;
- return to prose align when the needed evidence belongs to another planned
  section, node, or relation.

Do not invent line ranges, copy stale refs from unrelated payloads, or cite navigation
text as support for a substantive claim.

After broadening, narrowing, or splitting evidence boundaries, re-run the
current validate/review route before staging or applying. A source ref that is
plausible to the agent is not accepted until the CLI revalidates it against the
committed snapshot.

## Summary Preservation And Reader Body Boundary

Current compile actions do not author reader-facing body text. The CLI
materializes approved bodies by mirroring validated source refs. Treat summary
as the only LLM-authored prose field in compile actions:

- `summary` is recall/query aid; it must stay faithful to the action.
- If the cited source can be mirrored directly, prefer omitting `content` and
  letting the CLI materialize verbatim.
- Preserve source-backed URLs, tables, command/config/code fences, identifiers,
  numbers, and named entities by mirroring the source span or splitting the
  section. Do not compress them into compile-written content.
- Do not add `content` or `content_intent` to repair a boundary problem. The
  current parser rejects those fields. If a source range cannot be mirrored,
  split the section, choose a different source ref, or return to align.
- Do not use summary as a substitute for source-backed reader body.
- Clearing a summary is an explicit choice. If the current schema exposes a
  summary field and the previous action had one, carry it forward unless the
  repair deliberately removes it.

## Self-verify

- [ ] Temporal context was not used as sole evidence.
- [ ] Every repaired ref came from a current CLI evidence view.
- [ ] Summary was preserved unless a current rule justified changing it.
- [ ] No `content`, `content_intent`, or rewrite-route field was added to a
  compile action.
- [ ] Any broadened or split evidence boundary was revalidated before staging or
  review apply.
- [ ] No temporal metadata leaked into a schema that does not accept it.
