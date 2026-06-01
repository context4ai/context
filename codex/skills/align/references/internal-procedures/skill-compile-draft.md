---
name: skill-compile-draft
description: >
  Packaged skill invoked by `/context:compile`; not a user slash command. For one Node at a time, reads
  the CLI-provided `NodeContext` (planned metadata, raw snippets, and
  existing Sections if any), classifies every raw fragment into a Section
  kind via the priority chain, writes source-bound actions with `kind`,
  optional `summary` / `content`, and `source_block_ids[]`,
  and emits a compile draft JSON document for the caller to submit to the current envelope's
  `next_action.command`.
  Activates when `/context:compile` iterates across the confirmed align plan.
tools:
  - Bash
---

# skill-compile-draft — write Section actions for one Node

Classify raw evidence for one Node into `add` / `skip` (and on refresh: `update` / `supersede` / `deprecate`) actions; emit JSON; the CLI performs every write.

## TL;DR — Non-negotiables

- One Node per invocation — `node_slug` MUST equal `node.slug`; no cross-Node writes. Finish the current Node's draft quality checks before the caller moves to another Node's review/apply loop.
- Agent emits JSON only; no markdown, no direct workspace file writes. The caller submits the JSON to the current envelope's `next_action.command`; the CLI validates and stores workflow payloads.
- Evidence boundary: treat the CLI-provided NodeContext and evidence views as complete. Cite only block ids surfaced as citation-eligible in `source-refs-index` `items[]`, `citable_source_refs[]`, or `raw_snippet_indexes.citation_eligible`; treat `supporting_context_refs[]`, `context_only`, and secondary-shared snippets as background. `request_full_text` may expose visible text for inspection through the narrow text view (`context compile context <slug> --request-full-text <block_id> --view text --format json`), and it does not change citation eligibility. If supporting/context-only evidence is needed as a citation, emit `pending_ownership_challenge` or `structure_challenge` — see [skill-compile-draft/references/structural-challenges.md](skill-compile-draft/references/structural-challenges.md). Never `grep` / `sed` / `jq` / `cat` / `head` raw `--format json` stdout or workflow scratch files in `/tmp` or `.context/.cache/`; use semantic views and follow returned `next_command` / `how_to_explore[]`. For write commands that take `--payload-digest`, omit the flag unless the CLI explicitly asks for a stale guard. When an explicit digest is needed, use `context workflow show --payload <name> --digest-only --format text`; do not parse JSON stdout to recover it.
- Actions are candidate write actions, not final semantic decisions; `context reconcile prepare` re-derives near-duplicate / conflict / merge relations from `candidates[]` on its own. Op naming is scoped by schema: compile-draft `actions[]` already targets Sections, so Section lifecycle ops are verb-only (`add`, `update`, `supersede`, `deprecate`, `skip`). Do not use align-style names such as `add_section`, `write_section`, or `propose_section`.
- Citation validation passing is not completion. Before emitting, estimate coverage from the provided `raw_snippets[]`: if there are 3+ citation-eligible snippets, a one-action draft is valid only when the later snippets are duplicates, navigation, placeholders, or continuations of the same fact. Small dense docs still need multiple actions when later snippets state distinct capabilities, constraints, examples, risks, FAQ, or usage notes. Large manuals/design docs should compile to several orthogonal actions in the same draft. Do not switch into "speed mode" because the first action validates; coverage is part of the draft task.
- Pick `kind` from the CLI's `context schema compile-draft` contract, especially `section_kind_priority` and the mount matrix. Treat kind precision as a drafting quality preference, not a reason to loop forever when the CLI accepts the write. A `decision` fits when the source explicitly records a choice, tradeoff, adopted path, or policy conclusion with a reason; multiple surfaced alternatives are a strong signal but not required. Bare rules or checks without a recorded choice are usually `spec`. Reach `description` only after every more specific kind fails.
- `node.planned_sections[]` is an align-time scaffold hint, not a hard completion gate. Prefer a planned kind when the evidence fits; if a source-backed stronger kind differs, emit it and let the CLI warning guide review.
- `kind × node.type` must satisfy the CLI Section mount matrix; mismatches get rejected at write time. When the strongest kind is blocked by mount matrix, fall to the next legal kind whose form actually fits — do not collapse to `description` just because it mounts everywhere, and do not invent thin precision (e.g. one-line `spec`) just to avoid `description` either. See [Description anti-abuse gates](#description-anti-abuse-gates) for the classification checks at the description boundary.
- Every write action cites raw via `source_block_ids[]` from `source-refs-index` `items[].block_id` or `citable_source_refs[].block_id`; the CLI expands it to canonical `source_refs[]` before saving. Use explicit `source_refs[]` only when the CLI gives no block id for the needed citation. Multiple ids/refs in one action must be one contiguous citation-eligible run from the same source; split around any intervening citation-eligible block used by another action. Never mix both fields in one action, fabricate ids, or cite navigation-only blocks as evidence for a content Section.
- For large source-ref views, prefer the returned `source_refs_index_command` / `source_refs_command` / `--view source-refs-index` when you only need block ids; open `source_refs_detail_command` only when you need quote preview or explicit `source_refs[]`. Treat `--draft-scaffold` as a compact action skeleton for large Nodes; use returned full-text/detail commands for only the blocks an action needs.
- `content` is optional and omitted by default on source-backed writes. If the cited raw block is already the right reader-visible text, cite it with `source_block_ids[]` / `source_refs[]` and let the CLI mirror raw into content. Write `content` only for an intentional source-faithful reader-surface rewrite, such as translation, structural reorganization, or preserving a table, list, command, config, or code fence that would otherwise be unclear. Add `summary` when it helps readers/query output; summary is recall text, not evidence. The CLI rejects retired fields (`body`, `detail`, `raw`, singular `source_ref`, quoted-evidence) with canonical repair hints — read those hints rather than memorising the blacklist. Omit optional fields when empty.
- Preserve user-facing Markdown structure from cited raw when it carries meaning: inline code/code fences, Markdown links and URLs, blockquotes, list nesting, tables, and emphasis around key terms. Summary remains plain text; content may keep raw Markdown when that is the clearest faithful Section text. Do not patch solely for style cleanup unless the cited source meaning is materially lost.
- Do not synthesize a user-facing prefix by concatenating `heading_path` values (for example, `Parent - Child:`) when that prefix is not in the cited raw. Use headings only to choose grouping and framing; if a heading's wording is itself useful, keep it as sourced content only when it appears in the cited block text.
- Preserve source-backed URLs, code identifiers, `source_ref`, or `block_id` literals when they are part of the reader-facing knowledge or a repair challenge. Do not rely on memorized URL rules, and do not add literals only for scoring or traceability.
- `refers_to_nodes[]` only carries known slugs. Prefer already materialized or compiled target Nodes; in first-pass compile, skip a slug that is only known from the current align plan and not yet materialized unless the CLI explicitly surfaces it as safe or needed. Never invent a slug.
- `skip` is the honest default when raw adds nothing. Bare `skip` (no evidence) is only for deterministic no-ops such as unchanged input, pure navigation, or context-only/background snippets; empty `source_block_ids[]` / `source_refs[]` on skip is treated as bare skip. When a citation-eligible snippet was reviewed and intentionally not written, emit `skip` with `source_block_ids[]` from `source-refs-index` `items[].block_id` or `citable_source_refs[].block_id` so semantic review can record `reviewed_no_write`. Never attach `context_only` / supporting block ids to skip; raise a challenge if they should become citation evidence.
- Any Node may legitimately compile to no Sections when the provided snippets contain only navigation (`Parent` / `Children` / `Related` / `Relations`) or placeholder text that explicitly says no detailed content is available. Emit `skip`; do not turn align summaries, parent/child lists, sibling links, or placeholders into `description` Sections. The align graph and Node metadata preserve structure; narrow context-only navigation/reference blocks may be rendered later as a `References` auto-block, while active Sections still need citation-eligible content.
- FAQ collections attach to the most specific finalized Node (Entity → Action → Domain fallback); never create a standalone FAQ container.
- Output language: Node-facing summaries and user-facing draft explanations follow `NodeContext.generation_policy.language` when present; otherwise match the raw material. Section `summary` is reader/query aid: write Chinese summary prose for clearly Chinese cited evidence or mirrored content; English summary prose is acceptable for clearly English evidence; mixed technical evidence may keep concise mixed-language terms. Do not patch an already clear stored summary solely to switch language, but do not draft English prose summaries for Chinese evidence. Draft `content` is source-bound: prefer the cited source language when it differs from the workspace language, and do not translate quoted English facts into Chinese just to satisfy workspace language. Preserve product names, code identifiers, CLI flags, slugs, `block_id` / `source_ref` tokens, and exact quoted evidence as printed. Kind / confidence / identifier fields stay English.
- Stable output: keep action order aligned with evidence order — that ordering is the only stability concern the CLI cannot enforce. The CLI rejects unknown fields (timestamps, random ids, host/scratch paths) and canonicalises stored payloads; fixed rules and schema come from this skill, so only the current NodeContext should vary between repeated Node draft calls.

## Edge cases — consult references when:

| Condition | Reference |
|---|---|
| `node.type` is `action` or `domain` | [skill-compile-draft/references/action-domain-gates.md](skill-compile-draft/references/action-domain-gates.md); use `node.action_gate` (including `trigger_blocks`) and treat `node.domain_gate` as grouping metadata |
| any `raw_snippets[].source_type` is `"note"` | [skill-compile-draft/references/notes.md](skill-compile-draft/references/notes.md) |
| `existing.sections[]` non-empty, **or** `incremental.status` is `unchanged` / `full-context`, **or** `incremental.locator_only_changes[]` non-empty | [skill-compile-draft/references/refresh-and-update.md](skill-compile-draft/references/refresh-and-update.md) |
| evidence implies missing Action / wrong parent / `depends_on` gap / ownership upgrade from `context_only` or secondary-shared | [skill-compile-draft/references/structural-challenges.md](skill-compile-draft/references/structural-challenges.md) |

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

Main-path ops are **`add`** and **`skip`**. A typical new Section action is `{ op: "add", kind: "<chain-picked>", summary: "...", source_block_ids: ["<block_id>"] }`; omit `content` unless this action intentionally rewrites the cited raw for the reader. Never spell that as `add_section` because the `actions[]` array already names the target object. A bare skip is `{ op: "skip", reason: "..." }`; a reviewed-no-write skip carries `source_block_ids[]` only from citation-eligible `source-refs-index` `items[].block_id` or `citable_source_refs[].block_id`.

Minimal valid draft envelope:

```json
{
  "schema_version": "compile.draft.v2",
  "node_slug": "<matches node.slug>",
  "actions": []
}
```

`update` / `supersede` / `deprecate` ops live in [skill-compile-draft/references/refresh-and-update.md](skill-compile-draft/references/refresh-and-update.md). `structure_challenge` / `pending_ownership_challenge` ops live in [skill-compile-draft/references/structural-challenges.md](skill-compile-draft/references/structural-challenges.md). Do not emit them from the main path.

`source_block_ids[]` is a mechanical shorthand over the same citation-eligible evidence; a single citation is still a single-element array. Treat `planned_section_groups[].draft_action_templates` as the align section scaffold. Keep hard citation-gap templates separate because non-contiguous evidence cannot form one source_ref; `heading_spans` and `local_headings` are facts for your judgment, not split commands. When one Section summarises contiguous multi-block evidence, list only the block ids the action actually consumes, and only when no citation-eligible block between them belongs to another action. If using explicit `source_refs[]`, copy them verbatim from `raw_snippets[].source_ref`. Preserve raw wording in `content` when it is already clear. Preserving a cited prose/bullet list as the Section's user-facing content is allowed when that list is the actual knowledge; the anti-pattern is copying raw text only as traceability padding. For `example` Sections that cite command / config / code fences, include the relevant fenced block in `content` only when writing reader-visible content. Inline command/code spans are not fences; if the cited raw is a numbered list or prose with inline code, keep that shape and do not synthesize a ```bash``` block or shell commands.

## Section Kind Choice

Use `context schema compile-draft --view minimal --format json` (or yaml) for the current legal kind list, priority order, and mount matrix. This skill adds only semantic guardrails:

- Stop at the first kind whose source-backed form fits.
- Do not choose `description` to hide lists, rules, tables, samples, risks, choices, or Q+A evidence that has a more precise kind.
- When the strongest kind is not mountable on this Node type, choose the next legal kind that the evidence truly supports, or `skip` with a structural challenge reason.

Confidence is optional. Omit it for ordinary confirmed claims; set it only when the evidence is clearly verified, inferred, or speculative according to the schema enum.

## Description anti-abuse gates

`description` is the kind for narrative claims that do not match any other form. Before locking in `kind: description` for a snippet, run three classification checks against the cited block:

1. **Atomicity**: single narrative, or multi-step / multi-row / multi-config? Multi → split into the right kinds — each step into its own `spec` / `warning`, each row into a `comparison` Section, each config block into `example` (sample) or `spec` (constraint with a check method).
2. **Kind-precision**: does a higher-priority kind fit better? A code / config / command block belongs in `example`; a comparison table belongs in `comparison`; a Q+A pair belongs in `faq`; a real incident with timeline belongs in `incident`; ordinary "typical scenario" / case-study / impact-result examples are `example`, not `incident`, unless the source is explicitly an outage, incident review, postmortem, or dated fault-handling timeline; a versioned change record belongs in `changelog`; an explicit source-backed choice / tradeoff / adopted path with rationale belongs in `decision` even when only one chosen option is surfaced; a verifiable rule with a check method belongs in `spec`; explicit risks belong in `warning`; a stable design rule or core mechanism without a recorded choice or check method belongs in `principle`.
3. **Action threshold**: multi-step fragments that clear the Action bar → emit `op: skip` with a note "evidence warrants sub-Action; re-align needed"; do not create Nodes from this skill.

A Node whose raw is genuinely narrative — definitions, summaries, plain prose without enumerations or normative wording — legitimately ends with description-dominant output. The smell fires the other way: when raw contained enumerations, normative rules, or code blocks, and the draft collapsed them to `description`. Redraft from Step 2 in that case, not from a percentage threshold. Navigation-only evidence is handled separately by the TL;DR navigation rule and Step 2 — the gates above are not the right place to second-guess that path.

## Glossary and `refers_to_nodes`

When a Section meaningfully discusses another known Node, or should be discoverable through that Node in query/navigation, put that known slug in `refers_to_nodes[]` — do NOT substitute it into the prose. This preserves explicit cross-Node anchors for query answers and citations without rewriting the claim. Slugs come from existing Sections or the context glossary. Slugs that are only declared by the current align plan but not yet materialized are pending targets: skip them on first-pass draft unless the CLI explicitly surfaces the relationship as safe or needed. Do not remove an existing valid ref just because verify says the target is pending; continue compiling the target or let the CLI refresh renderer blocks. A Section can reference multiple Nodes (common on `comparison` / `decision`). Do not add a slug for incidental product-name mentions that add no Section-local relationship or navigation value.

If the CLI returns `compile-missing-refers-to-node`, treat it as a relation-recall check, not a style advisory. Add the suggested slug when the drafted Section text meaningfully discusses that known Node or should be discoverable through it. Omit it only for incidental mentions, code/package names inside examples, or navigation-only evidence that should remain no-write.

If the CLI returns summary quality or low-coverage advisories with `agent_recommended_action: ignore`, do not patch solely to satisfy the advisory and do not inspect every folded detail row by default. Patch only when the cited source meaning is lost, the user asks for cleanup, or the returned `next_action` asks for a draft patch.

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

1. Decide whether `content` is needed. The default for source-backed writes is no `content`: cite `source_block_ids[]` / `source_refs[]` and let the CLI mirror raw into the Section content. Add explicit `content` only when the cited raw needs an intentional reader-surface rewrite, such as translation, structural reorganization, or preserving Markdown/code/table shape that the mirror path would not express clearly. Keep one coherent, cited fact group per action.
2. When you do write `content`, keep it faithful to the cited raw terms: do not introduce acronyms, abbreviations, translations, or aliases that do not appear in the cited raw snippet unless raw itself defines the equivalence or the user confirms it later during semantic review.
   - Do not lightly rewrite same-language prose for fluency, casing, entity-name consistency, or sentence cleanup. If the raw text is already clear, omit `content` instead of writing a near-copy.
   - Preserve meaningful Markdown formatting from the cited raw when explicit `content` is necessary: inline code markers, fenced blocks, Markdown link targets, blockquote markers, nested list structure, tables, and emphasis on key terms. Do not flatten these into plain prose unless the formatting is purely decorative.
   - There is no separate default `evidence-echo` warning. Treat "echo" as an anti-pattern: raw copied only to show basis/evidence, while `source_ref` already provides traceability.
   - For `description` / `spec`, a concise summary plus the cited bullet list is acceptable when the bullets are the useful user-facing knowledge. It becomes echo only when the copied text is not meant to be read as active knowledge.
   - For `example` Sections that cite a code, config, or command fence, keep `content` centered on the cited fenced block. Put framing prose such as "basic configuration example" in `summary`, or cite a separate prose block in a separate action when that prose is itself source-backed knowledge. If the source only has prose/list text with inline code, preserve prose/list plus inline code; do not turn it into a fenced script.
3. For long `content`, add `summary` when it helps readers or query output. Summary is LLM-authored reader/query aid: one plain paragraph, no Markdown, and should stay compact. In YAML payloads, write `summary` as a plain single-line scalar; reserve literal block scalars for multi-line `content`. If you cannot write a meaningful summary, omit the field entirely; generic placeholders like "description section covering N evidence blocks" are worse than no summary. The CLI reports advisory hints for missing or weak summaries; it does not treat summary quality as an evidence failure. Keep summaries faithful to the source-backed action, but do not copy raw-only keywords into `summary` for scoring.
4. Preserve meaningful source-backed literals in `content`, `summary`, skip reason, or repair challenge when they are part of the knowledge. Do not patch only to satisfy non-blocking URL or style advisories.
5. Omit `confidence` for ordinary confirmed claims. Assign it only when the evidence is clearly verified, inferred, or speculative according to the schema enum.
6. Fill `refers_to_nodes[]` per [Glossary and refers_to_nodes](#glossary-and-refers_to_nodes).
7. Cite evidence with `source_block_ids[]`, picking values from `source-refs-index` `items[].block_id` or `citable_source_refs[].block_id`. Use CLI-provided `planned_section_groups[].draft_action_templates` as the starting scaffold; hard citation-gap templates stay separate, while heading/local-heading annotated evidence may stay together or be split by semantic knowledge unit. When one Section summarizes contiguous multi-block evidence, list only the block ids consumed by that Section action. If the evidence is non-contiguous or contains separable claims, split the draft into separately cited actions instead of stretching one action across unrelated blocks. For `skip`, include `source_block_ids[]` only when the skip represents reviewed no-write material from citation-eligible evidence; omit evidence for purely deterministic no-ops, navigation, and context-only/background snippets. Never submit singular `source_ref`, mix `source_block_ids` with `source_refs`, or use quoted-evidence fields; invalid evidence references remain blocking.

Rendered knowledge starts with optional `c4a:summary`, then the active `content`. If `content` differs from the cited raw, the CLI may render a debug-only `c4a:raw` block for audit; agents must not emit `raw`.

### Step 4 — Emit the JSON

Emit one compile draft JSON document for the caller to submit to the current envelope's `next_action.command`. No markdown wrapper, no leading prose, no trailing commentary.

Before returning, ensure `schema_version` is `compile.draft.v2`, `node_slug` matches `node.slug`, fields conform to `context schema compile-draft`, citations point only at CLI-provided evidence, and NodeContext was the only evidence source.

</procedures>
