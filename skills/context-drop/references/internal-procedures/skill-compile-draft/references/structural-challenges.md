# Structural and ownership challenges

Consult this reference when the cited evidence **cannot be written as a Section under the current align structure**:

- The evidence describes a coherent process that should be its own `action` Node (not a Section here).
- The evidence implies a missing `depends_on` edge between Nodes.
- The evidence belongs under a different parent Node.
- A finalized shared-block split leaves this Node with only secondary, non-citable evidence.
- A visible `context_only` or secondary-shared block contains facts that need citation, requiring an ownership upgrade.

In these cases, do **not** force the content into a Section. Emit a challenge action instead; the CLI stores it as a workflow payload and compile-close exposes it as debt until an align resolution handles it.

## When to challenge vs. when to skip

| Situation | Action |
|---|---|
| Evidence is a repeatable procedure with steps that clearly warrant a sub-Action | `structure_challenge` with `kind: missing_action_node` |
| Evidence depends on a Node that the current align graph does not link to this Node | `structure_challenge` with `kind: missing_depends_on_edge` |
| Evidence belongs under a different parent | `structure_challenge` with `kind: wrong_parent` |
| A finalized shared block split removed all primary evidence from this Node | `structure_challenge` with `kind: wrong_shared_block_split` |
| The Node should not exist (its evidence belongs elsewhere) | `structure_challenge` with `kind: extra_action_node` |
| A `context_only` or secondary-shared block holds facts this Node needs to cite | `pending_ownership_challenge` with `requested_role: "shared"` or `"owned"` |

Supported `structure_challenge.kind` values: `missing_action_node`, `extra_action_node`, `wrong_shared_block_split`, `missing_depends_on_edge`, `wrong_parent`.

`pending_ownership_challenge.requested_role` is `owned` (the Node should be sole author) or `shared` (the Node should join an existing owners list).

## Required fields

```jsonc
{
  "op": "structure_challenge",
  "challenge_id": "ch_0001",
  "kind": "missing_action_node",
  "node_slug": "<matches node.slug>",
  "action_tag": "rollout-runbook",
  "summary": "The cited evidence is a repeatable procedure.",
  "source_ref": "src-1#ops L40-55@c0d4e5f61728",
  "reason": "Align must review structure before compile writes process prose."
}
```

```jsonc
{
  "op": "structure_challenge",
  "challenge_id": "ch_0002",
  "kind": "wrong_shared_block_split",
  "node_slug": "<matches node.slug>",
  "unresolved_target": "rollout-runbook",
  "reason": "The finalized shared block split leaves this Node with only secondary, non-citable evidence."
}
```

```jsonc
{
  "op": "pending_ownership_challenge",
  "challenge_id": "och_0001",
  "node_slug": "<matches node.slug>",
  "block_id": "2f4b8c1e9a03",
  "requested_role": "shared",
  "reason": "A visible context_only or secondary shared block contains facts that need citation."
}
```

Different `kind` values demand different sub-fields. The CLI returns `agent_hints[].correct_shape` on shape errors; follow that hint rather than guessing.

## What these are NOT

- **Not a substitute for `skip`** when raw simply has no write-worthy fact for this Node.
- **Not a Section.** Challenges never appear in active knowledge; they only travel through workflow state.
- **Not a free upgrade path.** `request_full_text` may expose visible evidence text for inspection, but it does not change citation eligibility. If you need to cite secondary content, emit `pending_ownership_challenge` — do not paraphrase the secondary content into a Section.

## How this slots into the main procedure

- **Step 3 — Build actions**: when evidence implies a missing Action, missing `depends_on`, wrong parent, or needed ownership upgrade, emit the corresponding challenge instead of writing a Section.
- **Step 5 — Self-verify**: no Section write cites a `context_only` or secondary-shared block; if any did, replace the Section with a `pending_ownership_challenge`.
