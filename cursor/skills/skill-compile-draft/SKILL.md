---
name: skill-compile-draft
description: >
  Internal procedure invoked by `/context-compile`; not a user command. For one Node at a time, reads
  the CLI-provided `NodeContext` (planned metadata, raw snippets, and
  existing Sections if any), classifies every raw fragment into a Section
  kind via the priority chain, writes `content` + optional `summary` + `source_block_ids[]`,
  and emits a compile draft JSON document for the caller to submit to the current envelope's
  `next_action.command`.
  Activates when `/context-compile` iterates across the confirmed align plan.
tools:
  - Bash
---

# skill-compile-draft — write Section actions for one Node

Classify raw evidence for one Node into `add` / `skip` (and on refresh: `update` / `supersede` / `deprecate`) actions; emit JSON; the CLI performs every write.

## TL;DR — Non-negotiables

- One Node per invocation — `node_slug` MUST equal `node.slug`; no cross-Node writes. Finish the current Node's draft quality checks before the caller moves to another Node's review/apply loop.
- Agent emits JSON only; no markdown, no direct workspace file writes. The caller submits the JSON to the current envelope's `next_action.command`; the CLI validates and stores workflow payloads.
- Evidence boundary: treat the CLI-provided NodeContext and evidence views as complete. Cite only block ids surfaced as citation-eligible in `source-refs-index` `items[]`, `citable_source_refs[]`, or `raw_snippet_indexes.citation_eligible`; treat `supporting_context_refs[]`, `context_only`, and secondary-shared snippets as background. `request_full_text` may expose visible text for inspection through the narrow text view (`context compile context <slug> --request-full-text <block_id> --view text --format json`), and it does not change citation eligibility. If supporting/context-only evidence is needed as a citation, emit `pending_ownership_challenge` or `structure_challenge` — see [references/structural-challenges.md](references/structural-challenges.md). Never `grep` / `sed` / `jq` / `cat` / `head` raw `--format json` stdout or workflow scratch files in `/tmp` or `.context/.cache/`; use semantic views and follow returned `next_command` / `how_to_explore[]`. For write commands that take `--payload-digest`, omit the flag unless the CLI explicitly asks for a stale guard.
- Actions are candidate write actions, not final semantic decisions; `context reconcile prepare` re-derives near-duplicate / conflict / merge relations from `candidates[]` on its own. Op naming is scoped by schema: compile-draft `actions[]` already targets Sections, so Section lifecycle ops are verb-only (`add`, `update`, `supersede`, `deprecate`, `skip`). Do not use align-style names such as `add_section`, `write_section`, or `propose_section`.
- Source support passing is not completion. Before emitting, estimate coverage from the provided `raw_snippets[]`: if there are 3+ citation-eligible snippets, a one-action draft is valid only when the later snippets are duplicates, navigation, placeholders, or continuations of the same fact. Small dense docs still need multiple actions when later snippets state distinct capabilities, constraints, examples, risks, FAQ, or usage notes. Large manuals/design docs should compile to several orthogonal actions in the same draft. Do not switch into "speed mode" because the first action validates; coverage is part of the draft task.
- Pick `kind` from the CLI's `context schema compile-draft` contract, especially `section_kind_priority` and the mount matrix. First matching form wins. A `decision` needs at least two surfaced alternatives plus a reason; bare "we use X because Y" is `spec`. Reach `description` only after every more specific kind fails.
- `node.planned_sections[]` is an align-time scaffold hint, not a hard completion gate. Prefer a planned kind when the evidence fits; if a source-backed stronger kind differs, emit it and let the CLI warning guide review.
- `kind × node.type` must satisfy the CLI Section mount matrix; mismatches get rejected at write time. When the strongest kind is blocked by mount matrix, fall to the next legal kind whose form actually fits — do not collapse to `description` just because it mounts everywhere, and do not invent thin precision (e.g. one-line `spec`) just to avoid `description` either. See [Description anti-abuse gates](#description-anti-abuse-gates) for the classification checks at the description boundary.
- Every write action cites raw via `source_block_ids[]` from `source-refs-index` `items[].block_id` or `citable_source_refs[].block_id`; the CLI expands it to canonical `source_refs[]` before saving. Use explicit `source_refs[]` only when the CLI gives no block id for the needed citation. Never mix both fields in one action, fabricate ids, or cite navigation-only blocks as evidence for a content Section.
- For large source-ref views, prefer the returned `source_refs_index_command` / `source_refs_command` / `--view source-refs-index` when you only need block ids; open `source_refs_detail_command` only when you need quote preview or explicit `source_refs[]`.
- Use `content` for the Section text the reader should see. It may be long and may contain URLs, tables, commands, config, or code fences. Add `summary` for long content or when it helps readers/query output; omit it when content is short. Summary quality checks are warning hints only, not schema or evidence failures. The CLI rejects retired fields (`body`, `detail`, `raw`, singular `source_ref`, quoted-evidence) with canonical repair hints — read those hints rather than memorising the blacklist. Omit optional fields when empty.
- Preserve user-facing Markdown structure from cited raw when it carries meaning: inline code/code fences, Markdown links and URLs, blockquotes, list nesting, tables, and emphasis around key terms. Summary remains plain text; content may keep raw Markdown when that is the clearest faithful Section text.
- Preserve literals required by the CLI. When source-refs or scaffold output lists `required_preserved_literals[]`, keep those URL, code identifier, `source_ref`, or `block_id` literals visible in the relevant `content`, `summary`, skip reason, or repair challenge. Do not rely on memorized URL rules; let CLI literal fields and citation diagnostics define what must be preserved.
- `refers_to_nodes[]` only carries slugs present in the context's glossary, existing Sections, or the current align plan; never invent one.
- `skip` is the honest default when raw adds nothing. Bare `skip` (no evidence) is only for deterministic no-ops such as unchanged input, pure navigation, or context-only/background snippets. When a citation-eligible snippet was reviewed and intentionally not written, emit `skip` with `source_block_ids[]` from `source-refs-index` `items[].block_id` or `citable_source_refs[].block_id` so semantic review can record `reviewed_no_write`. Never attach `context_only` / supporting block ids to skip; raise a challenge if they should become citation evidence.
- Any Node may legitimately compile to no Sections when the provided snippets contain only navigation (`Parent` / `Children` / `Related` / `Relations`) or placeholder text that explicitly says no detailed content is available. Emit `skip`; do not turn align summaries, parent/child lists, sibling links, or placeholders into `description` Sections. The align graph and Node metadata preserve structure; active Sections need citation-eligible content.
- FAQ collections attach to the most specific finalized Node (Entity → Action → Domain fallback); never create a standalone FAQ container.
- Output language: Node-facing summaries and user-facing draft explanations follow `NodeContext.generation_policy.language` when present; otherwise match the raw material. Section `summary` may follow either the workspace language or the source-bound `content` language; do not rewrite it only to switch languages. Draft `content` is source-bound: prefer the cited source language when it differs from the workspace language, and do not translate quoted English facts into Chinese just to satisfy workspace language. Preserve product names, code identifiers, CLI flags, slugs, `block_id` / `source_ref` tokens, and exact quoted evidence as printed. Kind / confidence / identifier fields stay English.
- Stable output: keep action order aligned with evidence order — that ordering is the only stability concern the CLI cannot enforce. The CLI rejects unknown fields (timestamps, random ids, host/scratch paths) and canonicalises stored payloads; fixed rules and schema come from this skill, so only the current NodeContext should vary between repeated Node draft calls.

## Edge cases — consult references when:

| Condition | Reference |
|---|---|
| `node.type` is `action` or `domain` | [references/action-domain-gates.md](references/action-domain-gates.md); use `node.action_gate` (including `trigger_blocks`) and treat `node.domain_gate` as grouping metadata |
| any `raw_snippets[].source_type` is `"note"` | [references/notes.md](references/notes.md) |
| `existing.sections[]` non-empty, **or** `incremental.status` is `unchanged` / `full-context`, **or** `incremental.locator_only_changes[]` non-empty | [references/refresh-and-update.md](references/refresh-and-update.md) |
| evidence implies missing Action / wrong parent / `depends_on` gap / ownership upgrade from `context_only` or secondary-shared | [references/structural-challenges.md](references/structural-challenges.md) |

If none of the above hold, you are on the main path (first compile of an entity Node with default `changed-only` incremental status). The procedure below covers that path end-to-end.

<reference>

## Input — `NodeContext`

Canonical shape: `context schema node-context --format yaml` (or `--format json`). The CLI is the source of truth for fields, enums, and produced-by paths.

Boundary recap (rules not captured by the schema enums):

- `mentions[]` are raw positions that named this Node; `raw_snippets[]` are the wider context blocks around those positions, or the changed raw blocks selected by `context compile scan`. These two arrays are the evidence floor — never reach outside them.
- `node.sources[]` are the only sources that may be cited as `src-N`. `node.context_sources[]` contribute `raw_snippets[]` for comparison or background only and must not be cited unless the CLI has also placed that source in `node.sources[]`.
- `source_id` is the source registry id (e.g. `local:billing`); `src-N` aliases only appear inside `source_ref` strings. Prefer `source-refs-index` `items[].block_id` or `citable_source_refs[].block_id` in draft `source_block_ids[]`; if you must use explicit `source_refs[]`, copy `raw_snippets[].source_ref` verbatim.

## Output — Compile Draft JSON (main path)

Canonical shape: `context schema compile-draft --format yaml` (or `--format json`). The CLI is the source of truth for fields, enums, and validation — do not memorise the shape from this file.

Main-path ops are **`add`** and **`skip`**. A typical new Section action is `{ op: "add", kind: "<chain-picked>", content: "...", source_block_ids: ["<block_id>"] }`; never spell that as `add_section` because the `actions[]` array already names the target object. A bare skip is `{ op: "skip", reason: "..." }`; a reviewed-no-write skip carries `source_block_ids[]` only from citation-eligible `source-refs-index` `items[].block_id` or `citable_source_refs[].block_id`.

Minimal valid draft envelope:

```json
{
  "schema_version": "compile.draft.v2",
  "node_slug": "<matches node.slug>",
  "actions": []
}
```

`update` / `supersede` / `deprecate` ops live in [references/refresh-and-update.md](references/refresh-and-update.md). `structure_challenge` / `pending_ownership_challenge` ops live in [references/structural-challenges.md](references/structural-challenges.md). Do not emit them from the main path.

`source_block_ids[]` is a mechanical shorthand over the same citation-eligible evidence; a single citation is still a single-element array. When one Section summarises contiguous multi-block evidence, list only the block ids the `content` actually consumes. If using explicit `source_refs[]`, copy them verbatim from `raw_snippets[].source_ref`. If the CLI reports `compile-source-refs-auto-narrowed`, it safely reduced an over-wide citation; removed refs are still uncovered, so add separate actions for distinct knowledge or leave them to an evidence-carrying `skip`. Preserve raw wording in `content` when it is already clear. Preserving a cited prose/bullet list as the Section's user-facing content is allowed when that list is the actual knowledge; the anti-pattern is copying raw text only as traceability or lexical-score padding. For `example` Sections that cite command / config / code fences, include the relevant fenced block in `content`.

## Section Kind Choice

Use `context schema compile-draft --view minimal --format json` (or yaml) for the current legal kind list, priority order, and mount matrix. This skill adds only semantic guardrails:

- Stop at the first kind whose source-backed form fits.
- Do not choose `description` to hide lists, rules, tables, samples, risks, choices, or Q+A evidence that has a more precise kind.
- When the strongest kind is not mountable on this Node type, choose the next legal kind that the evidence truly supports, or `skip` with a structural challenge reason.

Confidence is optional. Omit it for ordinary confirmed claims; set it only when the evidence is clearly verified, inferred, or speculative according to the schema enum.

## Description anti-abuse gates

`description` is the kind for narrative claims that do not match any other form. Before locking in `kind: description` for a snippet, run three classification checks against the cited block:

1. **Atomicity**: single narrative, or multi-step / multi-row / multi-config? Multi → split into the right kinds — each step into its own `spec` / `warning`, each row into a `comparison` Section, each config block into `example` (sample) or `spec` (constraint with a check method).
2. **Kind-precision**: does a higher-priority kind fit better? A code / config / command block belongs in `example`; a comparison table belongs in `comparison`; a Q+A pair belongs in `faq`; a real incident with timeline belongs in `incident`; a versioned change record belongs in `changelog`; a multi-option choice (≥ 2 surfaced candidates + rationale) belongs in `decision`; a verifiable rule with a check method belongs in `spec`; explicit risks belong in `warning`; a stable design rule or core mechanism without surfaced alternatives or check method belongs in `principle`.
3. **Action threshold**: multi-step fragments that clear the Action bar → emit `op: skip` with a note "evidence warrants sub-Action; re-align needed"; do not create Nodes from this skill.

A Node whose raw is genuinely narrative — definitions, summaries, plain prose without enumerations or normative wording — legitimately ends with description-dominant output. The smell fires the other way: when raw contained enumerations, normative rules, or code blocks, and the draft collapsed them to `description`. Redraft from Step 2 in that case, not from a percentage threshold. Navigation-only evidence is handled separately by the TL;DR navigation rule and Step 2 — the gates above are not the right place to second-guess that path.

## Glossary and `refers_to_nodes`

When raw mentions a name that overlaps the workspace glossary, put that name's slug in `refers_to_nodes[]` for the Section that discusses it — do NOT substitute it into the prose. This preserves explicit cross-Node references for query answers and citations without rewriting the claim. Slugs come from existing Sections, the context glossary, or Nodes already declared by the current align plan; never invent one. A Section can reference multiple Nodes (common on `comparison` / `decision`).

If the CLI returns `compile-missing-refers-to-node`, treat it as advisory: add the suggested slug only when the Section actually depends on that Node; otherwise leave the draft unchanged and rely on the cited `source_ref`.

If the CLI returns source-ref narrowing, candidate hard-fact, summary quality, or low-coverage advisories with `agent_recommended_action: ignore`, do not patch solely to satisfy the advisory. Patch only when the cited source actually loses meaning, a confirmed hard fact is unsupported, or the returned `next_action` asks for a draft patch.

## FAQ attachment priority

| FAQ topic | Attach to |
|---|---|
| About a concrete thing | That thing's Entity (Section `faq`) |
| About a mechanism or term | The matching Entity |
| About an action / flow | That Action |
| Cross-topic / generic workspace FAQ | Domain (fallback only) |

Never manufacture a FAQ container Node. If a FAQ cluster grows too large, a sub-Entity is the correct escape hatch; flag it in `decisions.notes` for a re-align pass.

</reference>

<procedures>

### Step 1 — Sanity-check the context

Confirm `node.slug` is set; abort if not. Note `node.type` — it caps legal kinds per the CLI Section mount matrix.

Check edge case conditions from the routing table at the top of this skill. If any apply, read the relevant reference **before** continuing. The references explain how their conditions modify Step 1 / Step 2 / Step 3.

Estimate coverage from the provided `raw_snippets[]` before writing actions. Treat "the first quote is supported" as only a validation result, not a completion signal.

Use the CLI-provided citation-eligible snippets and diagnostics as the coverage contract. Distinct source-backed facts should become distinct actions or evidence-carrying skips; duplicates, navigation-only blocks, placeholders, and unsupported fragments can be skipped. If later CLI diagnostics report low coverage, repair the same draft through the returned `next_action`.

### Step 2 — Classify each raw snippet

For each `raw_snippets[]` entry:

1. If the snippet only contains navigation or placeholder evidence (`Parent` / `Children` / `Related` / `Relations`, sibling links, "no detailed content", etc.), emit `skip`. Do not create a Section whose content is just "Children: ..." or "Related: ..." and do not summarize facts that are not present in the snippet.
2. Pick kind using [Section Kind Choice](#section-kind-choice); stop at the first kind whose trigger fires.
3. Verify the kind against the mount matrix for `node.type`. Mismatch → pick the next legal kind down the chain, or emit `skip` with a reason pointing at a better Node. Never "fall through to description" just to place evidence.
4. If you land on `description`, walk the [Description anti-abuse gates](#description-anti-abuse-gates). Any gate fires → split or `skip`.

For dense documents, group nearby snippets by their `block_locator_id` heading prefix and write one action per coherent fact group. Repeated `#` headings inside one source are often internal chapters of the current Node; keep them as Sections unless the raw evidence establishes a separate durable Node identity.

### Step 3 — Build actions

For each classified snippet:

1. Write `content` as the Section text the reader should see. It can include long prose, URLs, tables, command/config/code fences, or short raw wording. Keep one coherent, cited fact group per action.
2. Keep `content` faithful to the cited raw terms: do not introduce acronyms, abbreviations, translations, or aliases that do not appear in the cited raw snippet unless raw itself defines the equivalence or the user confirms it later during semantic review.
   - Default to raw wording. Only make semantic-preserving edits for formatting, typo fixes, casing, entity/alias consistency, or sentence cleanup. If the raw text is already clear, `content` should equal the raw text.
   - Preserve meaningful Markdown formatting from the cited raw: inline code markers, fenced blocks, Markdown link targets, blockquote markers, nested list structure, tables, and emphasis on key terms. Do not flatten these into plain prose unless the formatting is purely decorative.
   - `source_support` is advisory lexical diagnostics, not the final semantic judge or a keyword gate. Do not stuff raw text into `content` just to raise matched-term counts, and do not patch a clear draft only to satisfy a lexical term mismatch.
   - There is no separate default `evidence-echo` warning. Treat "echo" as an anti-pattern: raw copied only to show basis/evidence, while `source_ref` already provides traceability.
   - For `description` / `spec`, a concise summary plus the cited bullet list is acceptable when the bullets are the useful user-facing knowledge. It becomes echo only when the copied text is not meant to be read as active knowledge.
   - For `example` Sections that cite a code, config, or command fence, keep `content` centered on the cited fenced block. Put framing prose such as "basic configuration example" in `summary`, or cite a separate prose block in a separate action when that prose is itself source-backed knowledge.
3. For long `content`, add `summary` when it helps readers or query output. Summary is LLM-authored reader/query aid: one plain paragraph, no Markdown, and should stay compact. The CLI only reports advisory hints for missing summaries on long content, Markdown/multi-paragraph formatting, or clearly overlong summaries; it does not enforce a content-length ratio and does not treat summary quality as an evidence failure. Lexical `source_support` checks `content` (and legacy `detail` when present), not `summary`; keep summaries faithful to `content`, but do not copy raw-only keywords into `summary` for lexical scoring.
4. Preserve `required_preserved_literals[]` from the CLI evidence view. For link-heavy citation-eligible evidence, keep the listed URLs in `content` when the action writes knowledge; for supporting-only literals, keep them in the repair/challenge context instead of citing them.
5. Omit `confidence` for ordinary confirmed claims. Assign it only when the evidence is clearly verified, inferred, or speculative according to the schema enum.
6. Fill `refers_to_nodes[]` per [Glossary and refers_to_nodes](#glossary-and-refers_to_nodes).
7. Cite evidence with `source_block_ids[]`, picking values from `source-refs-index` `items[].block_id` or `citable_source_refs[].block_id`. When one Section summarizes contiguous multi-block evidence, list only the block ids consumed by that Section content; the CLI expands and verifies that the refs can collapse to one canonical citation token and may auto-narrow over-wide citations. If the evidence is non-contiguous or contains separable claims, split the draft into separately cited actions instead of stretching one action across unrelated blocks. For `skip`, include `source_block_ids[]` only when the skip represents reviewed no-write material from citation-eligible evidence; omit evidence for purely deterministic no-ops, navigation, and context-only/background snippets. Never submit singular `source_ref`, mix `source_block_ids` with `source_refs`, or use quoted-evidence fields; the CLI rejects them.

Rendered knowledge starts with optional `c4a:summary`, then the active `content`. If `content` differs from the cited raw, the CLI may render a debug-only `c4a:raw` block for audit; agents must not emit `raw`.

### Step 4 — Emit the JSON

Emit one compile draft JSON document for the caller to submit to the current envelope's `next_action.command`. No markdown wrapper, no leading prose, no trailing commentary.

Before returning, ensure `schema_version` is `compile.draft.v2`, `node_slug` matches `node.slug`, fields conform to `context schema compile-draft`, `required_preserved_literals[]` are preserved or carried into an evidence-backed skip/repair challenge, and NodeContext was the only evidence source.

</procedures>
