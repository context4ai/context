---
name: skill-compile-draft
description: >
  Packaged skill invoked by `/context:compile`; not a user slash command. For one Node at a time, reads
  the CLI-provided `NodeContext` (planned metadata, raw snippets, and
  existing Sections if any), classifies every raw fragment into a Section
  kind via the priority chain, writes `content` + optional `summary` + `source_refs[]`,
  and emits a compile draft JSON document. The CLI
  validates the actions via `context compile --draft <slug> --input - --plan`.
  Activates when `/context:compile` iterates across the confirmed align plan.
tools:
  - Bash
---

# skill-compile-draft — write Section actions for one Node

Classify raw evidence for one Node into `add` / `skip` (and on refresh: `update` / `supersede` / `deprecate`) actions; emit JSON; the CLI performs every write.

## TL;DR — Non-negotiables

- One Node per invocation — `target_node` MUST equal `node.slug`; no cross-Node writes. Finish the current Node's draft quality checks before the caller moves to another Node's review/apply loop.
- Agent emits JSON only; no markdown, no direct workspace file writes. The caller passes the JSON to `context compile --draft <slug> --input - --plan --prepare`; the CLI stores workflow payloads. `--save-input` is only for an explicit debug scratch copy.
- Evidence boundary: treat `raw_snippets[]` as complete. Only `raw_snippet_indexes.citation_eligible` may be cited; `context_only` and secondary-shared snippets are background. `request_full_text` may expose full visible evidence text for inspection, but use the narrow text view (`context compile --context <slug> --request-full-text <block_id> --view text --format json`) and read `items[].text`; long blocks are paged, so follow `items[].next_command` when present. `request_full_text.pages[].text` and `raw_snippets[].quote` may mirror the same page text in full NodeContext outputs, and it does not change citation eligibility. If a secondary-shared or `context_only` block holds facts that need citation, emit `pending_ownership_challenge` or `structure_challenge` — see [skill-compile-draft/references/structural-challenges.md](skill-compile-draft/references/structural-challenges.md). Never `grep` / `sed` / `jq` / `cat` / `head` raw `--format json` stdout or workflow scratch files in `/tmp` or `.context/.cache/` to recover a token. Instead: for the digest of any workflow payload use `context workflow show --payload <name> --digest-only --format text` (prints just the digest); for substructure use explicit semantic views such as `context compile --context <slug> --view source-refs --token-budget 2000 --format json`, `context workflow show --payload node-context --view source-refs --token-budget 2000 --unwrap --format json`, or `context workflow show --payload prepare --view issues --unwrap --format json`; follow returned `how_to_explore[]` when the view is truncated. For write commands that take `--payload-digest`, omit the flag entirely and let the CLI auto-resolve the latest payload for the current workflow scope.
- Actions are candidate write actions, not final semantic decisions; `context reconcile prepare` re-derives near-duplicate / conflict / merge relations from `candidates[]` on its own. Op naming is scoped by schema: compile-draft `actions[]` already targets Sections, so Section lifecycle ops are verb-only (`add`, `update`, `supersede`, `deprecate`, `skip`). Do not use align-style names such as `add_section`, `write_section`, or `propose_section`.
- Source support passing is not completion. Before emitting, estimate coverage from the provided `raw_snippets[]`: if there are 3+ citation-eligible snippets, a one-action draft is valid only when the later snippets are duplicates, navigation, placeholders, or continuations of the same fact. Small dense docs still need multiple actions when later snippets state distinct capabilities, constraints, examples, risks, FAQ, or usage notes. Large manuals/design docs should compile to several orthogonal actions in the same draft. Do not switch into "speed mode" because the first action validates; coverage is part of the draft task.
- Pick `kind` by the [Section Kind Canon](#section-kind-canon), also exposed as `section_kind_priority` in `context schema compile-draft`. First matching form wins. A `decision` needs at least two surfaced alternatives plus a reason; bare "we use X because Y" is `spec`. Reach `description` only after every more specific kind fails.
- `kind × node.type` must satisfy the CLI Section mount matrix; mismatches get rejected at write time. When the strongest kind is blocked by mount matrix, fall to the next legal kind whose form actually fits — do not collapse to `description` just because it mounts everywhere, and do not invent thin precision (e.g. one-line `spec`) just to avoid `description` either. See [Description anti-abuse gates](#description-anti-abuse-gates) for the classification checks at the description boundary.
- Every write action cites raw via `source_refs[]`, choosing values from `raw_snippets[].source_ref`. Use a single-element array for one citation. Treat each source ref as an opaque citation token; never fabricate, parse, dereference, or cite navigation-only blocks as evidence for a content Section.
- Use `content` for the Section text the reader should see. It may be long and may contain URLs, tables, commands, config, or code fences. Add `summary` for long content or when it helps readers/query output; omit it when content is short. Summary quality checks are warning hints only, not schema or evidence failures. The CLI rejects retired fields (`body`, `detail`, `raw`, singular `source_ref`, quoted-evidence) with canonical repair hints — read those hints rather than memorising the blacklist. Omit optional fields when empty.
- Preserve documentation/reference URL blocks. If a citation-eligible raw block is primarily links (官网 / docs / reference / related links), create a small `description` Section such as "相关链接" and keep every URL in `content`; do not drop link-only evidence just because it is not prose. If the URL block is only `context_only`, keep it as background and emit an ownership/structure challenge instead of citing it.
- `refers_to_nodes[]` only carries slugs present in the context's glossary, existing Sections, or the current align plan; never invent one.
- `skip` is the honest default when raw adds nothing. Bare `skip` (no `source_refs[]`) is only for deterministic no-ops such as unchanged input or pure navigation. When a snippet was reviewed and intentionally not written, emit `skip` with `source_refs[]` from that snippet so semantic review can record `reviewed_no_write`.
- Any Node may legitimately compile to no Sections when the provided snippets contain only navigation (`Parent` / `Children` / `Related` / `Relations`) or placeholder text that explicitly says no detailed content is available. Emit `skip`; do not turn align summaries, parent/child lists, sibling links, or placeholders into `description` Sections. The align graph and Node metadata preserve structure; active Sections need citation-eligible content.
- FAQ collections attach to the most specific finalized Node (Entity → Action → Domain fallback); never create a standalone FAQ container.
- Output language: Node-facing summaries and user-facing draft explanations follow `NodeContext.generation_policy.language` when present; otherwise match the raw material. Draft `content` is source-bound: prefer the cited source language when it differs from the workspace language, and do not translate quoted English facts into Chinese just to satisfy workspace language. Preserve product names, code identifiers, CLI flags, slugs, `block_id` / `source_ref` tokens, and exact quoted evidence as printed. Kind / confidence / identifier fields stay English.
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

- `mentions[]` are raw positions that named this Node; `raw_snippets[]` are the wider context blocks around those positions, or the changed raw blocks selected by `context compile --scan-changes`. These two arrays are the evidence floor — never reach outside them.
- `node.sources[]` are the only sources that may be cited as `src-N`. `node.context_sources[]` contribute `raw_snippets[]` for comparison or background only and must not be cited unless the CLI has also placed that source in `node.sources[]`.
- `source_id` is the source registry id (e.g. `local:billing`); `src-N` aliases only appear inside `source_ref` strings — copy `raw_snippets[].source_ref` verbatim into draft `source_refs[]`.

## Output — Compile Draft JSON (main path)

Canonical shape: `context schema compile-draft --format yaml` (or `--format json`). The CLI is the source of truth for fields, enums, and validation — do not memorise the shape from this file.

Main-path ops are **`add`** and **`skip`**. A typical new Section action is `{ op: "add", kind: "<chain-picked>", content: "...", source_refs: ["src-1#... L10-14@..."] }`; never spell that as `add_section` because the `actions[]` array already names the target object. A bare skip is `{ op: "skip", reason: "..." }`; a reviewed-no-write skip carries `source_refs[]` from the cited snippet.

`update` / `supersede` / `deprecate` ops live in [skill-compile-draft/references/refresh-and-update.md](skill-compile-draft/references/refresh-and-update.md). `structure_challenge` / `pending_ownership_challenge` ops live in [skill-compile-draft/references/structural-challenges.md](skill-compile-draft/references/structural-challenges.md). Do not emit them from the main path.

`source_refs[]` values are copied verbatim from `raw_snippets[].source_ref`; a single citation is still a single-element array. When one Section summarises contiguous multi-block evidence, list only the source refs the `content` actually consumes. If the CLI reports `compile-source-refs-auto-narrowed`, it safely reduced an over-wide citation; removed refs are still uncovered, so add separate actions for distinct knowledge or leave them to an evidence-carrying `skip`. Preserve raw wording in `content` when it is already clear. Preserving a cited prose/bullet list as the Section's user-facing content is allowed when that list is the actual knowledge; the anti-pattern is copying raw text only as traceability or lexical-score padding. For `example` Sections that cite command / config / code fences, include the relevant fenced block in `content`.

## Section Kind Canon

Walk this priority chain and stop at the first form that fits:

```
example -> comparison -> faq -> incident -> changelog ->
decision -> spec -> warning -> principle -> description
```

| kind | Use when | `content` should contain | Positive / negative boundary |
|---|---|---|---|
| `example` | fenced code, config, or command sample | what the sample does plus the full snippet when useful | `<AppProvider />` sample or `bun run build`; plain "wrap with AppProvider" is `description` |
| `comparison` | at least two subjects across at least two dimensions | compared subjects, dimensions, and table/matrix | `X vs Y vs Z` table; "two options have tradeoffs" is `description`; "choose X over Y" is `decision` |
| `faq` | one explicit question-answer pair | question plus answer | Q/A block; an "X FAQ collection" is several `faq` Sections on X, not a container Node |
| `incident` | happened event with time, impact, and root cause / handling | time, severity/impact, root cause, timeline/actions | dated outage postmortem; "risk may happen" is `warning` |
| `changelog` | version/date plus change description | version, change type, migration notes if present | `v1.2.0 added X`; "X supports Y" without version is `spec` or `description` |
| `decision` | text surfaces at least two alternatives plus a reason | selected option, alternatives, reason, impact | "choose async rather than sync because..."; bare "use X because..." is `spec` |
| `spec` | verifiable behavior, threshold, default, limit, or check method | object, condition, value/constraint | retry max 3; vague "consider concurrency" is `principle` or `description` |
| `warning` | factual risk, caveat, or negative consequence | trigger condition and consequence | "without warmup first 30s timeout"; "don't change config" without consequence is too vague |
| `principle` | stable design invariant / philosophy with no check method and no choice action | invariant and reason | "single way to write UI"; retry max 3 is `spec`; "choose X over Y" is `decision` |
| `description` | fallback definition, overview, or plain narrative | definition, purpose, scope, distinction | only after the nine kinds above fail; do not use it to hide lists, rules, tables, samples, risks, or decisions |

Mount matrix:

| kind | domain | entity | action |
|---|:---:|:---:|:---:|
| `description` | yes | yes | yes |
| `spec` | no | yes | yes |
| `warning` | yes | yes | yes |
| `principle` | yes | yes | no |
| `decision` | yes | yes | yes |
| `incident` | no | yes | yes |
| `example` | no | yes | no |
| `changelog` | no | yes | no |
| `comparison` | no | yes | no |
| `faq` | yes | yes | yes |

When the strongest kind is not mountable on this Node type, choose the next legal kind that the evidence truly supports, or `skip` with a structural challenge reason. Do not force `description` just because it mounts everywhere.

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
2. **Kind-precision**: does a higher-priority kind fit better? A code / config / command block belongs in `example`; a comparison table belongs in `comparison`; a Q+A pair belongs in `faq`; a real incident with timeline belongs in `incident`; a versioned change record belongs in `changelog`; a multi-option choice (≥ 2 surfaced candidates + rationale) belongs in `decision`; a verifiable rule with a check method belongs in `spec`; explicit risks belong in `warning`; a stable design rule or core mechanism without surfaced alternatives or check method belongs in `principle`.
3. **Action threshold**: multi-step fragments that clear the Action bar → emit `op: skip` with a note "evidence warrants sub-Action; re-align needed"; do not create Nodes from this skill.

A Node whose raw is genuinely narrative — definitions, summaries, plain prose without enumerations or normative wording — legitimately ends with description-dominant output. The smell fires the other way: when raw contained enumerations, normative rules, or code blocks, and the draft collapsed them to `description`. Redraft from Step 2 in that case, not from a percentage threshold. Navigation-only evidence is handled separately by the TL;DR navigation rule and Step 2 — the gates above are not the right place to second-guess that path.

## Glossary and `refers_to_nodes`

When raw mentions a name that overlaps the workspace glossary, put that name's slug in `refers_to_nodes[]` for the Section that discusses it — do NOT substitute it into the prose. This preserves explicit cross-Node references for query answers and citations without rewriting the claim. Slugs come from existing Sections, the context glossary, or Nodes already declared by the current align plan; never invent one. A Section can reference multiple Nodes (common on `comparison` / `decision`).

If the CLI returns `compile-missing-refers-to-node`, treat it as advisory: add the suggested slug only when the Section actually depends on that Node; otherwise leave the draft unchanged and rely on the cited `source_ref`.

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

Coverage self-check:

1. Count citation-eligible, non-navigation snippets and group them by `block_locator_id` heading prefix.
2. For 3-11 such snippets, read each snippet once. If later snippets are distinct facts, emit separate actions before moving to the next Node. Do not stop after one supported description just because the file is short.
3. For roughly 12+ citation-eligible snippets or 5+ distinct locator areas, plan multiple Sections in this single draft. Large manuals/design docs usually need several orthogonal actions.
4. This is not a quota: skip duplicates, navigation-only blocks, placeholders, and unsupported fragments. The goal is coverage of distinct source-backed knowledge, not maximum Section count.
5. If `context reconcile prepare` returns `compact-source-low-coverage` or `dense-source-low-coverage`, revise the same draft to cover the suggested uncovered evidence candidates before review/apply. Do not treat those warnings as ignorable polish.

### Step 2 — Classify each raw snippet

For each `raw_snippets[]` entry:

1. If the snippet only contains navigation or placeholder evidence (`Parent` / `Children` / `Related` / `Relations`, sibling links, "no detailed content", etc.), emit `skip`. Do not create a Section whose content is just "Children: ..." or "Related: ..." and do not summarize facts that are not present in the snippet.
2. Walk the Section kind priority chain from [Section Kind Canon](#section-kind-canon); stop at the first kind whose trigger fires.
3. Verify the kind against the mount matrix for `node.type`. Mismatch → pick the next legal kind down the chain, or emit `skip` with a reason pointing at a better Node. Never "fall through to description" just to place evidence.
4. If you land on `description`, walk the [Description anti-abuse gates](#description-anti-abuse-gates). Any gate fires → split or `skip`.

For dense documents, group nearby snippets by their `block_locator_id` heading prefix and write one action per coherent fact group. Repeated `#` headings inside one source are often internal chapters of the current Node; keep them as Sections unless the raw evidence establishes a separate durable Node identity.

### Step 3 — Build actions

For each classified snippet:

1. Write `content` as the Section text the reader should see. It can include long prose, URLs, tables, command/config/code fences, or short raw wording. Keep one coherent, cited fact group per action.
2. Keep `content` faithful to the cited raw terms: do not introduce acronyms, abbreviations, translations, or aliases that do not appear in the cited raw snippet unless raw itself defines the equivalence or the user confirms it later during semantic review.
   - Default to raw wording. Only make semantic-preserving edits for formatting, typo fixes, casing, entity/alias consistency, or sentence cleanup. If the raw text is already clear, `content` should equal the raw text.
   - `source_support` is a lexical diagnostic, not the final semantic judge. Do not stuff raw text into `content` just to raise matched-term counts.
   - There is no separate default `evidence-echo` warning. Treat "echo" as an anti-pattern: raw copied only to show basis/evidence, while `source_ref` already provides traceability.
   - For `description` / `spec`, a concise summary plus the cited bullet list is acceptable when the bullets are the useful user-facing knowledge. It becomes echo only when the copied text is not meant to be read as active knowledge.
   - For `example` Sections that cite a code, config, or command fence, keep `content` centered on the cited fenced block. Put framing prose such as "basic configuration example" in `summary`, or cite a separate prose block in a separate action when that prose is itself source-backed knowledge.
3. If `content` is longer than 200 characters, add `summary`. Summary is LLM-authored reader/query aid: one plain paragraph, no Markdown, about `content.length / 10`, minimum 10 characters, recommended maximum 120. The CLI reports missing, long, short, or formatted summaries as warning hints only; it does not auto-generate them and does not treat them as evidence failures. `source_support` hard-term matching checks `content` (and legacy `detail` when present), not `summary`; keep summaries faithful to `content`, but do not copy raw-only keywords into `summary` for lexical scoring.
4. If the cited block contains documentation/reference URLs, preserve them in `content`. Link-only blocks are still useful knowledge; use `kind: description` with a concise "相关链接" identity when no more specific kind applies.
5. Omit `confidence` for ordinary confirmed claims. Assign `confidence` per the [Confidence rubric](#confidence-rubric) only when the evidence is not confirmed.
6. Fill `refers_to_nodes[]` per [Glossary and refers_to_nodes](#glossary-and-refers_to_nodes).
7. Cite evidence with `source_refs[]`, picking values from `raw_snippets[].source_ref`. When one Section summarizes contiguous multi-block evidence, list only the source refs consumed by that Section content; the CLI verifies that the refs can collapse to one canonical citation token and may auto-narrow over-wide citations. If the evidence is non-contiguous or contains separable claims, split the draft into separately cited actions instead of stretching one action across unrelated blocks. For `skip`, include `source_refs[]` only when the skip represents reviewed no-write material; omit evidence for purely deterministic no-ops such as unchanged input. Never submit singular `source_ref` or quoted-evidence fields; the CLI rejects them.

Rendered knowledge starts with optional `c4a:summary`, then the active `content`. If `content` differs from the cited raw, the CLI may render a debug-only `c4a:raw` block for audit; agents must not emit `raw`.

### Step 4 — Emit the JSON

Emit one compile draft JSON document for the caller to pass to `context compile --draft <slug> --input - --plan --prepare`. No markdown wrapper, no leading prose, no trailing commentary.

### Step 5 — Self-verify

- [ ] Every action's `target_node` equals `node.slug`, with a legal `kind × node.type` combination and `content` + optional `summary` + `source_refs[]` only (no singular `source_ref`, no `body` / `detail` / `raw`, no quoted-evidence or extractive-contract fields, no new terms absent from the cited raw). If not, return to **Step 2** for kind/mount-matrix issues, otherwise **Step 3**.
- [ ] Every `description` action survives the [Description anti-abuse gates](#description-anti-abuse-gates). If not, **Step 2** to split or `skip`.
- [ ] Coverage matches evidence density: dense raw with one broad action returns to **Step 2** unless remaining snippets are duplicates / navigation / placeholders / already covered. Citation-eligible URL blocks are either preserved or `skip`-with-evidence.
- [ ] `skip` semantics: bare `skip` only for deterministic no-op (unchanged input or pure navigation); reviewed-no-write `skip` carries `source_refs[]` from the cited snippet. When raw adds nothing, exactly one `op: skip` with a reason — not `actions: []`. If not, **Step 3**.
- [ ] If any edge case condition applies (action/domain Node, note snippets, existing Sections, non-changed-only incremental, or structural defect), the relevant reference's Self-verify items were also satisfied.
- [ ] NodeContext was the only evidence source — no Read / Glob / Grep / Write / ad-hoc script or shell file traversal against `WORKSPACE_DIR`, `.context`, `/tmp` workflow artifacts, or CLI `--format json` stdout. If any was used, restart from the CLI-provided NodeContext.

</procedures>
