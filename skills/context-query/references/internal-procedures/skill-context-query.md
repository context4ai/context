---
name: skill-context-query
description: >
  Packaged skill invoked by `/context:query`; not a user slash command.
  Uses structure-first strategy: inspect orientation, resolve unknown Nodes with node_lookup,
  open known Nodes with node_view, then query Section details with section_search. Always
  cite Node slug and Section id.
  Activates when `/context:query` is invoked or when an agent needs to
  answer a question using local Context workspace knowledge with citations.
tools:
  - Bash
---

# skill-context-query — structure-first knowledge exploration with citations

Answer user questions by exploring the local Context workspace structure first,
then retrieving specific content within that structure. The CLI is the only source
of local knowledge; never read workspace files directly.

## TL;DR — Non-negotiables

- **Structure first**: When problem is vague, don't do semantic search; inspect `orientation`, use `node_lookup` only to find a slug, and use `node_view` to open a known Node.
- **CLI only**: Use only `context query` output as evidence. Never Read/Glob/Grep/Write workspace files.
- **Route by intent**: Classify problem intent (vague / clear Node / relationship / detail) and choose the right command; see Query Route table below.
- **Orientation is navigation**: `context query --intent orientation` returns a budgeted `[Slug Map]` plus optional `[Summary]` hints for scope choice only; it is not direct answer evidence.
- **Cite structure**: Every conclusion cites `[node/slug]` or `[node/section]`. If evidence does not support a claim, mark as gap.
- **Expand raw when needed**: Query summaries help recall and scope choice; factual answers should rely on returned Section content or CLI-provided raw/source_ref expansion commands when a hit is marked raw-assisted or raw-expandable.
- **Handle diagnostics**: If CLI returns `select`, `miss`, `broad`, `raw-only`, or `truncated`, follow the hint: show user structure to choose from, ask for narrower scope, or suggest workflow.

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
| `raw_expand_command` / `raw_evidence_preview` | Pointer to expand raw/source_ref evidence when the hit needs factual confirmation |
| `visibility` / `visible:` footer | Completeness signal for `node_view`; when `complete=true` / `visible: complete`, the shown Node Sections are exhaustive and there is no pagination |

Supplemental context can come from:

```text
context query --intent node_view --scope <slug>
context query --intent node_view --scope <slug> --view source-refs
context query --intent impact_analysis --scope <slug>
context query --intent node_view --refers-to <slug>
context query --intent section_search --scope <slug> --query "<keywords>"
```

Use the `--view source-refs` / `--view source-refs-index` node_view forms when a hit's `raw_expand_command` is needed for factual confirmation. These are query-owned read views; do not substitute `context compile context ...` during answer-only query work.

## Query Route Decision Table

Choose the `context query` command based on problem intent. **Structure queries take priority.**

| Problem intent | Primary command | When to use |
|---|---|---|
| **Vague question, no Node named** User asks "what is X" / "what are the X types" | `context query --intent orientation` or `context query --intent node_lookup --query "<keyword>"` | User unsure which Node to focus on; show structure first |
| **Node explicitly named** User mentions a specific service/system | `context query --intent node_view --scope <slug>` | User wants to open a specific known Node |
| **Relationship / impact** User asks what depends on X / impact of changing X | `context query --intent impact_analysis --scope <slug>` | User asks about how a Node connects to others |
| **Detail within known scope** (only after Node chosen) User asks for specific feature/behavior within chosen Node | `context query --intent section_search --scope <slug> --query "<detail>"` | User wants specific detail within an already-chosen Node |
| **Very specific fact** (fallback, rarely needed) User asks for exact implementation location | `context query "$ARGUMENTS"` | Semantic fallback when structure queries don't suffice |
| **Archive / reconciliation** User asks "find duplicates" / "check coverage" | `context query --intent recall --profile <reconcile-dedupe\|reconcile-support\|reconcile-refresh> --query "..."` | Only when user explicitly asks for audit/reconciliation |

## Orientation output and budget

`context query --intent orientation` is a navigation surface, not answer evidence.

- JSON output keeps full Node `summary` fields when present.
- Text output targets about 2000 tokens total. It prints `[Slug Map]` first, then `[Summary]`.
- `[Slug Map]` uses finalized structure relationships and is for choosing the next `--scope <slug>`. If the workspace is too large, deeper layers are folded first.
- `[Summary]` is truncated before the map. If output is still over budget, the command prints a continuation note. Drill down with scoped queries; there is no page-token pagination.
- Use `context query --intent node_view --scope <slug>` for a Node overview, or `context query --intent section_search --scope <slug> --query "<keywords>"` for details inside that Node.
- Use `context query --intent orientation --tag <tag>` or `context query --intent orientation --domain <slug>` to reduce the map before choosing a scope.
- When `slug` and `title` are equivalent after normalization (for example `payment-api` and `Payment API`), text output shows only the slug.

## BM25 Search Strategy

When using `section_search`, `recall`, or `node_lookup`, the CLI uses BM25 (keyword-based, not embedding-based) for matching. BM25 requires explicit keyword coverage, so queries must be precise:

- **Mix bilingual keywords**: Include both Chinese and English terms when querying—e.g., `"<chinese-term> <english-equivalent>"`, `"<product-name> <alternate-name>"`
- **Include synonyms & aliases**: BM25 is keyword-literal, so if your query doesn't match Section content exactly, try related terms
- **Use specific terminology**: Add version numbers, API names, or domain-specific terms to narrow results
- **Scope to reduce noise**: Use `--scope <slug>` to focus on a single Node; broad queries may be blocked or produce low-quality matches

Query intents that use BM25:
- `context query --intent node_lookup --query "<short-keyword>"` — find candidate Nodes from slug, title, summary, aliases, and tags when direct slug/title/alias matching does not resolve the query
- `context query --intent section_search --scope <slug> --query "<keywords>"` — find Section details using keyword matching within a known Node
- `context query --intent recall --profile <profile> --query "<keywords>"` — archive audit and reconciliation queries using keyword matching

Do NOT use BM25 strategy for:
- `context query --intent node_view --scope <slug>` or `--node <slug>` — uses structure, not keywords
- `context query --intent orientation` — uses structure, not keywords
- `context query --intent impact_analysis` — uses structure, not keywords

## Answer citation shape

Use compact citations keyed to evidence type:

```text
Node identity/title:        <claim> [slug]
Section claim:              <claim> [node/section]
Relationship/edge:          X → Y [relationship_type]
Multiple sources:           <claim> [node/section, node/section]
```

If multiple Sections support the same claim, cite the strongest one or two.
Summarize what each cited Section supports; do not list citations without explanation.

## Gap shape

Use a visible gap when the CLI evidence cannot support the requested fact:

```text
Gap: local knowledge did not return evidence for <missing point>.
```

If the likely cause is stale workflow state, suggest the relevant context
workflow (`/context:align` or `/context:compile`) only when the CLI output or
the user's wording indicates newly captured material is not yet knowledge.

</reference>

<procedures>

### Step 1 — Classify Problem Intent

Determine what the user is trying to learn. Choose the appropriate command from the Query Route table above.

**Classification:**

- **Vague problem** — user unsure which Node to focus on
  - Indicators: asks "what is X", "what are the X types", "how to understand X", or question without Node anchor
  - Action: Run `context query --intent orientation` to show available Nodes and structure; then pick a Node or ask for narrower scope
  - **Note**: `node_lookup` resolves unknown Node names; `node_view` opens known Node structure; orientation always works regardless of workspace content

- **Node explicitly named** — user mentions a specific service/system/concept
  - Indicators: user names a specific Node or system, "tell me about X", "show me X"
  - Action: Run `context query --intent node_view --scope <slug>` to explore that Node

- **Relationship / impact** — user asks how Nodes relate or what breaks if X changes
  - Indicators: "what depends on X", "impact of X", "relationship between X and Y"
  - Action: Run `context query --intent impact_analysis --scope <slug>` to show dependencies/relationships

- **Detail within known scope** — user already chose a Node, now asking for specific detail
  - Indicators: (comes after Node is selected) user asks "how does X handle [feature]", "what features does X support"
  - Action: Run `context query --intent section_search --scope <slug> --query "<detail-keywords>"` — use BM25 keywords for precise matching

- **Archive / reconciliation** — user explicitly asks for dedup/audit/coverage
  - Indicators: "find duplicates", "check source coverage"
  - Action: Run `context query --intent recall --profile <reconcile-*> --query "..."`
  - ❌ Never use for ordinary questions

### Step 2 — Execute Query And Interpret Response

Run the command from Step 1. Read the CLI output carefully.

**Route based on response:**

- ❌ **Command fails** → Report error and stop
- ❌ **`miss`** (no knowledge found) → Report no local knowledge and stop
- ⚠️ **`select`** (multiple candidate Nodes) → Show candidates to user; ask which Node to focus on
  - Then: loop back to Step 1 with chosen Node scope
- ⚠️ **`broad` / `blocked` recall** → Ask user for narrower scope (specific Node, term, version)
  - Then: loop back to Step 1
- ⚠️ **`raw-only` / `uncompiled`** → Say "raw source found but not yet in compiled knowledge"
  - Only suggest `/context:align` + `/context:compile` if user wants it compiled
- ⚠️ **`truncated`** (entries cut off) → Mark answer as "non-exhaustive"
  - Proceed to Step 3; ask for narrowing only if user needs complete inventory
- ✓ **`node_view` says `visible: complete` / `visibility.complete=true`** → Do not run `section_search` merely to check completeness; use `section_search` only when you need keyword narrowing or ranking inside the Node
- ✓ **Entries returned** → Proceed to Step 3

### Step 3 — Compose Answer From Returned Structure

Use only the returned Node/Section structure and content. Do not synthesize beyond what was returned.

**Response structure:**

1. **Start with core answer** — what the structure directly shows
2. **Cite every claim** — `[node/slug]` for Node identity, `[node/section]` for facts
3. **Include "Used nodes:" line** — if question named specific Nodes: "Using nodes: `<slug>`, `<slug>`"
4. **Mark gaps** — if user asked for something not in returned structure: "Gap: no evidence for X"
5. **Note truncation** — if CLI said `truncated`: "Non-exhaustive result — further narrowing available"

**Example for structure-first query:**
```
User asks: "What systems handle X in our architecture?"

Better query (structure-first):
  context query --intent orientation  # Shows all available Nodes

Returns several candidate Nodes matching the question.

Response:
"Systems that handle X:
- **<Node Title 1>** [<slug-1>] — responsibility and scope
- **<Node Title 2>** [<slug-2>] — responsibility and scope

To dive deeper into any system, ask me for more details or let me know which Node you want to explore."
```

**Why show structure first?** Even when you know keywords, structure queries reveal the full landscape.
Agents should explore Nodes first, then use section_search for details within a chosen Node.

### Step 4 — Explore Further When Requested

Once Node scope is clear, user may ask for deeper exploration.

**Supplemental query triggers:**

- User asks about Node's relationships/dependencies → `context query --intent impact_analysis --scope <slug>`
- User asks for full Node content after partial answer → `context query --intent node_view --scope <slug>`
- User asks specific detail within chosen Node → `context query --intent section_search --scope <slug> --query "<keywords>"`
  - **Use BM25 strategy**: mix Chinese and English keywords for better matching (e.g., mix synonym or translated forms of the search term)
- User names another Node in `refers_to_nodes` and asks about its relationship → `context query --intent node_view --refers-to <slug>`

**BM25 tips for supplemental queries:**
- When searching for a detail, include both native and translated forms of terms
- If first query is too broad, add more specific keywords or domain terminology instead of generic terms
- Scope helps narrow BM25 results: `--scope <slug> --query "<specific-term> <synonym>"` is more precise than an unscoped broad query

**Safety:**
- ❌ Do NOT auto-fetch all `refers_to_nodes`; only query if user asks
- ❌ Do NOT read workspace files to discover new Nodes
- ✓ Only supplement with slugs already in returned structure or user's explicit question

</procedures>
