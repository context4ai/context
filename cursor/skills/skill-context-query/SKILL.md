---
name: skill-context-query
description: >
  Internal procedure invoked by `/context-query`; not a user command. The agent uses
  `context query` hit/miss/select results first, supplements only with scoped
  query views when needed, and answers with Node slug, Section id,
  and compact node/section citations plus explicit gaps for unsupported claims.
  Activates when `/context-query` is invoked or when an agent needs to
  answer a question using local Context workspace knowledge with citations.
tools:
  - Bash
---

# skill-context-query — answer from local knowledge with CLI citations

Answer a user question from the local Context workspace without reading
workspace files directly. The CLI is the only source of local knowledge.

## TL;DR — Non-negotiables

- First evidence-bearing tool call should be the ordinary default query: `context query "$ARGUMENTS"`. One optional `context query --intent orientation` or empty `context query` call may run before it when this conversation has no usable workspace map; orientation is only for choosing a better query/scope and is never evidence for the answer.
- Do not Read, Glob, Grep, or Write `raw/`, `knowledge/`, `archive/`, `decisions/`, or any workspace file to answer the question.
- Use only `context query` output as evidence. If the CLI returns `miss` or fails, report that result instead of searching files yourself.
- Every key conclusion must cite the returned `node` and `section` handles. Default query output intentionally omits source provenance; do not invent or parse source locators.
- If returned entries do not support a conclusion, mark it as a gap. Do not turn missing local knowledge into a definite answer.
- If the output asks for a narrower scope or shows multiple candidate slugs, choose one only when the user's wording makes it unambiguous; otherwise ask the user which `slug` to use.
- If the output reports a broad, blocked, or truncated recall, follow that diagnostic: ask for a narrower Node, term, version, or scope; when entries are returned but truncated, answer from those entries and state the result is not exhaustive.
- Do not use Python, Node.js, shell scripts, `ls`, `find`, `rg`, `cat`, or similar ad-hoc commands to inspect `WORKSPACE_DIR`, `.context`, or `/tmp` workflow artifacts.
- If the question names a Node title, alias, or slug, state the actual Node slug used in the answer.
- When the first query is insufficient, supplement only with scoped query views named in the Supplemental context section or anchors from entry `refers_to_nodes`.
- Output language follows the user's conversation language. CLI flags, output column names, slugs, and Section ids stay as printed.

<reference>

## Evidence Shape

Primary evidence comes from the default `context query` output. Treat each
returned row as a small evidence card.

| Column / text | Use |
|---|---|
| `node` | Required citation handle for Section rows |
| `section` | Required citation handle for Section rows |
| `kind` | Section kind; use it to avoid overstating description/spec/warning content |
| `content` | Evidence text for answer claims |
| `refers_to_nodes` | Optional supplemental anchors when present |
| `slug` | Candidate handle when the output is asking you to choose a Node |
| `message` | Miss, broad-query, blocked, or narrowing guidance |

Supplemental context can come from:

```text
context query --intent node_search --scope <slug>
context query --intent impact_analysis --scope <slug>
context query --intent node_search --refers-to <slug>
```

## Answer citation shape

Use compact citations next to each key claim:

```text
<claim> [node / section]
```

If multiple Sections support the same claim, cite the strongest one or two.
Avoid citation-only dumps: summarize what the cited Section supports.

## Gap shape

Use a visible gap when the CLI evidence cannot support the requested fact:

```text
Gap: local knowledge did not return evidence for <missing point>.
```

If the likely cause is stale workflow state, suggest the relevant context
workflow (`/context-align` or `/context-compile`) only when the CLI output or
the user's wording indicates newly captured material is not yet knowledge.

</reference>

<procedures>

## Step 1: Query

If `$ARGUMENTS` is empty or whitespace-only, ask the user for a question first;
do not run the query.

If the current conversation has no useful workspace map and the user's question
is broad, ambiguous, or asks what can be queried, run one orientation pass before
the first evidence query:

```bash
context query --intent orientation
```

Empty `context query` returns the same orientation map.

Orientation returns directly queryable slug/title structure and one query
template. Use it only to choose a scope or show the user what can be queried.
Do not answer from orientation output. Do not cite orientation output.

If the user already asked a concrete question but this conversation has no
workspace map, you may run `context query --intent orientation` (or empty `context query`) and the first
ordinary `context query "$ARGUMENTS"` concurrently. Use the evidence
query for the answer; use orientation only for scoped follow-up if the first
query is insufficient.

Run the ordinary query first:

```bash
context query "$ARGUMENTS"
```

If the user explicitly asks for archive comparison, source cleanup audit, or
semantic reconciliation candidates, use recall with the matching profile:

- duplicate / near duplicate / dedupe → `--profile reconcile-dedupe`
- support check / source support → `--profile reconcile-support`
- refresh / stale source comparison → `--profile reconcile-refresh`

```bash
context query --intent recall --profile reconcile-dedupe --query "$ARGUMENTS"
```

Do not use recall archive profiles for ordinary questions.

## Step 2: Read and gate

Read the command output before answering.

- If the command fails, report the CLI failure and stop.
- If the output says `miss` or no local knowledge matched, report no local knowledge hit and stop.
- If the output shows candidate slugs instead of evidence rows, ask for a specific `slug`, unless the user's wording already identifies one candidate.
- If the output reports broad or blocked recall, stop and ask for a narrower Node, term, version, or scope before treating missing candidates as evidence of absence.
- If the output reports truncated recall, answer from the returned evidence when entries exist, mark coverage as non-exhaustive, and ask for narrowing only if the user needs a complete inventory.
- Keep a working set of returned rows with `node`, `section`, `kind`, `content`, and non-empty `refers_to_nodes`.

## Step 3: Anchor explicit Node mentions

If the user's question contains a likely Node title, alias, slug, code symbol,
or version:

1. Prefer exact slug, title, or alias matches from the query result.
2. State the actual Node slug used.
3. If the candidate set points to multiple plausible slugs, say which slugs were used and keep claims scoped to those slugs.

## Step 4: Supplement only when needed

Use supplemental commands only when the first query has entries but lacks
enough surrounding structure to answer the question.

Use supplements per the Supplemental context section, only after the first query
and only for slugs present in returned entries, entry `refers_to_nodes`, or
the user's explicit question. Use `refers_to_nodes` as extra anchors only when
they appear in returned Sections. Do not discover extra anchors by reading
workspace files.

## Step 5: Compose

Answer only from the query and supplemental outputs.

Required response behavior:

1. Start with the direct answer if evidence supports one.
2. Cite every key conclusion with Node slug and Section id.
3. Include a short "Used nodes" line when the question was anchored by title, alias, slug, code symbol, or version.
4. Include "Gap:" lines for requested points that are not supported.
5. Include a blocked / broad-query note when recall hints require narrowing, or a truncated/non-exhaustive note when returned evidence is only a subset.

## Self-check before final answer

- [ ] First evidence-bearing tool call was ordinary `context query "$ARGUMENTS"` or an explicit reconcile `--intent recall` query. If an orientation command ran first or concurrently, it was only `context query --intent orientation` or empty `context query`, and an evidence-bearing `context query` command ran before answering — if not, go back to **Step 1**.
- [ ] No direct file Read / Glob / Grep / Write was used against workspace local knowledge — if not, discard that evidence and go back to **Step 1**.
- [ ] No ad-hoc script or shell file traversal was used against `WORKSPACE_DIR`, `.context`, or `/tmp` workflow artifacts — if not, discard that evidence and go back to **Step 1**.
- [ ] Direct answer is given when evidence supports one — if not, go back to **Step 5**.
- [ ] Every key conclusion has `node / section` — if not, go back to **Step 5**.
- [ ] If the question carried a Node title / alias / slug / code symbol / version, the answer includes a "Used nodes" line — if not, go back to **Step 3** and **Step 5**.
- [ ] Any unsupported conclusion is marked as a gap — if not, go back to **Step 5**.
- [ ] Recall diagnostics are handled: broad/blocked asks for narrowing; truncated with entries answers with a non-exhaustive note — if not, go back to **Step 2** and **Step 5**.
- [ ] Archive entries appear only for explicit reconcile profiles — if not, go back to **Step 1** with the correct profile.

</procedures>
