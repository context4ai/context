# Candidate Resolution Rules

Use these rules after reading candidate ledger and aggregate payloads, before `align-structure-decision`.

## Anomaly Signals

`anomaly_signals[]` are mechanical warnings. Do not ignore them and do not treat them as recommendations.

For each anomaly, choose one outcome and record the reasoning in either the next ledger op rationale, the final node summary/audit warning, or `unresolved[]`:

| Outcome | Use When |
|---|---|
| `accept` | The anomaly points to a real correction. Apply a concrete op or final structure choice. |
| `dismiss` | The warning is mechanically true but semantically harmless. Keep the candidate and state why. |
| `unresolved` | The warning changes structure but the source evidence is insufficient. Add an unresolved question instead of guessing. |

Known anomaly kinds:

| Kind | Meaning | Required Handling |
|---|---|---|
| `missing_evidence` | An active candidate has no evidence block. | Add evidence, reject the candidate, or mark the structure unresolved. |
| `ledger_churn` | A candidate was renamed, merged, superseded, or rejected during discovery. | Confirm the final title/slug/target or mark unresolved if the shape is still ambiguous. |
| `duplicate_block` | The same evidence block appears more than once on a candidate. | Dedupe the evidence or explain why repeated evidence is harmless. |
| `general_review_recommended` | The CLI collapsed more than eight anomalies. | Review the affected candidate broadly; do not finalize solely from aggregate ordering. |

## Label Hints

For `merge_into`, `supersede`, and `reject`, include the visible label hint fields:

- `source_label_hint` and `target_label_hint` for `merge_into`
- `source_label_hint` and `target_label_hint` for `supersede`
- `candidate_label_hint` for `reject`

These hints are for audit and Agent DX. Copy them from ledger labels/titles when available. Do not invent a label that contradicts the visible candidate.

## `llm_slug_hint` And Refs

Use `llm_slug_hint` as the stable reference inside one `align-structure-decision` payload when final slugs may be normalized by the CLI.

Recommended pattern:

```yaml
nodes:
  - llm_slug_hint: local:data-region
    slug: data-region
    node_type: entity
    tags: [term]
  - llm_slug_hint: local:failover
    contains_parent_ref: local:data-region
edges:
  - edge_type: depends_on
    from_ref: local:failover
    to_ref: local:data-region
sections:
  - owner: local:data-region
block_ownership:
  - owners: [local:data-region]
```

Refs may point to `llm_slug_hint` or final `slug`; prefer `*_ref` fields when a schema provides them. If the CLI rejects an unknown ref, use the returned `agent_hints[].available_node_refs` and resubmit a corrected `align-structure-decision`.
