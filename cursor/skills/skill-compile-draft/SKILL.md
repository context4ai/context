---
name: skill-compile-draft
description: >
  Internal procedure invoked by `/context-compile`; not a user command. For one Node at a time, reads
  the CLI-provided `NodeContext` (planned metadata, raw snippets, and
  existing Sections if any), classifies every raw fragment into a Section
  kind via the priority chain, writes `body` + `source_refs[]`,
  and emits a compile draft JSON document. The CLI
  validates the actions via `context compile --draft <slug> --input - --plan`.
  Activates when `/context-compile` iterates across the confirmed align plan.
tools:
  - Bash
---

# skill-compile-draft — write Section actions for one Node

Classify raw evidence for one Node into `add / update / supersede /
deprecate / skip` actions; emit JSON; the CLI performs every write.

## TL;DR — Non-negotiables

- One Node per invocation — `target_node` MUST equal `node.slug`; no cross-Node writes. Finish the current Node's draft quality checks before the caller moves to another Node's review/apply loop.
- Agent emits JSON only; no markdown, no direct workspace file writes. The caller passes the JSON to `context compile --draft <slug> --input - --plan --prepare`; the CLI stores workflow payloads. `--save-input` is only for an explicit debug scratch copy.
- Default compile sends changed-only NodeContext. Treat `raw_snippets[]` as the complete evidence boundary; never use direct workspace file tools to expand it.
- Use `raw_snippet_indexes.citation_eligible` as the citeable evidence set; `raw_snippet_indexes.context_only` and every secondary shared snippet are background only. `request_full_text` may expose full secondary text for inspection, but it does not make that snippet citation-eligible. If a secondary shared block is needed as evidence, emit `pending_ownership_challenge` or `structure_challenge`; do not cite it. If the NodeContext is too large and only citation handles are needed, ask the caller to use `context compile --source-refs <slug> --format json` and cite from `citation_refs[]`; do not slice the saved NodeContext with ad-hoc scripts.
- Do not use Python, Node.js, shell scripts, `ls`, `find`, `rg`, `cat`, or similar ad-hoc commands to inspect or preprocess `WORKSPACE_DIR`, `.context`, NodeContext scratch files, or `/tmp` workflow artifacts.
- If `incremental.status` is `full-context`, draft from the full fallback and preserve the `unknown_inputs[]` reasons in any abort/retry explanation.
- The CLI may deterministically skip unchanged output or update locator-only evidence before writing. Do not force rewrites to bypass fingerprint skip.
- `incremental.locator_only_changes[]` entries have `agent_action: "none"` and `handled_by: "compile-close"`; do not emit draft actions for those Sections unless the same Section also has a real `changed_blocks[]` content change.
- Actions are candidate write actions, not final semantic decisions. If raw appears similar to existing knowledge, add only a `reconcile_hint`; the semantic reconcile procedure may ignore it.
- For `node.type: "action"`, use `node.action_gate` as the compile boundary. Actor, goal/outcome, repeatability, answerability, trigger, step, and phase claims must come from cited `raw_snippets[]` or structured `action_gate.inference_sources`; if `trigger_blocks` is empty, do not invent a trigger.
- For `node.type: "domain"`, treat `node.domain_gate` as grouping metadata only. It can explain why child Nodes belong under the Domain, but it is not evidence for a Section unless the same fact appears in citation-eligible raw snippets.
- Note snippets are captured conversation material. `raw_snippets[].note_intent`, `anchored_to[]`, and `revision_kind` are prioritization hints only: they may suggest update / supersede / complement / skip, but they never authorize a write without semantic review.
- Source support passing is not completion. Before emitting, estimate coverage from the provided `raw_snippets[]`: if there are 3+ citation-eligible snippets, a one-action draft is valid only when the later snippets are duplicates, navigation, placeholders, or continuations of the same fact. Small dense docs still need multiple actions when later snippets state distinct capabilities, constraints, examples, risks, FAQ, or usage notes. Large manuals/design docs should compile to several orthogonal actions in the same draft. Do not switch into "speed mode" because the first action validates; coverage is part of the draft task.
- Pick `kind` from the form of the cited raw block: code / config / command sample → `example`; verifiable rule with a check method → `spec`; stable invariant, design rule, or core mechanism → `principle`; ≥2 subjects × ≥2 dimensions → `comparison`; explicit risk or caveat → `warning`; Q+A pair → `faq`; real incident with timeline → `incident`; versioned change record → `changelog`. Reach `description` only when none of those forms fit — narrative that defines an entity, explains a mechanism, or summarises a stance. First matching form wins.
- `kind × node.type` must satisfy the CLI Section mount matrix; mismatches get rejected at write time. When the strongest kind is blocked by mount matrix, fall to the next legal kind whose form actually fits — do not collapse to `description` just because it mounts everywhere, and do not invent thin precision (e.g. one-line `spec`) just to avoid `description` either. See [Description anti-abuse gates](#description-anti-abuse-gates) for the classification checks at the description boundary.
- Every write action cites raw via `source_refs[]`, choosing values from `raw_snippets[].source_ref`. Use a single-element array for one citation. Treat each source ref as an opaque citation token; never fabricate, parse, dereference, or cite navigation-only blocks as evidence for a content Section.
- Use one `body` field for Section prose. It may be long and may contain fenced code. Do not emit internal Section fields or retired extractive-contract fields; the CLI derives its internal short claim/detail split before validation.
- Set `rewrite: false` only when the raw wording is already clear and should be preserved; omit it for normal concise rewriting.
- For `example` Sections, if the cited raw snippet contains command / config / code fences, include the short summary and the relevant fenced block together in `body`; do not collapse copyable examples into prose-only summaries unless semantic review asks the user and the user accepts that compression.
- Preserve documentation/reference URL blocks. If a cited raw block is primarily links (官网 / docs / reference / related links), create a small `description` Section such as "相关链接" and keep every URL in `body`; do not drop link-only evidence just because it is not prose.
- For `add`, `update`, and `supersede.new`, omit optional fields when empty; never emit `detail: null`.
- `refers_to_nodes[]` only carries slugs present in the context's glossary, existing Sections, or the current align plan; never invent one.
- `supersede` is for semantic replacement; `update` is for typo / wording fixes; `deprecate` needs a `reason`; `skip` is the honest default when raw adds nothing.
- If a note or raw snippet was reviewed and should intentionally not write active knowledge, emit `skip` with `source_refs[]` from that exact snippet. This lets semantic review record `reviewed_no_write`; a bare skip is only for deterministic no-op cases such as unchanged input or navigation-only context.
- Any Node may legitimately compile to no Sections when the provided snippets contain only navigation (`Parent` / `Children` / `Related` / `Relations`) or placeholder text that explicitly says no detailed content is available. Emit `skip`; do not turn align summaries, parent/child lists, sibling links, or placeholders into `description` Sections. The align graph and Node metadata preserve structure; active Sections need citation-eligible content.
- FAQ collections attach to the most specific finalized Node (Entity → Action → Domain fallback); never create a standalone FAQ container.
- Output language: draft `body`, Node-facing summaries, and user-facing draft explanations follow `NodeContext.generation_policy.language` when present; otherwise match the raw material. Preserve product names, code identifiers, CLI flags, slugs, `block_id` / `source_ref` tokens, and exact quoted evidence as printed. Kind / confidence / identifier fields stay English.
- Stable output: keep action order aligned with evidence order, keep object fields in the documented schema order, omit empty optional fields, and do not add current timestamps, random ids, scratch paths, or host paths. Fixed rules and schema come from this skill; only the current NodeContext should vary between repeated Node draft calls.

<reference>

## Input — `NodeContext`

```jsonc
{
  "node": {
    "slug": "...", "type": "entity|action|domain",
    "tags": [...], "title": "...",
    "sources": ["..."], "aliases": ["..."], "summary": "...",
    "planned_sections": ["spec", "..."],
    "action_gate": {
      "actor_blocks": ["2f4b8c1e9a03"],
      "trigger_blocks": [],
      "goal_blocks": ["c0d4e5f61728"],
      "step_blocks": ["8b9a0c1d2e3f"],
      "outcome_blocks": ["4e2d1c0b9a88"],
      "repeatability_or_plan_blocks": ["9d1e2f3a4b5c"],
      "inference_sources": {
        "actor": { "source_type": "explicit-block", "evidence_blocks": ["2f4b8c1e9a03"], "rationale": "..." },
        "outcome_or_goal": { "source_type": "explicit-block", "evidence_blocks": ["c0d4e5f61728"], "rationale": "..." },
        "repeatability_or_plan": { "source_type": "explicit-block", "evidence_blocks": ["9d1e2f3a4b5c"], "rationale": "..." },
        "answerability": { "source_type": "ref-node", "ref_nodes": ["..."], "rationale": "..." }
      }
    },
    "domain_gate": {
      "scope_blocks": ["7a6f4c9d2e10"],
      "child_refs": ["..."],
      "grouping_reason": "..."
    }
  },
  "generation_policy": {
    "language": "Chinese",
    "source": "workspace.language",
    "applies_to": ["node.title", "node.summary", "section.content", "section.detail", "user_facing_report"],
    "instruction": "Generate knowledge titles, summaries, Section content/detail, and user-facing reports in Chinese; preserve product names, code identifiers, CLI flags, block_id/source_ref tokens, slugs, and quoted evidence exactly when needed."
  },
  "existing": {               // present if the Node already exists
    "sections": [
      { "id": "section-1", "kind": "description", "content": "...",
        "detail": "...", "status": "active|deprecated",
        "confidence": "...", "source_ref": "src-1#anchor L10-14@7a6f4c9d2e10",
        "refers_to_nodes": [...] }
    ]
  },
  // Default NodeContext does not expose raw file paths. Copy raw_snippets[].source_ref
  // into draft source_refs[]; copy CLI-provided block_id only for ownership challenges.
  "mentions":      [ { "line": 12, "quote": "...", "source_id": "local:billing", "block_locator_id": "h2-api" } ],
  "raw_snippets":  [ { "line": 10,
                       "line_range": [10, 18],
                       "source_ref": "src-1#api L10-18@7a6f4c9d2e10",
                       "quote": "...context block...",
                       "mention_quote": "...",
                       "source_type": "local|feishu|note",
                       "source_id": "local:billing",
                       "note_intent": "revision|decision|brainstorm",
                       "anchored_to": [{ "node_slug": "...", "section_id": "section-1" }],
                       "revision_kind": "replace|clarify|...",
                       "block_locator_id": "h2-api",
                       "block_hash": "sha256:...",
                       "change_status": "changed" } ],
  "incremental": {
    "mode": "changed-only",
    "status": "changed-only|full-context|unchanged",
    "reason": "source_block_changed|unknown-input|first-compile",
    "changed_blocks": [ { "status": "changed", "source_id": "local:billing", "block_locator_id": "h2-api" } ],
    "locator_only_changes": [ { "source_id": "local:billing", "agent_action": "none", "handled_by": "compile-close", "affected_sections": ["section-3"] } ],
    "unknown_inputs": [ { "scope": "compile-changes", "reason": "section-fingerprints-missing" } ]
  }
}
```

`mentions` = raw positions that named this Node. `raw_snippets` =
wider context blocks around those positions, or the changed raw blocks
selected by `context compile --scan-changes`. Never reach outside these —
they are the evidence floor.
`source_id` is the source registry id, such as `local:billing`; `src-N`
aliases only appear inside `source_ref` strings.
When `source_type` is `note`, the snippet came from `context capture --note`.
Use `note_intent`, `anchored_to[]`, and `revision_kind` to decide which
existing Section to compare first. They are routing hints, not proof that the
note should be written as active knowledge.
`node.sources[]` are the only sources that can be cited as `src-N`.
`node.context_sources[]` may contribute `raw_snippets[]` for comparison or
background, but they are context-only and must not be cited unless the CLI has
also placed that source in `node.sources[]`.
`node.action_gate` is present only for finalized Action Nodes. Use it to avoid
inventing process semantics: write triggers only when `trigger_blocks` or cited
raw explicitly provide them; write actor / outcome / repeatability claims only
from cited raw or the matching structured `inference_sources` entry. If
`answerability` depends on `ref_nodes`, use `refers_to_nodes[]` or a local link
hint instead of describing another Node's internals.
`node.domain_gate` is present only for finalized Domain Nodes. It is grouping
metadata for scope and children; do not turn `grouping_reason` into a Section
unless citation-eligible raw snippets state the same claim.

## Output — Compile Draft JSON

```jsonc
{
  "schema_version": "compile.draft.v2",
  "target_node": "<matches node.slug>",
  "actions": [
    { "op": "add", "kind": "spec",
      "body": "...",
      "rewrite": false,
      "refers_to_nodes": ["..."],
      "source_refs": ["src-1#api L10-14@7a6f4c9d2e10"]
    },
    { "op": "update", "target_section_id": "section-3",
      "body": "...",
      "refers_to_nodes": null,
      "source_refs": ["src-1#api L18-21@c0d4e5f61728"] },
    { "op": "supersede", "target_section_id": "section-5",
      "reason": "raw published a new retention value",
      "new": { "kind": "spec", "body": "...",
               "refers_to_nodes": ["..."],
               "source_refs": ["src-1#limits L30-34@9d1e2f3a4b5c"] } },
    { "op": "deprecate", "target_section_id": "section-2", "reason": "..." },
    { "op": "skip", "reason": "no new evidence in raw snippets" },
    { "op": "skip", "reason": "reviewed; intentionally not written",
      "source_refs": ["src-1#note L4-8@7a6f4c9d2e10"] },
    { "op": "structure_challenge",
      "challenge_id": "ch_0001",
      "kind": "missing_action_node",
      "node_slug": "<matches node.slug>",
      "action_tag": "rollout-runbook",
      "summary": "The cited evidence is a repeatable procedure.",
      "source_ref": "src-1#ops L40-55@c0d4e5f61728",
      "reason": "Align must review structure before compile writes process prose." },
    { "op": "structure_challenge",
      "challenge_id": "ch_0002",
      "kind": "wrong_shared_block_split",
      "node_slug": "<matches node.slug>",
      "unresolved_target": "rollout-runbook",
      "reason": "The finalized shared block split leaves this Node with only secondary, non-citable evidence." },
    { "op": "pending_ownership_challenge",
      "challenge_id": "och_0001",
      "node_slug": "<matches node.slug>",
      "block_id": "2f4b8c1e9a03",
      "requested_role": "shared",
      "reason": "A visible context_only or secondary shared block contains facts that need citation." }
  ]
}
```

`source_refs[]` values are copied from `raw_snippets[].source_ref`; a single
citation is still written as a single-element array. Submitting singular
`source_ref` or quoted-evidence fields is rejected with canonical repair hints.
Every Section write (`add`, `update` with body/source refs, and
`supersede.new`) uses `body`. Keep one coherent fact group per action; when
one Section summarizes contiguous multi-block evidence, list every relevant
source ref in order under `source_refs[]`.
`structure_challenge` and `pending_ownership_challenge` do not write Sections;
the CLI stores them as workflow payloads and close exposes them as debt until
align resolution handles them. Supported structure challenge kinds include
`missing_action_node`, `extra_action_node`, `wrong_shared_block_split`,
`missing_depends_on_edge`, and `wrong_parent`.

Optional `reconcile_hint` shape for any action:

```jsonc
{
  "reconcile_hint": {
    "suggested_relation": "exact_duplicate|near_duplicate|complement|conflicts|keep_separate",
    "suggested_action": "duplicate_skip|merge_update|keep_separate|ask_user",
    "similar_section_id": "section-3",
    "confidence": 0.72,
    "reason": "The new snippet is close to the existing sandbox isolation Section."
  }
}
```

Hints are recall/explanation aids only. The final relation/action must come
from `context reconcile prepare` candidates and semantic reconcile decisions.

## Confidence rubric

Four legal values; pick per raw evidence strength.

| `confidence` | When |
|---|---|
| `verified` | Raw shows the fact already happened or held — recorded run output, observed metric value, incident timestamp, benchmark result, or explicit "ran X, got Y" log. Executable form alone is not enough; without execution evidence, downgrade to `confirmed`. |
| `confirmed` | Raw states the fact in normative voice or as a documented spec / config / example, without showing the run that confirmed it. This is the default for code blocks, configuration samples, feature lists, and design rules. |
| `inferred` | You combined ≥2 raw fragments into a load-bearing conclusion that no single fragment states. |
| `speculative` | Raw only hints; the Section is a best-effort reading that may not survive review. |

Don't game the rubric. Compile-close flags Nodes dominated by `speculative` Sections, and a Node whose Sections are uniformly `verified` despite raw containing only specs / samples is the symptom of a misread rubric, not strong evidence.

## Description anti-abuse gates

`description` is the kind for narrative claims that do not match any other form. Before locking in `kind: description` for a snippet, run three classification checks against the cited block:

1. **Atomicity**: single narrative, or multi-step / multi-row / multi-config? Multi → split into the right kinds — each step into its own `spec` / `warning`, each row into a `comparison` Section, each config block into `example` (sample) or `spec` (constraint with a check method).
2. **Kind-precision**: does a higher-priority kind fit better? A comparison table belongs in `comparison`; a verifiable rule belongs in `spec`; a stable design rule, core mechanism, or "X is the key to Y" claim belongs in `principle`; a code / config / command block belongs in `example`; explicit risks belong in `warning`; a Q+A pair belongs in `faq`; a real incident with timeline belongs in `incident`.
3. **Action threshold**: multi-step fragments that clear the Action bar → emit `op: skip` with a note "evidence warrants sub-Action; re-align needed"; do not create Nodes from this skill.

A Node whose raw is genuinely narrative — definitions, summaries, plain prose without enumerations or normative wording — legitimately ends with description-dominant output. The smell fires the other way: when raw contained enumerations, normative rules, or code blocks, and the draft collapsed them to `description`. Redraft from Step 2 in that case, not from a percentage threshold.

Navigation-only exception: if a Node's evidence is only a child list, relation navigation, sibling link, parent pointer, or placeholder wording, emit `skip`. The Node remains useful through align graph edges, `## Contains` / `## Related`, and metadata; a navigation-only snippet is not evidence for a `description` claim. The Node `summary` is metadata for context and listings, not a Section or a required lead paragraph.

## Glossary and `refers_to_nodes`

When raw mentions a name that overlaps the workspace glossary, put
that name's slug in `refers_to_nodes[]` for the Section that discusses
it — do NOT substitute it into the prose. This preserves explicit
cross-Node references for query answers and citations without rewriting
the claim. Slugs come from existing Sections, the context glossary, or Nodes already declared by the current align plan; never invent one. A
Section can reference multiple Nodes (common on `comparison` /
`decision`).
If the CLI returns `compile-missing-refers-to-node`, treat it as advisory:
add the suggested slug only when the Section actually depends on that Node;
otherwise leave the draft unchanged and rely on the cited `source_ref`.

## Supersede vs update

| Situation | op |
|---|---|
| Same meaning, fixing typo / tightening prose / adding detail | `update` — same `section-N` stays active |
| New rule replaces old rule (values / policy / spec changed) | `supersede` — old flips to `deprecated`; new gets fresh `section-N+k` |
| Old rule removed without replacement | `deprecate` (with `reason`) |

`supersede` preserves the audit trail so readers see the prior
policy — critical for specs / decisions / principles.

## FAQ attachment priority

| FAQ topic | Attach to |
|---|---|
| About a concrete thing | That thing's Entity (Section `faq`) |
| About a mechanism or term | The matching Entity |
| About an action / flow | That Action |
| Cross-topic / generic workspace FAQ | Domain (fallback only) |

Never manufacture a FAQ container Node. If a FAQ cluster grows too large, a
sub-Entity is the correct escape hatch; flag it in `decisions.notes`
for a re-align pass.

</reference>

<procedures>

### Step 1 — Sanity-check the context

Confirm `node.slug` is set; abort if not. Note `node.type` — it caps legal kinds per the CLI Section mount matrix. If `existing.sections[]` is non-empty, read it; you need `section-N` ids for update / supersede / deprecate.
If `incremental.status` is `unchanged`, emit one `skip` action. If it is `full-context`, continue with the full context but keep the fallback reason visible in any user-facing explanation.
Estimate coverage from the provided `raw_snippets[]` before writing actions. Treat "the first quote is supported" as only a validation result, not a completion signal.

If `node.type` is `action`, inspect `node.action_gate` before classification:

- `step_blocks` / `phase_blocks` / cited step snippets can produce `spec` or `example` Sections for procedure content.
- `actor_blocks`, `goal_blocks`, `outcome_blocks`, and `repeatability_or_plan_blocks` can support concise `description` / `spec` Sections when the same source refs are citation-eligible.
- Empty `trigger_blocks` means no trigger was finalized; write goal or applicability if supported, but do not add a trigger sentence.
- `inference_sources.answerability.ref_nodes` should become `refers_to_nodes[]` when the current Section depends on those Nodes; do not summarize those Nodes' facts here.

If `node.type` is `domain`, inspect `node.domain_gate` only to understand scope and child grouping. It does not authorize new Section facts by itself.

Coverage self-check:

1. Count citation-eligible, non-navigation snippets and group them by `block_locator_id` heading prefix.
2. For 3-11 such snippets, read each snippet once. If later snippets are distinct facts, emit separate actions before moving to the next Node. Do not stop after one supported description just because the file is short.
3. For roughly 12+ citation-eligible snippets or 5+ distinct locator areas, plan multiple Sections in this single draft. Large manuals/design docs usually need several orthogonal actions.
4. This is not a quota: skip duplicates, navigation-only blocks, placeholders, and unsupported fragments. The goal is coverage of distinct source-backed knowledge, not maximum Section count.
5. If `context reconcile prepare` returns `compact-source-low-coverage` or `dense-source-low-coverage`, revise the same draft to cover the suggested uncovered evidence candidates before review/apply. Do not treat those warnings as ignorable polish.

### Step 2 — Classify each raw snippet

For each `raw_snippets[]` entry:

1. If `source_type` is `note` and `anchored_to[]` names this Node or Section, compare it against the target first. A revision/decision note usually becomes `update`, `supersede`, `add` as complement, or `skip`; do not create a new Node from the note title here. If the note says not to modify active knowledge yet, or the correct outcome is no-write after review, use `skip` with `source_refs[]` containing the note's `raw_snippets[].source_ref` so the semantic ledger can record it as reviewed.
2. If the snippet only contains navigation or placeholder evidence (`Parent` / `Children` / `Related` / `Relations`, sibling links, "no detailed content", etc.), emit `skip`. Do not create a Section whose content is just "Children: ..." or "Related: ..." and do not summarize facts that are not present in the snippet.
3. Walk the Section kind priority chain from the TL;DR classification rule; stop at the first kind whose trigger fires.
4. Verify the kind against the mount matrix for `node.type`. Mismatch → pick the next legal kind down the chain, or emit `skip` with a reason pointing at a better Node. Never "fall through to description" just to place evidence.
5. If you land on `description`, walk the [Description anti-abuse gates](#description-anti-abuse-gates). Any gate fires → split or `skip`.

For dense documents, group nearby snippets by their `block_locator_id` heading prefix and write one action per coherent fact group. Repeated `#` headings inside one source are often internal chapters of the current Node; keep them as Sections unless the raw evidence establishes a separate durable Node identity.

### Step 3 — Reconcile with existing Sections

For each existing Section:

- Raw still supports it unchanged → emit nothing (or one summarising `skip`).
- Raw clarifies or rephrases without changing meaning → `update`.
- Raw changes meaning (new spec value, reversed decision) → `supersede`.
- Raw removes supporting evidence → `deprecate` with `reason`.

### Step 4 — Build actions

For each change from Steps 2-3:

1. Write `body` as the Section text the reader should see. It can include long prose, URLs, tables, command/config/code fences, or short raw wording. Keep one coherent, cited fact group per action; the CLI derives the internal `content`/`detail` split.
2. Keep `body` faithful to the cited raw terms: do not introduce acronyms, abbreviations, translations, or aliases that do not appear in the cited raw snippet unless raw itself defines the equivalence or the user confirms it later during semantic review. Use `rewrite: false` when preserving raw expression is the least surprising representation.
3. If the cited block contains documentation/reference URLs, preserve them in `body`. Link-only blocks are still useful knowledge; use `kind: description` with a concise "相关链接" identity when no more specific kind applies.
4. Omit `confidence` for ordinary confirmed claims. Assign `confidence` per the [Confidence rubric](#confidence-rubric) only when the evidence is not confirmed.
5. Fill `refers_to_nodes[]` per [Glossary and refers_to_nodes](#glossary-and-refers_to_nodes).
6. Cite evidence with `source_refs[]`, picking values from `raw_snippets[].source_ref`. When one Section summarizes contiguous multi-block evidence, list every relevant source ref in order under `source_refs[]`; the CLI verifies that the refs can collapse to one canonical citation token. If the evidence is non-contiguous or contains separable claims, split the draft into separately cited actions instead of stretching one action across unrelated blocks. For `skip`, include `source_refs[]` only when the skip represents reviewed no-write material; omit evidence for purely deterministic no-ops such as unchanged input. Never submit singular `source_ref` or quoted-evidence fields; the CLI rejects them.
7. If evidence implies a missing Action, missing `depends_on`, wrong parent, or
   needed ownership upgrade from `context_only`, emit the corresponding
   challenge action instead of forcing the content into a Section.
   `pending_ownership_challenge.requested_role` is `owned` or `shared`.

Rendered knowledge uses a CLI-derived short claim as the visible blockquote and
renders longer supporting material from `body` as collapsed Details when needed.
A reader should be able to understand the Section from the short claim first;
long supporting material is active knowledge, not a hidden evidence copy.

### Step 5 — Emit the JSON

Emit one compile draft JSON document for the caller to pass to `context compile --draft <slug> --input - --plan --prepare`. No markdown wrapper, no leading prose, no trailing commentary.

### Step 6 — Self-verify

- [ ] `target_node` equals `node.slug` — if not, **Step 5**.
- [ ] Every `add` / `supersede.new` has a legal kind × type combination — if not, **Step 2**.
- [ ] Every action's `source_refs[]` entries appear in `raw_snippets[].source_ref` for this NodeContext, and no action carries singular `source_ref` or quoted-evidence fields — if not, **Step 4**; pick the right source ref, split non-contiguous claims, or use `skip` only when raw has no write-worthy fact.
- [ ] Every Section write uses `body` and cites `source_refs[]`; no action uses `content`, `detail`, singular `source_ref`, extractive-contract fields, or quoted-evidence fields — if not, **Step 4**.
- [ ] Short, readable, single-line evidence was not rewritten just for style. If it is already clear, keep the raw wording in `body` and set `rewrite: false` — if not, **Step 4**.
- [ ] `body` does not add new hard terms, acronyms, abbreviations, translations, URLs, code literals, versions, or aliases absent from the cited raw snippet — if it does, either use the raw wording, move the extra explanation into a user-confirmed decision later, or **Step 4**.
- [ ] No action contains `detail` or `content` — use `body` instead.
- [ ] No `description` action that would fail the anti-abuse gates — if any, **Step 2**.
- [ ] Every citation-eligible raw URL block is either preserved in a Section or intentionally skipped with evidence and reason; if not, **Step 4**.
- [ ] Dense raw material was not collapsed into one broad Section. If `raw_snippets[]` spans many locator areas and only one write action exists, return to **Step 2** unless the remaining snippets are duplicates, navigation-only, or already covered by existing Sections.
- [ ] Every `update` / `supersede` / `deprecate` targets a known `section-N` — if not, **Step 3**.
- [ ] `refers_to_nodes[]` only contains slugs from `existing` / glossary / current align plan — if not, **Step 4**.
- [ ] When the Node ended description-dominant, verify raw was genuinely narrative (no enumerations, no normative wording, no code/config blocks). If raw contained any of those forms and they were collapsed to `description`, redo classification from **Step 2**. Do not invent unsupported precision Sections for ratio reasons.
- [ ] When raw adds nothing, exactly one `op: skip` with a reason; not `actions: []`.
- [ ] When raw only has navigation/placeholder evidence, use `skip`; do not add a low-value Section from `Parent` / `Children` / `Related` / `Relations` lines.
- [ ] When `skip` means "reviewed but intentionally not written", it includes `source_refs[]` from the relevant note/raw snippet so review can persist no-write status.
- [ ] Changed-only context was not expanded by direct workspace reads — if any were used, restart from the CLI-provided NodeContext.
- [ ] No Read / Glob / Grep / Write was used against `WORKSPACE_DIR` — if any, restart from the CLI-provided NodeContext.
- [ ] No ad-hoc script or shell file traversal was used against `WORKSPACE_DIR`, `.context`, or `/tmp` workflow artifacts — if any, restart from the CLI-provided NodeContext.

</procedures>
