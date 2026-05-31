---
name: skill-compile-judge
description: >
  Internal procedure invoked by `/context-compile`; not a user command. Consumes the budget-safe compile prepare summary
  and candidate detail views, judges each draft action's raw evidence support and relation to listed candidates,
  and emits a compile.judge-decisions.v2 document for `context reconcile review`.
tools:
  - Bash
---

# skill-compile-judge — judge compile support and relation

Decide whether each prepared compile item is supported by cited raw evidence
and how it relates to the candidate Sections listed by the CLI. Emit judge
decisions only; the CLI reviews, applies, and writes every workspace change.

## TL;DR — Non-negotiables

- Invoke this skill only when the active prepare summary contains `judge_handoff` or the returned diagnostics explicitly ask for compile support/relation judgment. A `review_reconcile_decisions` envelope by itself is not enough: if the command is accepting safe defaults or the remaining work is compact `{ item_id, accept_default: true }`, follow that review path instead. If the active envelope asks for `patch_compile_draft`, `continue_compile_cycle`, or another action, stop and follow that `next_action.command` instead.
- Input is the budget-safe compile prepare summary. If `page.has_more` is true, follow `next_command` until every prepare item is listed.
- The summary is an index: use `item_detail_command` only when the full proposed content, raw evidence, or source_ref details are needed.
- For items with candidates, load only that item's candidate detail view with `context workflow show --payload prepare --view candidates --item-id <item-id> --unwrap --format json`.
- Do not inspect workspace storage directly or run ad-hoc scripts to reconstruct candidates. Use only `items[]`, `evidence[]`, raw/source_ref diagnostics, `candidates[]`, `previous_decisions[]`, and `judge_handoff`.
- Output exactly one JSON or YAML document with `schema_version: "compile.judge-decisions.v2"` and `decisions[]`.
- Keep one decision per `judge_handoff.items[].item_id`, preserving prepare order. Do not emit decisions for mechanical safe-default items that the caller will pass through `--accept-safe-defaults`.
- For support, output `support_verdict: supported | weak | unsupported` plus `support_reason`.
- For relation, output `relation_verdict: new | duplicate | supersede | conflict | merge_into` plus `relation_reason`.
- Compare only the candidates listed on that item. Do not perform workspace-wide BM25, grep, or source-file searches.
- Fill `compared_section_ids` with every visible candidate Section id you inspected and set `compared_count` to the total candidate count inspected across pages. If candidates are paged, continue until `compared_count >= candidate_total` before final output.
- Escape hatch: when an item has no candidates, `relation_verdict: new` with `compared_section_ids: []` and `compared_count: 0` is valid and expected.
- For `duplicate`, `supersede`, `conflict`, or `merge_into`, set `target_section_id` to the matched candidate Section id.
- Same `source_ref` can support different Section kinds only when the semantic role differs. Detect and explain same-source-ref multi-kind cases instead of treating them as automatic duplicates.
- Raw/source_ref diagnostics are mechanical evidence checks, not a keyword gate. A supported judge verdict comes from the cited raw evidence semantically covering the claim.
- Evidence-boundary errors remain blocking evidence issues. Section kind precision, example formatting, and summary style are advisory unless the active CLI `next_action` explicitly blocks on them.
- Weak support is a warning-level verdict, not permission to invent missing facts. Unsupported support should normally pair with `conflict` or a later user question rather than a write decision.

<reference>

## Output Shape

```yaml
schema_version: "compile.judge-decisions.v2"
mode: compile
decisions:
  - item_id: claim-001
    support_verdict: supported
    support_reason: "The cited raw block explicitly states the same invoice handling behavior."
    relation_verdict: new
    relation_reason: "No listed candidate covers this claim."
    compared_section_ids: []
    compared_count: 0
```

For a relation against an existing candidate:

```yaml
schema_version: "compile.judge-decisions.v2"
mode: compile
decisions:
  - item_id: claim-002
    support_verdict: supported
    support_reason: "The cited evidence covers the correction."
    relation_verdict: supersede
    relation_reason: "section-3 states the older behavior and should be replaced."
    target_section_id: section-3
    compared_section_ids: [section-3, section-7]
    compared_count: 2
```

## Verdict Meanings

| field | value | Meaning |
|---|---|---|
| `support_verdict` | `supported` | Cited raw evidence covers the claim. |
| `support_verdict` | `weak` | The evidence plausibly supports an ordinary summary, but review may ask for confirmation. |
| `support_verdict` | `unsupported` | The claim adds facts or boundaries not present in cited raw evidence. |
| `relation_verdict` | `new` | No listed candidate already covers the proposed knowledge. |
| `relation_verdict` | `duplicate` | A listed candidate already covers the same claim. |
| `relation_verdict` | `supersede` | A listed candidate is stale or wrong and should be replaced by the new claim. |
| `relation_verdict` | `conflict` | The prepared claim and candidate disagree and need user resolution. |
| `relation_verdict` | `merge_into` | The prepared claim should update or refine one listed candidate. |

</reference>

<procedures>

### Step 1 — Load Prepare Summary And Candidate Details

Use the caller-provided compact prepare output. For every item with candidates,
load its candidate detail view before judging relation. Do not infer missing
candidates from memory or bypass the candidate detail view.

### Step 2 — Judge Support

For each item, read the proposed content and cited evidence. Use
Use raw/source_ref diagnostics only as evidence pointers; final support is your
semantic verdict from the cited raw evidence.

### Step 3 — Judge Relation

Compare the proposed claim against each listed candidate. Track every
visible candidate Section id in `compared_section_ids`, and set
`compared_count` to the total candidate count inspected across pages. If the
candidate list is empty, emit `new` with an empty compared list and
`compared_count: 0`.

### Step 4 — Emit Judge Decisions

Return only the `compile.judge-decisions.v2` document. The caller passes it
directly to `context reconcile review --decisions -`.

</procedures>
