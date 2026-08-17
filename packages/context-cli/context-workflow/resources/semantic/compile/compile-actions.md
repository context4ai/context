---
context_resource: semantic/compile/compile-actions
id: context.semantic.compile.compile-actions
kind: procedure
media-type: text/markdown
applies-to:
  - sections
  - kind
  - summary
  - content_mode
  - coverage
  - source_refs
name: compile-actions
description: >
  Internal procedure invoked by the current compile gate; not a user slash
  command. For one View at a time, reads the CLI-provided node-context
  (planned metadata, planned sections, local source aliases, and source refs),
  classifies each planned source span into a Section kind via the priority
  chain, writes source-bound actions with section_id, kind, required summary,
  source_refs[], and emits a context.compile-actions.v1 document
  for the caller to submit to the current phase command.
  Activates when compile iterates across the confirmed align structure.
tools:
  - Bash
---

# compile-actions — write Section actions for one View

Classify source-backed planned evidence for one materialized View into `add`, `update`, or
`skip` actions; emit JSON; the CLI performs every write. Replacement or
withdrawal judgments stay in user/structure review unless the schema view
explicitly exposes a current write shape.

## TL;DR — Non-negotiables

- One View per invocation — `view_ref` MUST equal the selected `view_ref`; no cross-View writes. Finish the current View's draft quality checks before the caller moves to another View's review/apply loop.
- Agent emits JSON only; no markdown, no direct workspace file writes. The caller submits the JSON to the current phase command; the CLI validates and stores candidate state.
- Evidence boundary: treat the CLI-provided node-context and evidence views as
  complete. Cite only source refs already planned on the selected section.
  If exact text is needed before choosing kind/summary/content, read it through
  current evidence views such as
  `context run align:<type>:<source>:<collection> --view span-detail --span <source-ref> --format json`
  or `--view span-text`. Never `grep` / `sed` / `jq` / `cat` / `head`
  snapshots, `--format json` stdout, or agent scratch files.
- Actions are candidate write actions, not final semantic decisions. Op naming
  is scoped by schema: `actions[]` already targets Sections, so Section
  lifecycle ops are verb-only: `add`, `update`, and `skip`. Do not use
  align-style names such as `add_section`, `write_section`, or
  `propose_section`.
- Citation validation passing is not completion. Before emitting, estimate
  coverage from the planned section refs: if there are 3+ citation-eligible
  spans, a one-action draft is valid only when the later spans are duplicates,
  navigation, placeholders, or continuations of the same fact. Small dense docs
  still need multiple actions when later spans state distinct capabilities,
  constraints, examples, risks, FAQ, or usage notes. Large manuals/design docs
  should compile to several orthogonal actions in the same draft.
- Pick `kind` from the current compile schema view, especially legal values and
  mount rules. Treat kind precision as a drafting quality preference, not a
  reason to loop forever when the CLI accepts the write. A `decision` fits only
  when the source explicitly presents two or more alternatives or options and
  records the chosen path plus rationale. One-option policy conclusions are
  usually `spec`, `principle`, or `description`. Bare rules or checks are usually
  `spec`. Reach `description` only after every more specific kind fails.
- `node.sections[]` / `planned_sections[]` is the confirmed structure scaffold,
  not a loose suggestion. Prefer a planned kind when the evidence fits; if a
  source-backed stronger kind differs, validate it and let CLI diagnostics guide
  review.
- `kind × node.node_type` must satisfy the CLI Section mount matrix; mismatches get rejected at write time. When the strongest kind is blocked by mount matrix, fall to the next legal kind whose form actually fits — do not collapse to `description` just because it mounts everywhere, and do not invent thin precision (e.g. one-line `spec`) just to avoid `description` either. See [Description anti-abuse gates](#description-anti-abuse-gates) for the classification checks at the description boundary.
- The schema view exposes `legal_section_kinds`, `section_kind_priority`, and
  `section_kind_mount_matrix`; semantic kind-choice triggers live in this
  resource rather than CLI JSON. CLI validation rejects unknown kinds and
  kind/node_type mount violations; treat those as structure or drafting errors,
  not review-time style preferences.
- Every write action cites raw via `source_refs[]` copied from the chosen
  planned section. Omitted-content verbatim actions must use one contiguous
  same-document evidence run; split non-contiguous evidence into multiple
  sections or return to prose align when the confirmed section is too coarse.
  Do not use explicit `content` / `content_intent` as a shortcut to merge
  unrelated or non-contiguous source spans into a shorter summary. Never
  fabricate refs or cite navigation-only spans as evidence for a content
  Section.
- For large evidence, use `source-index` to choose refs and `span-detail` /
  `span-text` only for the spans an action needs.
- `content` is not accepted on source-backed writes. Cite with `source_refs[]`
  and let the CLI mirror source into content. If the problem is non-contiguous
  source refs, dense examples, a needed translation, or a too-broad planned
  section, split the section through align instead of writing a compressed or
  summarized `content` paragraph. Prefer `summary` on `add` / `update` when
  it adds useful recall value; omit it when the View or Section title is already
  self-explanatory. Summary is recall text, not evidence. This summary is only
  the behavior half: the CLI derives any reachability half from confirmed
  structure edges after validation, so do not add relation summaries or edge
  fields to the action payload.
  The CLI
  rejects unsupported fields (`body`, `detail`, `raw`, singular `source_ref`,
  quoted-evidence) with canonical repair hints.
- The CLI also rejects template-like explicit `content`: bare TODO/TBD,
  `<placeholder>`, deferred-content placeholders, source-omission text such as
  "see source text", and directory lead-ins such as "this section describes" or
  "本节介绍". Only preserve such markers when they are literally present in the
  cited source text and are themselves the fact being documented.
- Preserve user-facing Markdown structure from cited raw when it carries meaning: inline code/code fences, Markdown links and URLs, blockquotes, list nesting, tables, and emphasis around key terms. Summary remains plain text; the materialized mirrored Section body may preserve raw Markdown when that is the clearest faithful Section text. Do not patch solely for style cleanup unless the cited source meaning is materially lost.
- Do not synthesize a user-facing prefix by concatenating `heading_path` values (for example, `Parent - Child:`) when that prefix is not in the cited raw. Use headings only to choose grouping and framing; if a heading's wording is itself useful, keep it as sourced content only when it appears in the cited span text.
- Preserve source-backed URLs, code identifiers, or `source_ref` literals when
  they are part of reader-facing knowledge or a repair challenge. Do not rely on
  memorized URL rules, and do not add literals only for scoring or traceability.
- Relationships and cross-node references belong in confirmed structure edges,
  not in compile action fields or verbatim body. Do not add structure edges or unresolved relations
  to `context.compile-actions.v1`.
- `skip` is the honest default when source evidence adds nothing. Bare `skip`
  is only for deterministic no-ops such as unchanged input, pure navigation, or
  context/background snippets. When citation-eligible evidence was reviewed and
  intentionally not written, emit `skip` with the relevant `source_refs[]`.
- Any Node may legitimately compile to no Sections when the provided snippets contain only navigation (`Parent` / `Children` / `Related` / `Relations`) or placeholder text that explicitly says no detailed content is available. Emit `skip`; do not turn align summaries, parent/child lists, sibling links, or placeholders into `description` Sections. The align graph and Node metadata preserve structure; narrow context-only navigation/reference blocks may be rendered later as a `References` auto-block, while active Sections still need citation-eligible content.
- FAQ collections attach to the most specific finalized Node (Entity → Action → Domain fallback); never create a standalone FAQ container.
- Output language: Node-facing summaries and user-facing draft explanations
  follow the workspace/source language when the phase view exposes one;
  otherwise match the source material. Section `summary` is reader/query aid:
  write Chinese summary prose for clearly Chinese cited evidence or mirrored
  content; English summary prose is acceptable for clearly English evidence;
  mixed technical evidence may keep concise mixed-language terms. Mirrored
  content is source-bound: preserve the cited source language, product names,
  code identifiers, CLI flags, slugs, `source_ref` tokens, and exact quoted
  evidence as printed.
- Stable output: keep action order aligned with evidence order — that ordering
  is the only stability concern the CLI cannot enforce. The CLI rejects unknown
  fields (timestamps, random ids, host/scratch paths) and canonicalises stored
  payloads; fixed rules and schema come from the selected resources, so only the current
  node-context should vary between repeated View draft calls.

## Edge cases — consult references when:

| Condition | Reference |
|---|---|
| `node.node_type` is `action` or `domain` | [action-domain-gates.md](action-domain-gates.md); use current `node-context` fields, planned sections, edges, and source refs |
| current schema/view exposes note evidence | [notes.md](notes.md) |
| `existing.sections[]` non-empty, **or** `incremental.status` is `unchanged` / `full-context`, **or** `incremental.locator_only_changes[]` non-empty | [refresh-and-update.md](refresh-and-update.md) |
| evidence implies missing Action / wrong parent / `depends_on` gap / planned-section ownership repair | [structural-challenges.md](structural-challenges.md) |

If none of the above hold, you are on the main path (first compile of an entity Node with default `changed-only` incremental status). The procedure below covers that path end-to-end.

<reference>

## Input — node-context

Canonical shape: `context run compile:<type>:<source>:<collection> --view node-context --source <view-ref> --format json` (or `--format json`). The CLI is the source of truth for fields, enums, and produced-by paths.

Boundary recap:

- `view_ref` is the active write boundary. The payload `view_ref` must match
  the selected view; do not draft for another view because the evidence looks
  related.
- `planned_sections[]` and their `source_refs[]` are the evidence floor. Never
  cite outside the selected planned section unless you first return to align and
  reconfirm structure.
- `local_sources[]` are aliases for source refs inside the node-context view.
  Preserve CLI-returned refs exactly in the payload.
- `existing.sections[]`, when present, means this is a refresh path. Read
  [refresh-and-update.md](refresh-and-update.md)
  before writing an `update` or deciding that no action is needed.
- `incremental.status`, locator-only changes, low-coverage diagnostics, and
  repair hints are part of the compile contract. Preserve their reason in the
  user-facing handoff when they force a skip, full-context read, or return to
  structure confirmation.
- Candidate or conflict lists surfaced by the CLI are the only relation
  comparison set. Do not search `knowledge/`, `dist/`, or source snapshots to
  invent more candidates.
- When you need exact source text for kind/summary/content judgment, read only
  the matching `span-detail` or `span-text` view for that source ref.

## Evidence Index Translation

Evidence views may expose compact indexes, grouped spans, and detail commands.
The committed evidence handle in the current workflow is `source_refs[]`, copied
from the confirmed planned section or from a CLI evidence view that the current
node-context explicitly points to.

Use the same discipline behind the evidence index:

- A write action cites only the refs it actually consumes. Do not attach every
  planned ref to a broad section just to make validation pass.
- Omitted-content verbatim actions need one continuous same-document evidence
  span after CLI canonicalization. If the relevant evidence is non-contiguous,
  split it into separate sections or return to align for a confirmed section
  split.
- If a planned section contains several unrelated facts, write several actions
  when the schema allows it; otherwise return to structure confirmation and
  split the planned section. Do not hide unrelated claims behind one summary.
- If the only available evidence is context/background, navigation, parent /
  child / related lists, placeholder text, or a title-only cue, do not promote
  it to active section body. Use `skip`, `unresolved[]`, or return to align as
  appropriate.
- Source refs are not traceability padding. They are the support boundary for
  reader-visible mirrored content and summaries. Every fact in `summary` must
  be covered by the cited refs.
- Never convert CLI-visible evidence handles into new ad hoc ids, aliases, or
  quoted evidence fields. Copy current refs exactly and let validation reject
  stale or miscoped refs.

## Output — Compile Draft JSON (main path)

Canonical shape: `context run compile:<type>:<source>:<collection> --view schema --format json` (or `--format json`). The CLI is the source of truth for fields, enums, and validation — do not memorise the shape from this file.

Main-path ops are **`add`**, **`update`**, and **`skip`** when supported by the
current schema. A typical new Section action is
`{ op: "add", section_id: "<planned-section-id>", kind: "<chain-picked>", summary: "...", source_refs: ["<source_ref>"] }`;
omit `content`. Never spell that as `add_section` because the `actions[]` array
already names the target object. A bare skip is `{ op: "skip", reason: "..." }`;
a reviewed-no-write skip may carry `source_refs[]` from the planned section.

Payload shape example. This envelope is **not valid** until `actions[]`
contains at least one action; the CLI rejects empty `actions[]` with
`schema.actions_missing`.

```json
{
  "schema_version": "context.compile-actions.v1",
  "view_ref": "<matches selected view_ref>",
  "actions": []
}
```

Minimal valid `add` payload:

```json
{
  "schema_version": "context.compile-actions.v1",
  "view_ref": "<matches selected view_ref>",
  "actions": [
    {
      "op": "add",
      "section_id": "<planned-section-id>",
      "kind": "<confirmed-section-kind>",
      "summary": "<source-backed summary>",
      "source_refs": ["<source_ref>"]
    }
  ]
}
```

Minimal valid no-write payload:

```json
{
  "schema_version": "context.compile-actions.v1",
  "view_ref": "<matches selected view_ref>",
  "actions": [
    {
      "op": "skip",
      "reason": "<source-bound reason>"
    }
  ]
}
```

Refresh/update judgment lives in
[refresh-and-update.md](refresh-and-update.md),
but emit only fields accepted by the current schema. Structure challenges live
in [structural-challenges.md](structural-challenges.md);
if the current schema has no challenge op, return to align rather than
inventing one.

`source_refs[]` is the committed evidence contract. A single citation is still
a single-element array. Keep hard citation gaps separate because omitted-content
verbatim cannot form one source ref across unrelated spans. When one Section
summarizes multi-span evidence, list only refs the action actually consumes.
Preserve raw wording by omitting `content`.
Preserving a cited prose/bullet list as the Section's user-facing content is
allowed when that list is the actual knowledge; the anti-pattern is copying raw
text only as traceability padding. For `example` Sections that cite command /
config / code fences, cite the relevant fenced block and let the CLI mirror it.
Inline command/code spans are not fences; if the cited raw is a numbered list
or prose with inline code, keep that shape and do not synthesize a ```bash```
block or shell commands.

## Section Kind Choice

Use `context run compile:<type>:<source>:<collection> --view schema --format json` (or yaml) for the current legal kind list, priority order, and mount matrix. This procedure adds only semantic guardrails:

- Stop at the first kind whose source-backed form fits.
- Do not choose `description` to hide lists, rules, tables, samples, risks, choices, or Q+A evidence that has a more precise kind.
- When the strongest kind is not mountable on this Node type, choose the next legal kind that the evidence truly supports, or `skip` with a structural challenge reason.

Confidence is optional. Omit it for ordinary confirmed claims; set it only when the evidence is clearly verified, inferred, or speculative according to the schema enum.

## Description anti-abuse gates

`description` is the kind for narrative claims that do not match any other form. Before locking in `kind: description` for a snippet, run three classification checks against the cited span:

1. **Atomicity**: single narrative, or multi-step / multi-row / multi-config? Multi → split into the right kinds — each step into its own `spec` / `warning`, each row into a `comparison` Section, each config block into `example` (sample) or `spec` (constraint with a check method).
2. **Kind-precision**: does a higher-priority kind fit better? A fenced code / config / command block belongs in `example`; a comparison table belongs in `comparison`; a Q+A pair belongs in `faq`; `incident` requires dated or timestamped failure evidence with impact scope plus root cause, mitigation, or handling record; ordinary scenario, case-study, or impact-result prose is not `incident`; a versioned change record belongs in `changelog`; `decision` requires two or more surfaced alternatives or options plus a chosen path and rationale; a verifiable rule with a check method belongs in `spec`; explicit risks belong in `warning`; a stable design rule or core mechanism without a recorded choice or check method belongs in `principle`.
3. **Action threshold**: multi-step fragments that clear the Action bar → emit `op: skip` with a note "evidence warrants sub-Action; re-align needed"; do not create Nodes from this procedure.

A Node whose raw is genuinely narrative — definitions, summaries, plain prose without enumerations or normative wording — legitimately ends with description-dominant output. The smell fires the other way: when raw contained enumerations, normative rules, or code blocks, and the draft collapsed them to `description`. Redraft from Step 2 in that case, not from a percentage threshold. Navigation-only evidence is handled separately by the TL;DR navigation rule and Step 2 — the gates above are not the right place to second-guess that path.

## Cross-Node Relations

When a Section meaningfully discusses another known Node, preserve that
relationship in confirmed `structure.yaml` edges or unresolved items. Do not
add structure edges or unresolved relations to compile actions and do not inject `[[id]]` style
links into verbatim body, because that breaks source mirror verification.

Use this decision chain:

1. If the relation is already a confirmed edge, compile may mention only what
   the selected section refs state; the edge itself remains in structure.
2. If the source-backed section clearly depends on, compares, triggers, or
   applies to another existing/current node but the edge is missing, stop and
   return to prose align with a structure repair note.
3. If the target is only a title hint, navigation clue, unresolved external
   system, or not present as a current/approved node, keep it in `unresolved[]`;
   do not invent a NodeRef to make the relation fit.
4. If another node name appears incidentally inside an example, command, URL, or
   product list and does not change the section's retrieval meaning, keep the
   source text as-is and do not add a relationship.

Relationship wording in body text still follows the source. Do not add
"depends on", "triggers", "contains", or similar language unless the cited span
states that relationship. The typed edge can preserve relation intent without
rewriting verbatim content.

If the CLI returns summary quality or low-coverage advisories with non-error severity, do not patch solely to satisfy the advisory and do not inspect every folded detail row by default. Patch only when the cited source meaning is lost, the user asks for cleanup, or the returned `next_action` asks for a draft patch.

## FAQ attachment priority

| FAQ topic | Attach to |
|---|---|
| About a concrete thing | That thing's Entity (Section `faq`) |
| About a mechanism or term | The matching Entity |
| About an action / flow | That Action |
| Cross-topic / generic workspace FAQ | Domain (fallback only) |

Never manufacture a FAQ container Node. If a FAQ cluster grows too large, a
sub-Entity is the correct escape hatch; return to structure confirmation with a
source-backed repair note instead of encoding that decision in compile actions.

</reference>

<procedures>

### Step 1 — Sanity-check the context

Confirm `view_ref` is set; abort if not. Note `node.node_type` — it caps legal
kinds per the CLI Section mount matrix.

Check edge case conditions from the routing table at the top of this procedure. If any apply, read the relevant resource **before** continuing. Those resources explain how their conditions modify Step 1 / Step 2 / Step 3.

Estimate coverage from the planned section source refs before writing actions.
Treat "the first quote is supported" as only a validation result, not a
completion signal.

Use the CLI-provided citation-eligible snippets and diagnostics as the coverage contract. Distinct source-backed facts should become distinct actions or evidence-carrying skips; duplicates, navigation-only blocks, placeholders, and unsupported fragments can be skipped. If later CLI diagnostics report low coverage, repair the same draft through the returned `next_action`.

### Step 2 — Classify each raw snippet

For each planned section and its source refs:

1. If the snippet only contains navigation or placeholder evidence (`Parent` / `Children` / `Related` / `Relations`, sibling links, "no detailed content", etc.), emit `skip`. Do not create a Section whose content is just "Children: ..." or "Related: ..." and do not summarize facts that are not present in the snippet.
2. Pick kind using [Section Kind Choice](#section-kind-choice); stop at the first kind whose trigger fires.
3. Verify the kind against the mount matrix for `node.node_type`. Mismatch → pick the next legal kind down the chain, or emit `skip` with a reason pointing at a better Node. Never "fall through to description" just to place evidence.
4. If you land on `description`, walk the [Description anti-abuse gates](#description-anti-abuse-gates). Any gate fires → split or `skip`.

For dense documents, group nearby spans by heading context and write one action
per coherent fact group. Repeated `#` headings inside one source are often
internal chapters of the current Node; keep them as Sections unless the evidence
establishes a separate durable Node identity.

### Step 3 — Build actions

For each classified snippet:

1. Do not write `content`. Cite `source_refs[]` and let the CLI mirror source
   into the Section content. If the cited raw is too broad, non-contiguous, or
   needs translation/rewording, split actions/sections or return to structure
   confirmation. Do not compress several raw blocks into one paragraph.
2. `summary` on `add` / `update` is optional behavior-half recall text.
   When present, it is LLM-authored reader/query aid: one plain paragraph, no
   Markdown, and compact. In YAML payloads, write `summary` as a plain
   single-line scalar. Omit it when the title is self-explanatory rather than
   writing filler.
   It covers only the cited section behavior. The CLI appends deterministic
   edge reachability metadata from confirmed structure edges during candidate
   materialization; do not duplicate that relation text in `summary`.
   Generic placeholders like "description section covering N evidence spans"
   are invalid drafting quality even when the payload remains schema-valid.
   If you cannot write a meaningful summary for source-backed reader content,
   do not submit a placeholder; narrow the action, use `skip` for no-write
   evidence, or return to the evidence/structure gate. The CLI reports
   non-blocking advisory hints for weak summary quality; it does not treat
   summary style as an evidence failure. Keep summaries faithful to the
   source-backed action, but do not copy source-only keywords into `summary` for
   scoring.
3. Preserve meaningful source-backed literals in `summary`, skip reason, or
   repair challenge when they are part of the knowledge. Do not patch only to
   satisfy non-blocking URL or style advisories.
4. Keep edge confidence out of compile actions. Source-authored uncertainty is
   preserved on confirmed structure edges during align; compile only consumes
   those edges for deterministic reachability metadata.
5. Keep cross-node relationships in structure edges; do not add extra relation
   fields to compile actions.
6. Cite evidence with `source_refs[]`, copied from the planned section. Hard
   citation gaps stay separate, while heading-annotated evidence may stay
   together or be split by semantic knowledge unit. If the evidence is
   non-contiguous or contains separable claims, split the draft into separately
   cited actions instead of stretching one action across unrelated spans. For
   `skip`, include `source_refs[]` only when the skip represents reviewed
   no-write material from citation-eligible evidence; omit evidence for purely
   deterministic no-ops, navigation, and context-only/background snippets.
   Never submit singular `source_ref` or quoted-evidence fields.

Approved knowledge may contain non-rendered `context:summary` metadata comments,
but reader-visible section body starts with the active mirrored content. Agents
must not emit rendered comments, debug raw blocks, or audit payloads themselves.

### Step 4 — Emit the JSON

Emit one compile draft JSON document for the caller to submit to the current envelope's `next_action.command`. No markdown wrapper, no leading prose, no trailing commentary.

Before returning, ensure `schema_version` is `context.compile-actions.v1`,
`view_ref` matches the selected view, every add/update action has `section_id`, fields
conform to the current compile schema view, citations point only at
CLI-provided planned section evidence, and node-context was the only evidence
source except for exact span reads through current CLI views.

</procedures>
